"""Récupération des données OpenStreetMap via Overpass, avec cache disque.

On demande en une seule requête :
  - toutes les voies `highway` (le réseau routable),
  - les polygones de zone bâtie (`landuse`) — nécessaires à la règle du doute (L2),
  - les nœuds de traversée (`highway=crossing`) — nécessaires au comptage L3.
"""

from __future__ import annotations

import asyncio
import hashlib
import json
import logging
import os
import random
import time
from pathlib import Path
from typing import Any

import httpx

from ..config import settings
from ..geo import bbox_around
from .extract import Extract, clip_to_disk, read as read_extract, to_cache

log = logging.getLogger(__name__)

# Classes de voies qu'on ne télécharge même pas : elles seraient exclues en L0.
_EXCLUDED_HIGHWAYS = "motorway|motorway_link|trunk|trunk_link|construction|proposed|raceway|bus_guideway|escape"

_BUILTUP_LANDUSE = "residential|retail|commercial|industrial|education"

# Allées de parking et accès privatifs : sans intérêt pour courir, souvent
# privés, et ils représentent une part énorme du réseau OSM en ville. Les
# écarter allège fortement le graphe.
_EXCLUDED_SERVICE = "parking_aisle|driveway|drive-through|slipway"

# Au-delà d'une certaine distance, tout télécharger devient impossible : une
# boucle de 150 km demande un rayon de 45 km, soit 8 000 km² d'emprise. On
# retire alors la voirie de desserte fine, qui ne sert de toute façon à rien sur
# un long parcours — on ne traverse pas un lotissement au 80ᵉ kilomètre.
DETAIL_LEVELS = [
    # (distance max en mètres, classes de voies exclues en plus)
    (25_000, ""),
    (60_000, "service"),
    (120_000, "service|footway|steps|pedestrian|bridleway"),
    (float("inf"), "service|footway|steps|pedestrian|bridleway|path|track|living_street"),
]


# Délai au bout duquel on lance un miroir supplémentaire sans abandonner le
# précédent. Quinze secondes : assez long pour qu'un serveur qui travaille
# normalement — une grande emprise met couramment dix secondes — ne soit pas
# doublé pour rien, assez court pour qu'une panne ne coûte plus une minute et
# demie. Mesuré avant ce réglage : 87 secondes perdues sur un miroir qui a fini
# par répondre « 504 », quand son voisin répondait en sept.
HEDGE_DELAY_S = 15.0


def detail_filter(target_m: float) -> str:
    for ceiling, extra in DETAIL_LEVELS:
        if target_m <= ceiling:
            return extra
    return DETAIL_LEVELS[-1][1]


QUERY_TEMPLATE = """
[out:json][timeout:{timeout}];
(
  way["highway"]["highway"!~"^({excluded})$"]["service"!~"^({service})$"]["area"!~"^yes$"]({s},{w},{n},{e});
);
out body geom;
(
  way["landuse"~"^({builtup})$"]({s},{w},{n},{e});
);
out geom;
(
  node["highway"="crossing"]({s},{w},{n},{e});
);
out body;
"""


class OverpassError(RuntimeError):
    pass


def _cache_path(key: str) -> Path:
    return settings.cache_dir / "osm" / f"{key}.json"


def area_key(lat: float, lon: float, radius_m: float, target_m: float = 0.0) -> str:
    """Identité de l'extrait OSM correspondant à ces paramètres.

    Deux départs distants de moins de ~100 m et visant une distance comparable
    partagent le même extrait — donc le même cache, disque comme mémoire.
    """
    detail = detail_filter(target_m or radius_m * 2)
    return _cache_key(lat, lon, radius_m, detail)


def _cache_key(lat: float, lon: float, radius_m: float, detail: str) -> str:
    # Arrondi pour que deux départs voisins partagent le même cache. Le niveau
    # de détail en fait partie : deux extraits de même emprise mais de finesse
    # différente ne sont pas interchangeables.
    raw = f"{lat:.3f},{lon:.3f},{int(radius_m // 500) * 500},{detail}"
    return hashlib.sha1(raw.encode()).hexdigest()[:16]


def _read_cache(key: str, *, allow_stale: bool = False) -> dict[str, Any] | None:
    """Extrait en cache. `allow_stale` ignore la péremption.

    La péremption existe pour que les données suivent OpenStreetMap, pas pour
    interdire de s'en servir. Quand tous les miroirs sont muets, un extrait de
    trois semaines vaut infiniment mieux qu'un message d'erreur : le réseau de
    rues n'a pas changé, et l'utilisateur voulait juste courir.
    """
    path = _cache_path(key)
    if not path.exists():
        return None
    if not allow_stale:
        age_days = (time.time() - path.stat().st_mtime) / 86_400
        if age_days > settings.cache_ttl_days:
            return None
    try:
        return json.loads(path.read_text(encoding="utf-8"))
    except (json.JSONDecodeError, OSError):
        return None


