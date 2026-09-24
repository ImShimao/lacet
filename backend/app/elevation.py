"""Altitude et dénivelé.

Deux fournisseurs, tous deux gratuits et sans clé :

* **IGN Géoplateforme** (RGE ALTI, 1 à 5 m) — France uniquement, de loin le plus précis.
* **OpenTopoData** (EU-DEM 25 m puis SRTM 30 m) — couverture mondiale, limité à
  1 requête par seconde. Utilisable ici parce qu'on l'appelle depuis un
  serveur : **ce service n'envoie aucun en-tête CORS**, donc le moteur
  embarqué, lui, ne peut pas s'en servir — il se replie sur le service
  d'altitude de Valhalla (voir `environment.js`). C'est la seule divergence
  assumée entre les deux moteurs.

Point important : le D+ n'est **pas** la somme des variations positives. Un MNT
est bruité, et ce bruit s'accumule à chaque point — une boucle plate ressort
alors à « D+ 90 m ». On applique donc un seuil d'hystérésis : une montée n'est
comptabilisée qu'au-delà de `ascent_threshold_m` de variation continue. Sans ce
filtre, les chiffres sortent 30 à 50 % au-dessus de ceux d'une montre GPS.

Deuxième point important : les altitudes sont **mises en commun et mises en
cache**. Dès qu'on propose cinq ou dix itinéraires, les interroger un par un
devient le poste le plus cher de toute la requête — autant de connexions, et
des lots à moitié vides. Et une sortie régénérée après un simple changement de
filtre repasse par les mêmes rues, dont l'altitude, elle, n'a pas changé.
"""

from __future__ import annotations

import asyncio
import json
import logging
import math
import threading
from pathlib import Path
from typing import NamedTuple

import httpx

from .config import settings
from .geo import Coord

log = logging.getLogger(__name__)

IGN_URL = "https://data.geopf.fr/altimetrie/1.0/calcul/alti/rest/elevation.json"
OPENTOPO_URL = "https://api.opentopodata.org/v1/{dataset}"
# Le nom exact des jeux de données, vérifié contre `/datasets` : « eudem25m »
# et non « eu_dem25m ». Avec le tiret bas, le service répond « Dataset not in
# config » — un HTTP 400 avalé par le repli, et le seul fournisseur mondial
# était hors service sans que rien ne le dise.
OPENTOPO_DATASETS = "eudem25m,srtm30m"

BATCH = 100  # points par requête — limite d'OpenTopoData, et prudent pour IGN

# Le seuil d'hystérésis dépend de la finesse de la source. Mesuré sur dix
# boucles, cache vidé entre les fournisseurs : en montagne, un modèle à 1 m et
# un modèle à 30 m s'accordent à 1 ou 7 % près ; en ville plate, le grossier
# annonce 72 m de D+ à Paris contre 17, 35 à Strasbourg contre 8, 23 à Mulhouse
# contre 2. Ce n'est pas du relief, c'est la grille qui tremble — et deux mètres
# comptent ce tremblement comme des côtes. Huit l'effacent sans abîmer la
# montagne (−5 % dans les Vosges).
COARSE_THRESHOLD_M = 8.0

# Un point sans donnée — pas un point à zéro mètre. L'IGN couvre la France et
# répond -99999 partout ailleurs ; prendre ces -99999 pour le niveau de la mer
# rendait **plate toute boucle hors de France**, et faisait passer la réponse
# pour valide, si bien qu'OpenTopoData — qui couvre le monde — n'était jamais
# interrogé.
_MISSING = {-99999.0, -32768.0, None}

# OpenTopoData n'autorise qu'une requête par seconde, tous appelants confondus.
# Les itinéraires étant évalués en parallèle, il faut sérialiser globalement —
# un espacement local à chaque appel ne suffirait pas.
_opentopo_lock = asyncio.Lock()

