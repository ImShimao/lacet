"""Altitude et dénivelé.

Deux fournisseurs, tous deux gratuits et sans clé :

* **IGN Géoplateforme** (RGE ALTI, 1 à 5 m) — France uniquement, de loin le plus précis.
* **OpenTopoData** (EU-DEM 25 m puis SRTM 30 m) — couverture mondiale, limité à
  1 requête par seconde.

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

import httpx

from .config import settings
from .geo import Coord

log = logging.getLogger(__name__)

IGN_URL = "https://data.geopf.fr/altimetrie/1.0/calcul/alti/rest/elevation.json"
OPENTOPO_URL = "https://api.opentopodata.org/v1/{dataset}"
OPENTOPO_DATASETS = "eu_dem25m,srtm30m"

BATCH = 100  # points par requête — limite d'OpenTopoData, et prudent pour IGN
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


async def fetch_many(routes: list[list[Coord]]) -> list[list[float] | None]:
    """Altitudes de plusieurs tracés d'un coup.

    Tous les points de tous les tracés sont mis en commun, dédoublonnés,
    confrontés au cache disque ; seuls les inconnus partent sur le réseau, en
    lots pleins et sur une seule connexion.
    """
    if not routes or settings.elevation_provider == "none":
        return [None] * len(routes)

    wanted: dict[Coord, float | None] = {}
    for coords in routes:
        for c in coords:
            wanted.setdefault(_round(c), None)

    wanted.update(_cache.lookup(list(wanted)))
    missing = [c for c, v in wanted.items() if v is None]

    if missing:
        values = await _fetch_with_fallback(missing)
        if values is None:
            # Aucun fournisseur n'a répondu. Avec une partie seulement des
            # points, le profil serait faux plutôt qu'absent : on préfère absent.
            return [None] * len(routes)
        fresh = dict(zip(missing, values))
        wanted.update(fresh)
        _cache.store(fresh)

    return [[wanted[_round(c)] for c in coords] if coords else None for coords in routes]


async def _fetch_with_fallback(coords: list[Coord]) -> list[float] | None:
    for provider in (settings.elevation_provider, settings.elevation_fallback):
        if provider in {"none", ""}:
            continue
        try:
            values = await _fetch(provider, coords)
            if values and len(values) == len(coords):
                return values
            log.warning(
                "%s a renvoyé %d valeurs pour %d points",
                provider,
                len(values or []),
                len(coords),
            )
        except Exception as exc:  # noqa: BLE001 — on tente le fournisseur suivant
            log.warning("fournisseur d'altitude %s indisponible : %s", provider, exc)
    return None


async def _fetch(provider: str, coords: list[Coord]) -> list[float]:
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

    flat: list[float] = []
    for chunk in results:
        flat.extend(chunk)
    return flat


async def _ign_batch(client: httpx.AsyncClient, batch: list[Coord]) -> list[float]:
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

    # `zonly=true` rend {"elevations": [z, z, ...]} ; sinon une liste d'objets.
    raw = data.get("elevations", [])
    out: list[float] = []
    for item in raw:
        z = item.get("z") if isinstance(item, dict) else item
        out.append(0.0 if z in _MISSING else float(z))
    return out


async def _opentopo_batch(client: httpx.AsyncClient, batch: list[Coord]) -> list[float]:
    locations = "|".join(f"{c[1]:.6f},{c[0]:.6f}" for c in batch)
    resp = await client.get(
        OPENTOPO_URL.format(dataset=OPENTOPO_DATASETS), params={"locations": locations}
    )
    resp.raise_for_status()
    data = resp.json()
    out: list[float] = []
    for item in data.get("results", []):
        z = item.get("elevation")
        out.append(0.0 if z in _MISSING else float(z))
    return out


class ElevationCache:
    """Cache disque des altitudes, découpé en tuiles de 0,05°.

    Le découpage évite d'avoir à charger une région entière pour lire trois
    points, et de réécrire un fichier géant à chaque sortie.
    """

    TILE = 0.05
    MAX_TILES_IN_MEMORY = 64

    def __init__(self, directory: Path) -> None:
        self._dir = directory
        self._loaded: dict[tuple[int, int], dict[str, float]] = {}
        self._dirty: set[tuple[int, int]] = set()
        # Le serveur traite plusieurs requêtes en parallèle et elles écrivent
        # dans les mêmes tuiles : sans verrou, deux sorties voisines se
        # marcheraient dessus au moment de l'écriture.
        self._lock = threading.Lock()

    def _tile(self, c: Coord) -> tuple[int, int]:
        return (math.floor(c[0] / self.TILE), math.floor(c[1] / self.TILE))

    def _load(self, tile: tuple[int, int]) -> dict[str, float]:
        cached = self._loaded.get(tile)
        if cached is not None:
            return cached
        path = self._dir / f"{tile[0]}_{tile[1]}.json"
        data: dict[str, float] = {}
        if path.exists():
            try:
                data = json.loads(path.read_text(encoding="utf-8"))
            except (json.JSONDecodeError, OSError):
                data = {}
        self._loaded[tile] = data
        return data

    def lookup(self, coords: list[Coord]) -> dict[Coord, float]:
        out: dict[Coord, float] = {}
        with self._lock:
            for c in coords:
                value = self._load(self._tile(c)).get(f"{c[0]},{c[1]}")
                if value is not None:
                    out[c] = value
        return out

    def store(self, values: dict[Coord, float]) -> None:
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