def _write_cache(key: str, payload: dict[str, Any]) -> None:
    path = _cache_path(key)
    path.parent.mkdir(parents=True, exist_ok=True)
    try:
        path.write_text(json.dumps(payload), encoding="utf-8")
    except OSError as exc:  # cache indisponible : on continue sans
        log.warning("écriture du cache OSM impossible : %s", exc)


async def fetch_area(
    lat: float, lon: float, radius_m: float, *, target_m: float = 0.0
) -> Extract:
    """Rend l'extrait OpenStreetMap pour un disque autour du point de départ.

    `target_m` sert à choisir la finesse du réseau demandé : plus la boucle est
    longue, moins on a besoin du détail des rues de desserte.

    Overpass ne connaît que les rectangles : on lui demande donc le carré qui
    entoure le disque, on garde ce carré en cache — il resservira au départ d'à
    côté — et on ne rend que ce qui est à portée.
    """
    extract = await _fetch_bbox(lat, lon, radius_m, target_m=target_m)
    return clip_to_disk(extract, lon, lat, radius_m)


async def _fetch_bbox(
    lat: float, lon: float, radius_m: float, *, target_m: float = 0.0
) -> Extract:
    """Le carré entier, tel qu'Overpass le rend — mis en cache sur disque."""
    extra = detail_filter(target_m or radius_m * 2)
    key = _cache_key(lat, lon, radius_m, extra)
    cached = _read_cache(key)
    if cached is not None:
        log.info("données OSM servies depuis le cache (%s)", key)
        return _upgrade(key, cached)

    excluded = f"{_EXCLUDED_HIGHWAYS}|{extra}" if extra else _EXCLUDED_HIGHWAYS
    s, w, n, e = bbox_around(lat, lon, radius_m)
    query = QUERY_TEMPLATE.format(
        timeout=settings.overpass_timeout_s,
        excluded=excluded,
        service=_EXCLUDED_SERVICE,
        builtup=_BUILTUP_LANDUSE,
        s=f"{s:.6f}",
        w=f"{w:.6f}",
        n=f"{n:.6f}",
        e=f"{e:.6f}",
    )

    payload = await _query_mirrors(query)
    if payload is not None:
        extract = read_extract(payload)
        # Un extrait vide n'est pas mis en cache : si le vide venait malgré tout
        # d'une panne généralisée, on ne veut pas la figer pour deux semaines.
        if extract.ways:
            _write_cache(key, to_cache(extract))
        return extract

    # Dernier recours avant l'échec : un extrait périmé, s'il en existe un.
    stale = _read_cache(key, allow_stale=True)
    if stale is not None:
        log.warning("miroirs muets : on repart sur l'extrait OSM périmé (%s)", key)
        return _upgrade(key, stale)

    raise OverpassError(
        "Aucun miroir OpenStreetMap n'a répondu. Vérifie ta connexion, ou "
        "réessaie dans une minute : ces serveurs sont publics et gratuits, et "
        "ils saturent régulièrement aux heures ouvrées."
    )


def _upgrade(key: str, data: dict[str, Any]) -> Extract:
    """Relit un extrait et, s'il est au vieux format, le réécrit au nouveau.

    Sans cela, un cache déjà constitué garderait la forme brute — et sa lecture
    ses deux secondes de trop — jusqu'à sa péremption, soit deux semaines. La
    conversion se fait donc à la première relecture.

    La date du fichier est restituée à l'identique : réécrire un fichier le
    rajeunit, et un extrait vieux de treize jours repartirait pour quatorze
    sans que les données aient été rafraîchies.
    """
    extract = read_extract(data)
    if "elements" not in data or not extract.ways:
        return extract

    path = _cache_path(key)
    try:
        stamp = path.stat().st_mtime
        _write_cache(key, to_cache(extract))
        os.utime(path, (stamp, stamp))
        log.info("extrait OSM converti au format compact (%s)", key)
    except OSError as exc:  # conversion impossible : on continue avec l'ancien
        log.warning("conversion du cache impossible : %s", exc)

    return extract