# Arrondi des coordonnées pour le cache : 5 décimales, soit environ un mètre.
# Plus fin ne servirait à rien — le modèle d'altitude lui-même est maillé au
# mètre au mieux — et empêcherait deux recherches identiques de se recouvrir.
_ROUND = 5


def _round(c: Coord) -> Coord:
    return (round(c[0], _ROUND), round(c[1], _ROUND))


class Relief(NamedTuple):
    """Les altitudes d'un tracé, et le seuil que leur source mérite."""

    values: list[float]
    threshold: float


async def fetch_many(routes: list[list[Coord]]) -> list[Relief | None]:
    """Altitudes de plusieurs tracés d'un coup.

    Tous les points de tous les tracés sont mis en commun, dédoublonnés,
    confrontés au cache disque ; seuls les inconnus partent sur le réseau, en
    lots pleins et sur une seule connexion.
    """
    if not routes or settings.elevation_provider == "none":
        return [None] * len(routes)

    wanted: dict[Coord, tuple[float, bool] | None] = {}
    for coords in routes:
        for c in coords:
            wanted.setdefault(_round(c), None)

    wanted.update(_cache.lookup(list(wanted)))
    missing = [c for c, v in wanted.items() if v is None]

    if missing:
        answer = await _fetch_with_fallback(missing)
        if answer is None:
            # Aucun fournisseur n'a répondu. Avec une partie seulement des
            # points, le profil serait faux plutôt qu'absent : on préfère absent.
            return [None] * len(routes)
        values, coarse = answer
        # Un point que personne ne connaît n'est pas gardé : le mettre en cache
        # interdirait de le redemander le jour où un fournisseur l'aura. La
        # finesse, elle, est gardée avec la valeur : sans elle, un point relu du
        # cache retrouverait le seuil fin, et le tremblement avec lui.
        fresh = {
            c: (z, gros) for c, z, gros in zip(missing, values, coarse) if z is not None
        }
        wanted.update(fresh)
        _cache.store(fresh)

    # Un tracé dont un seul point manque n'a pas de profil : mieux vaut
    # « D+ — » qu'un dénivelé calculé sur des trous. Les autres gardent le leur.
    #
    # Chaque tracé rend ses altitudes **et le seuil qui leur convient** : le plus
    # grossier de ses points décide.
    out: list[Relief | None] = []
    for coords in routes:
        if not coords:
            out.append(None)
            continue
        kept = [wanted.get(_round(c)) for c in coords]
        if any(v is None for v in kept):
            out.append(None)
            continue
        out.append(
            Relief(
                values=[v[0] for v in kept],
                threshold=(
                    COARSE_THRESHOLD_M
                    if any(v[1] for v in kept)
                    else settings.ascent_threshold_m
                ),
            )
        )
    return out


async def _fetch_with_fallback(
    coords: list[Coord],
) -> tuple[list[float | None], list[bool]] | None:
    """Chaque fournisseur complète ce que le précédent n'a pas su dire.

    Le second ne remplace pas le premier : il ne reçoit que les points restés
    sans réponse. Une boucle à cheval sur la frontière garde ainsi le mètre de
    l'IGN côté français et prend les vingt-cinq mètres d'OpenTopoData côté
    suisse — et OpenTopoData, limité à une requête par seconde, n'a que les
    points manquants à traiter au lieu de tous.

    Rend `None` si personne n'a rien su dire ; sinon les altitudes (à trous) et,
    point par point, si elles viennent d'un modèle grossier.
    """
    values: list[float | None] = [None] * len(coords)
    # Quels points viennent d'un modèle grossier : c'est ce qui décide du seuil.
    coarse = [False] * len(coords)
    todo = list(range(len(coords)))

    for provider in (settings.elevation_provider, settings.elevation_fallback):
        if not todo or provider in {"none", ""}:
            continue
        try:
            answer = await _fetch(provider, [coords[i] for i in todo])
        except Exception as exc:  # noqa: BLE001 — on tente le fournisseur suivant
            log.warning("fournisseur d'altitude %s indisponible : %s", provider, exc)
            continue
        if not answer or len(answer) != len(todo):
            log.warning(
                "%s a renvoyé %d valeurs pour %d points",
                provider,
                len(answer or []),
                len(todo),
            )
            continue
        rest = []
        for k, index in enumerate(todo):
            if answer[k] is None:
                rest.append(index)
            else:
                values[index] = answer[k]
                coarse[index] = provider != "ign"
        todo = rest

    return None if len(todo) == len(coords) else (values, coarse)


async def _fetch(provider: str, coords: list[Coord]) -> list[float | None]:
    batches = [coords[i : i + BATCH] for i in range(0, len(coords), BATCH)]
    timeout = httpx.Timeout(settings.elevation_timeout_s, connect=10.0)

    async with httpx.AsyncClient(timeout=timeout) as client:
        if provider == "ign":
            # L'IGN accepte les requêtes concurrentes.
            results = await asyncio.gather(*(_ign_batch(client, b) for b in batches))
        else:
            async with _opentopo_lock:
                results = []
                for i, batch in enumerate(batches):
                    if i:
                        await asyncio.sleep(1.05)
                    results.append(await _opentopo_batch(client, batch))

    flat: list[float | None] = []
    for chunk in results:
        flat.extend(chunk)
    return flat


async def _ign_batch(client: httpx.AsyncClient, batch: list[Coord]) -> list[float | None]:
    params = {
        "lon": "|".join(f"{c[0]:.6f}" for c in batch),
        "lat": "|".join(f"{c[1]:.6f}" for c in batch),
        "resource": "ign_rge_alti_wld",
        "delimiter": "|",
        "indent": "false",
        "measures": "false",
        "zonly": "true",
    }
    resp = await client.get(IGN_URL, params=params)
    resp.raise_for_status()
    data = resp.json()

    return _ign_values(data)


def _ign_values(data: dict) -> list[float | None]:
    """`zonly=true` rend {"elevations": [z, z, …]} ; sinon une liste d'objets."""
    out: list[float | None] = []
    for item in data.get("elevations", []):
        z = item.get("z") if isinstance(item, dict) else item
        out.append(None if z in _MISSING else float(z))
    return out


async def _opentopo_batch(client: httpx.AsyncClient, batch: list[Coord]) -> list[float | None]:
    locations = "|".join(f"{c[1]:.6f},{c[0]:.6f}" for c in batch)
    resp = await client.get(
        OPENTOPO_URL.format(dataset=OPENTOPO_DATASETS), params={"locations": locations}
    )
    resp.raise_for_status()
    return _opentopo_values(resp.json())


def _opentopo_values(data: dict) -> list[float | None]:
    out: list[float | None] = []
    for item in data.get("results", []):
        z = item.get("elevation")
        out.append(None if z in _MISSING else float(z))
    return out