async def _query_mirrors(query: str) -> dict[str, Any] | None:
    """Interroge les miroirs, en chevauchant les lents, sur plusieurs tours.

    Trois précautions valent d'être expliquées.

    **L'ordre est tiré au sort à chaque requête.** Interroger toujours le même
    miroir en premier concentre la charge sur lui et le fait saturer plus vite —
    c'est exactement ce qui produisait des « 429 Too Many Requests » en rafale.

    **On n'attend pas un miroir jusqu'au bout avant d'essayer le suivant.** Voir
    `HEDGE_DELAY_S` : c'est le poste de loin le plus coûteux de toute la requête.

    **On attend entre deux tours**, avec un temps qui double et une part
    aléatoire. Une saturation d'Overpass dure quelques secondes ; réattaquer
    immédiatement les mêmes serveurs ne fait qu'aggraver ce qu'on subit.
    """
    timeout = httpx.Timeout(settings.overpass_timeout_s + 15, connect=15.0)
    # Les instances Overpass publiques refusent (406) les agents anonymes.
    # S'identifier est une obligation de leur charte d'usage, pas une option.
    headers = {"User-Agent": settings.user_agent, "Accept": "application/json"}

    mirrors = list(settings.overpass_urls)
    random.shuffle(mirrors)
    empty: dict[str, Any] | None = None

    async with httpx.AsyncClient(timeout=timeout, headers=headers) as client:
        for attempt in range(max(1, settings.overpass_rounds)):
            if attempt:
                delay = 2.0 * (2**(attempt - 1)) + random.uniform(0, 1.0)
                log.info("tous les miroirs occupés, nouvelle tentative dans %.1f s", delay)
                await asyncio.sleep(delay)

            payload = await _hedged_round(client, mirrors, query)
            if payload is not None:
                # Une réponse vide et bien formée est ambiguë : c'est ce que rend
                # un miroir qui a abandonné en cours de route, mais c'est aussi
                # la vérité en pleine mer ou en plein désert. On la garde de
                # côté et on laisse le tour suivant tenter mieux.
                if payload["elements"]:
                    return payload
                empty = payload

    if empty is not None:
        log.info("tous les miroirs joignables décrivent une zone sans voirie")
    return empty


async def _hedged_round(
    client: httpx.AsyncClient, mirrors: list[str], query: str
) -> dict[str, Any] | None:
    """Un tour complet : les miroirs démarrent l'un après l'autre, sans attendre.

    C'est ce qui remplace la file d'attente, et la mesure justifie le changement :
    sur une recherche de 103 secondes, 89 étaient du téléchargement — dont 87
    passées à attendre qu'un miroir en panne finisse par répondre « 504 Gateway
    Timeout ». Le suivant, lui, a répondu en sept secondes. Interroger en file
    faisait donc payer la panne d'un serveur en entier avant d'essayer l'autre.

    On ne lance pas tout d'un coup pour autant : ce sont des serveurs publics et
    gratuits, et quadrupler la charge de chaque recherche serait un abus. Un
    miroir qui répond normalement est seul sollicité ; on n'en ajoute un que
    lorsque le précédent tarde au point qu'on le soupçonne perdu.
    """
    pending: set[asyncio.Task] = set()
    waiting = list(mirrors)
    empty: dict[str, Any] | None = None

    try:
        while waiting or pending:
            if waiting:
                url = waiting.pop(0)
                log.info("interrogation d'Overpass : %s", url)
                pending.add(asyncio.ensure_future(_ask(client, url, query)))

            # Tant qu'il reste un miroir en réserve, on ne s'endort que le temps
            # du chevauchement ; quand il n'en reste plus, on attend vraiment la
            # réponse de ceux qui sont partis.
            done, pending = await asyncio.wait(
                pending,
                timeout=HEDGE_DELAY_S if waiting else None,
                return_when=asyncio.FIRST_COMPLETED,
            )

            for task in done:
                try:
                    payload = task.result()
                except Exception as exc:  # noqa: BLE001 — on compte sur les autres
                    log.warning("miroir indisponible : %s", _short(exc))
                    continue
                if payload["elements"]:
                    return payload
                # Vide : ambigu, voir `_query_mirrors`. On demande aux autres.
                empty = payload
    finally:
        # Les requêtes encore en vol n'intéressent plus personne, et les laisser
        # courir tiendrait des connexions ouvertes sur des serveurs partagés.
        for task in pending:
            task.cancel()

    return empty


async def _ask(client: httpx.AsyncClient, url: str, query: str) -> dict[str, Any]:
    resp = await client.post(url, data={"data": query})
    resp.raise_for_status()
    payload = resp.json()
    if "elements" not in payload:
        raise OverpassError(f"réponse de {url} sans champ 'elements'")
    if not payload["elements"]:
        log.info("%s rend un extrait vide, on demande aux autres", url)
    return payload


def _short(exc: Exception) -> str:
    """Première ligne d'une erreur — httpx en produit cinq, dont une URL de doc.

    Certaines exceptions réseau n'ont aucun message : une erreur de connexion ou
    de handshake TLS arrive régulièrement avec un texte vide. `splitlines()`
    rend alors une liste vide, et lire son premier élément levait une
    `IndexError` **depuis le bloc d'exception lui-même** — l'erreur de
    journalisation remplaçait l'erreur réseau et remontait jusqu'à
    l'utilisateur, en n'apparaissant que lors du tout premier téléchargement
    d'une zone.
    """
    text = str(exc).strip()
    if not text:
        return type(exc).__name__
    return text.splitlines()[0][:160]