class ElevationCache:
    """Cache disque des altitudes, découpé en tuiles de 0,05°.

    Le découpage évite d'avoir à charger une région entière pour lire trois
    points, et de réécrire un fichier géant à chaque sortie.
    """

    TILE = 0.05
    MAX_TILES_IN_MEMORY = 64
    # Les altitudes gardées avant la correction des points sans donnée valent
    # zéro mètre là où le fournisseur ne savait pas. Un cache empoisonné :
    # sans ce ménage, le dénivelé resterait nul hors de France sans jamais être
    # redemandé. Le numéro change quand ce qui est gardé change de sens.
    FORMAT = 3

    def __init__(self, directory: Path) -> None:
        self._dir = directory
        self._loaded: dict[tuple[int, int], dict[str, float]] = {}
        self._dirty: set[tuple[int, int]] = set()
        # Le serveur traite plusieurs requêtes en parallèle et elles écrivent
        # dans les mêmes tuiles : sans verrou, deux sorties voisines se
        # marcheraient dessus au moment de l'écriture.
        self._lock = threading.Lock()
        self._purge_legacy()

    def _purge_legacy(self) -> None:
        marque = self._dir / "format.json"
        try:
            if marque.exists() and json.loads(marque.read_text(encoding="utf-8")) == self.FORMAT:
                return
            if self._dir.exists():
                for path in self._dir.glob("*.json"):
                    path.unlink()
            self._dir.mkdir(parents=True, exist_ok=True)
            marque.write_text(json.dumps(self.FORMAT), encoding="utf-8")
        except (OSError, json.JSONDecodeError) as exc:  # cache indisponible
            log.warning("ménage du cache d'altitude impossible : %s", exc)

    def _tile(self, c: Coord) -> tuple[int, int]:
        return (math.floor(c[0] / self.TILE), math.floor(c[1] / self.TILE))

    def _load(self, tile: tuple[int, int]) -> dict[str, list]:
        cached = self._loaded.get(tile)
        if cached is not None:
            return cached
        path = self._dir / f"{tile[0]}_{tile[1]}.json"
        data: dict[str, list] = {}
        if path.exists():
            try:
                data = json.loads(path.read_text(encoding="utf-8"))
            except (json.JSONDecodeError, OSError):
                data = {}
        self._loaded[tile] = data
        return data

    def lookup(self, coords: list[Coord]) -> dict[Coord, tuple[float, bool]]:
        out: dict[Coord, tuple[float, bool]] = {}
        with self._lock:
            for c in coords:
                value = self._load(self._tile(c)).get(f"{c[0]},{c[1]}")
                if value is not None:
                    # Les caches d'avant ne rangeaient qu'un nombre : ils
                    # venaient d'une époque à source unique, donc fine.
                    out[c] = tuple(value) if isinstance(value, list) else (value, False)
        return out

    def store(self, values: dict[Coord, tuple[float, bool]]) -> None:
        with self._lock:
            for c, z in values.items():
                tile = self._tile(c)
                self._load(tile)[f"{c[0]},{c[1]}"] = z
                self._dirty.add(tile)
            self._flush()

    def _flush(self) -> None:
        self._dir.mkdir(parents=True, exist_ok=True)
        for tile in self._dirty:
            path = self._dir / f"{tile[0]}_{tile[1]}.json"
            try:
                path.write_text(json.dumps(self._loaded[tile]), encoding="utf-8")
            except OSError as exc:  # cache indisponible : on continue sans
                log.warning("écriture du cache d'altitude impossible : %s", exc)
        self._dirty.clear()

        # Le cache mémoire ne doit pas grandir indéfiniment dans un serveur qui
        # tourne des jours : au-delà de quelques dizaines de tuiles, on repart
        # du disque, qui reste rapide.
        if len(self._loaded) > self.MAX_TILES_IN_MEMORY:
            self._loaded.clear()


_cache = ElevationCache(settings.cache_dir / "elevation")


def ascent_descent(elevations: list[float], threshold: float | None = None) -> tuple[float, float]:
    """D+ et D− avec seuil d'hystérésis, pour ne pas compter le bruit du MNT."""
    if len(elevations) < 2:
        return 0.0, 0.0

    th = settings.ascent_threshold_m if threshold is None else threshold
    ascent = descent = 0.0
    reference = elevations[0]

    for value in elevations[1:]:
        delta = value - reference
        if delta >= th:
            ascent += delta
            reference = value
        elif delta <= -th:
            descent += -delta
            reference = value

    return round(ascent, 1), round(descent, 1)


def smooth(elevations: list[float], window: int = 3) -> list[float]:
    """Moyenne glissante — lisse les pics isolés avant le calcul du profil."""
    if window < 2 or len(elevations) < window:
        return elevations
    half = window // 2
    out: list[float] = []
    for i in range(len(elevations)):
        lo = max(0, i - half)
        hi = min(len(elevations), i + half + 1)
        out.append(sum(elevations[lo:hi]) / (hi - lo))
    return out
