"""Altitude et dénivelé.

Trois sources, toutes gratuites et sans clé :

* **IGN Géoplateforme** (RGE ALTI, 1 à 5 m) — France uniquement, de loin le plus précis.
* **Terrain Tiles** d'AWS (zoom 12, ~25 m en Europe) — seulement les tuiles déjà
  gardées : c'est l'altitude sans réseau (voir `TERRAIN_URL`).
* **OpenTopoData** (EU-DEM 25 m puis SRTM 30 m) — couverture mondiale, limité à
  1 requête par seconde. Utilisable ici parce qu'on l'appelle depuis un
  serveur : **ce service n'envoie aucun en-tête CORS**, donc le moteur
  embarqué, lui, ne peut pas s'en servir — il se replie sur le service
  d'altitude de Valhalla (voir `environment.js`). C'est la seule divergence
  assumée entre les deux moteurs.

Point important : le D+ n'est **pas** la somme des variations positives. Un MNT
est bruité, et ce bruit s'accumule à chaque point — une boucle plate ressort
alors à « D+ 90 m ». On lisse donc légèrement, puis on applique un seuil
d'hystérésis : une montée n'est comptabilisée qu'au-delà de `ascent_threshold_m`
de variation continue.

Mais trop lisser rabote les côtes. Le réglage d'avant — un point tous les 100 m,
une moyenne sur trois points, deux mètres de seuil — sous-estimait de 10 % en
moyenne, et jusqu'à moitié sur les boucles vallonnées. Mesuré le 4 octobre 2026
sur 54 boucles de l'app autour de Guebwiller, contre leur altitude IGN relevée
tous les cinq mètres : un point tous les 50 m, un noyau triangulaire de 60 m et
un mètre de seuil ramènent l'écart à −1 % au total et 1,7 % par boucle (pire
cas 10 %). Le modèle grossier, lui, prend un noyau de 100 m et trois mètres de
seuil (−2 % et 11 %, contre −14 % et 21 % avec l'ancien seuil de huit). Le
détail est dans `frontend/src/engine/environment.js`, qui fait le même calcul.

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
import struct
import threading
import zlib
from pathlib import Path
from typing import Callable, NamedTuple

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

# Les Terrain Tiles d'AWS (Mapzen, d'après Copernicus EU-DEM en Europe) : le
# relief **sans réseau**. L'IGN et OpenTopoData sont des services : sans
# couverture, plus de D+. Ces tuiles, elles, se gardent comme les fonds de carte.
# Mesuré le 19 octobre 2026 (`scripts/terrain_tiles.py`) sur les boucles de
# Guebwiller et Soultz : au zoom 12, 3,5 m d'écart moyen avec l'IGN et un D+ à
# −1 % au total, à condition de le compter au réglage grossier — ce que fait
# `shape_relief`, puisque ce fournisseur n'est pas l'IGN. Les zooms 13 et 14 ne
# font qu'agrandir les mêmes données. Seules les tuiles déjà sur le disque
# servent : ce fournisseur est celui du hors-ligne, pas un service de plus.
TERRAIN_URL = "https://s3.amazonaws.com/elevation-tiles-prod/terrarium/{z}/{x}/{y}.png"
TERRAIN_ZOOM = 12
TERRAIN_DIR = settings.cache_dir / "terrarium"

BATCH = 100  # points par requête — limite d'OpenTopoData, et prudent pour IGN

# Le lissage et le seuil dépendent de la finesse de la source. Un modèle à 30 m
# tremble : en ville plate, deux mètres de seuil lui faisaient annoncer 72 m de
# D+ à Paris contre 17. Ce n'est pas du relief, c'est la grille qui tremble.
FINE_KERNEL_M = 60.0
COARSE_KERNEL_M = 100.0
COARSE_THRESHOLD_M = 3.0

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
    """Les altitudes d'un tracé, et si leur source est grossière."""

    values: list[float]
    coarse: bool


# --- le relief de la zone, avant de tracer --------------------------------

# Pas de la grille, en degrés (longitude, latitude) : environ 220 m sous nos
# latitudes. Assez fin pour voir un coteau de vignes ; la rue elle-même est
# mesurée plus tard, tous les 50 m, sur le tracé retenu.
TERRAIN_STEP_DEG = (0.003, 0.002)

# Au-delà de ce rayon, le pas double, triple… : la grille garde toujours
# environ deux mille points, soit une seule requête à l'IGN, et une boucle de
# 100 km n'a pas besoin du relief à 220 m près.
TERRAIN_RADIUS_PER_STEP_M = 5000.0


class Terrain:
    """L'altitude en tout point de la zone, interpolée sur une grille.

    La préférence de dénivelé ne jouait qu'au moment de choisir : le moteur
    traçait sans rien savoir du relief, puis mesurait. Au pied des Vosges, à
    Guebwiller, deux boucles sur trois montaient dans les vignes, et une demande
    de plat finissait avec 290 m de D+ en tête. Connaître le relief **avant** de
    tracer permet de viser le bon terrain (voir `generate_loops`).

    La grille est calée sur un quadrillage fixe et non sur le départ : deux
    recherches voisines demandent les mêmes points, et le cache les sert.
    """

    def __init__(self, lat: float, lon: float, radius_m: float) -> None:
        mult = max(1, math.ceil(radius_m / TERRAIN_RADIUS_PER_STEP_M))
        self.step_lon = TERRAIN_STEP_DEG[0] * mult
        self.step_lat = TERRAIN_STEP_DEG[1] * mult
        half_lat = radius_m / 111_320.0
        half_lon = radius_m / (111_320.0 * math.cos(lat * math.pi / 180.0))
        self.i0 = math.floor((lat - half_lat) / self.step_lat)
        self.j0 = math.floor((lon - half_lon) / self.step_lon)
        self.n_lat = math.ceil((lat + half_lat) / self.step_lat) - self.i0 + 1
        self.n_lon = math.ceil((lon + half_lon) / self.step_lon) - self.j0 + 1
        self.values: list[float] = []

    def points(self) -> list[Coord]:
        """Les nœuds de la grille, ligne de latitude après ligne de latitude."""
        return [
            ((self.j0 + j) * self.step_lon, (self.i0 + i) * self.step_lat)
            for i in range(self.n_lat)
            for j in range(self.n_lon)
        ]

    def at(self, lon: float, lat: float) -> float:
        """Interpolation bilinéaire ; au-delà du bord, la valeur du bord."""
        fi = lat / self.step_lat - self.i0
        fj = lon / self.step_lon - self.j0
        a = min(self.n_lat - 2, max(0, math.floor(fi)))
        b = min(self.n_lon - 2, max(0, math.floor(fj)))
        u = min(1.0, max(0.0, fi - a))
        v = min(1.0, max(0.0, fj - b))
        z = self.values
        row, nxt = a * self.n_lon, (a + 1) * self.n_lon
        return (1.0 - u) * ((1.0 - v) * z[row + b] + v * z[row + b + 1]) + u * (
            (1.0 - v) * z[nxt + b] + v * z[nxt + b + 1]
        )

    def climb(self, coords: list[Coord]) -> float:
        """Somme des montées et des descentes le long d'une ligne."""
        total = 0.0
        prev = self.at(*coords[0])
        for c in coords[1:]:
            z = self.at(*c)
            total += abs(z - prev)
            prev = z
        return total


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
        values, coarse, local = answer
        # Un point que personne ne connaît n'est pas gardé : le mettre en cache
        # interdirait de le redemander le jour où un fournisseur l'aura. La
        # finesse, elle, est gardée avec la valeur : sans elle, un point relu du
        # cache retrouverait le seuil fin, et le tremblement avec lui.
        #
        # Ni ce que disent les tuiles gardées : elles le rediront sans réseau, et
        # l'IGN, s'il était rangé à leur place, ne serait plus jamais redemandé.
        fresh: dict[Coord, tuple[float, bool]] = {}
        for c, z, gros, lu in zip(missing, values, coarse, local):
            if z is not None:
                wanted[c] = (z, gros)
                if not lu:
                    fresh[c] = (z, gros)
        _cache.store(fresh)

    # Un tracé dont un seul point manque n'a pas de profil : mieux vaut
    # « D+ — » qu'un dénivelé calculé sur des trous. Les autres gardent le leur.
    #
    # Chaque tracé dit **si ses altitudes sont grossières** : le plus grossier
    # de ses points décide du lissage et du seuil (voir `shape_relief`).
    out: list[Relief | None] = []
    for coords in routes:
        if not coords:
            out.append(None)
            continue
        kept = [wanted.get(_round(c)) for c in coords]
        if any(v is None for v in kept):
            out.append(None)
            continue
        out.append(Relief(values=[v[0] for v in kept], coarse=any(v[1] for v in kept)))
    return out


async def _fetch_with_fallback(
    coords: list[Coord],
) -> tuple[list[float | None], list[bool], list[bool]] | None:
    """Chaque fournisseur complète ce que le précédent n'a pas su dire.

    Le second ne remplace pas le premier : il ne reçoit que les points restés
    sans réponse. Une boucle à cheval sur la frontière garde ainsi le mètre de
    l'IGN côté français et prend les vingt-cinq mètres d'OpenTopoData côté
    suisse — et OpenTopoData, limité à une requête par seconde, n'a que les
    points manquants à traiter au lieu de tous.

    Rend `None` si personne n'a rien su dire ; sinon les altitudes (à trous) et,
    point par point, si elles viennent d'un modèle grossier, puis des tuiles
    gardées sur l'appareil.
    """
    values: list[float | None] = [None] * len(coords)
    # Quels points viennent d'un modèle grossier : c'est ce qui décide du seuil.
    coarse = [False] * len(coords)
    local = [False] * len(coords)
    todo = list(range(len(coords)))

    # Les tuiles gardées passent avant le service mondial : elles répondent
    # sans réseau, et mieux que lui (−1 % de D+ contre −2 %).
    for provider in (settings.elevation_provider, "terrain", settings.elevation_fallback):
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
                local[index] = provider == "terrain"
        todo = rest

    return None if len(todo) == len(coords) else (values, coarse, local)


async def _fetch(provider: str, coords: list[Coord]) -> list[float | None]:
    if provider == "terrain":
        return terrain_values(coords, _disk_tile)

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


# --- Terrain Tiles ----------------------------------------------------------


def decode_png(data: bytes) -> list[bytearray]:
    """Les lignes RGB d'un PNG 8 bits sans entrelacement, filtres défaits.

    À la main (zlib et les cinq filtres de ligne) : Pillow, pour lire trois
    octets par pixel, serait une dépendance de trop — et le moteur de l'app
    fait le même décodage, octet pour octet.
    """
    if data[:8] != b"\x89PNG\r\n\x1a\n":
        raise ValueError("pas un PNG")
    pos, idat = 8, b""
    width = height = channels = 0
    while pos < len(data):
        length, kind = struct.unpack(">I4s", data[pos : pos + 8])
        body = data[pos + 8 : pos + 8 + length]
        if kind == b"IHDR":
            width, height, depth, color, _c, _f, interlace = struct.unpack(">IIBBBBB", body)
            if depth != 8 or interlace != 0 or color not in (2, 6):
                raise ValueError("PNG inattendu")
            channels = 3 if color == 2 else 4
        elif kind == b"IDAT":
            idat += body
        pos += 12 + length
    raw = zlib.decompress(idat)
    stride = width * channels
    rows: list[bytearray] = []
    prev = bytearray(stride)
    for y in range(height):
        start = y * (stride + 1)
        kind, line = raw[start], bytearray(raw[start + 1 : start + 1 + stride])
        for i in range(stride):
            a = line[i - channels] if i >= channels else 0
            b = prev[i]
            c = prev[i - channels] if i >= channels else 0
            if kind == 1:
                line[i] = (line[i] + a) & 255
            elif kind == 2:
                line[i] = (line[i] + b) & 255
            elif kind == 3:
                line[i] = (line[i] + (a + b) // 2) & 255
            elif kind == 4:
                p = a + b - c
                pa, pb, pc = abs(p - a), abs(p - b), abs(p - c)
                line[i] = (line[i] + (a if pa <= pb and pa <= pc else b if pb <= pc else c)) & 255
        rows.append(line)
        prev = line
    if channels == 4:
        rows = [bytearray(v for k, v in enumerate(r) if k % 4 != 3) for r in rows]
    return rows


def terrarium_grid(data: bytes) -> list[list[float]]:
    """Les altitudes d'une tuile : R × 256 + G + B / 256 − 32768."""
    return [
        [r[i] * 256 + r[i + 1] + r[i + 2] / 256 - 32768 for i in range(0, len(r), 3)]
        for r in decode_png(data)
    ]


def terrarium_pixel(lon: float, lat: float, z: int = TERRAIN_ZOOM) -> tuple[float, float]:
    """La position en pixels du monde entier au zoom `z`, centres de pixels à .0."""
    n = 2**z * 256
    gx = (lon + 180) / 360 * n - 0.5
    s = math.sin(math.radians(lat))
    gy = (0.5 - math.log((1 + s) / (1 - s)) / (4 * math.pi)) * n - 0.5
    return gx, gy


def terrain_values(
    coords: list[Coord],
    tile: Callable[[int, int, int], list[list[float]] | None],
    z: int = TERRAIN_ZOOM,
) -> list[float | None]:
    """L'altitude de chaque point, interpolée entre les quatre centres de pixels
    voisins — comme le relief de MapLibre —, par-delà le bord de tuile s'il le
    faut. `tile(z, x, y)` rend la grille d'une tuile, ou `None` si elle n'est
    pas là : le point reste alors sans réponse, pour le fournisseur suivant."""
    grids: dict[tuple[int, int], list[list[float]] | None] = {}

    def px(x: int, y: int) -> float | None:
        key = (x // 256, y // 256)
        if key not in grids:
            grids[key] = tile(z, key[0], key[1])
        grid = grids[key]
        return None if grid is None else grid[y % 256][x % 256]

    out: list[float | None] = []
    for lon, lat in coords:
        gx, gy = terrarium_pixel(lon, lat, z)
        x0, y0 = math.floor(gx), math.floor(gy)
        u, v = gx - x0, gy - y0
        a, b = px(x0, y0), px(x0 + 1, y0)
        c, d = px(x0, y0 + 1), px(x0 + 1, y0 + 1)
        if a is None or b is None or c is None or d is None:
            out.append(None)
            continue
        top = (1 - u) * a + u * b
        bottom = (1 - u) * c + u * d
        out.append((1 - v) * top + v * bottom)
    return out


def _disk_tile(z: int, x: int, y: int) -> list[list[float]] | None:
    """Une tuile gardée dans `cache/terrarium/`, ou rien : jamais le réseau."""
    try:
        return terrarium_grid((TERRAIN_DIR / str(z) / str(x) / f"{y}.png").read_bytes())
    except (OSError, ValueError, zlib.error, struct.error):
        return None


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
                    # venaient d'une époque à source unique, donc fine. Relu du
                    # disque, le couple est une liste ; tout juste rangé, un
                    # tuple — à n'emballer ni l'un ni l'autre.
                    out[c] = tuple(value) if isinstance(value, (list, tuple)) else (value, False)
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


def shape_relief(relief: Relief, step_m: float) -> tuple[list[float], float]:
    """Les altitudes d'un tracé échantillonné tous les `step_m` mètres, prêtes à
    compter : lissées selon la finesse de leur source, et le seuil qui leur
    convient."""
    if relief.coarse:
        return smooth_along(relief.values, step_m, COARSE_KERNEL_M), COARSE_THRESHOLD_M
    return smooth_along(relief.values, step_m, FINE_KERNEL_M), settings.ascent_threshold_m


def smooth_along(elevations: list[float], step_m: float, kernel_m: float) -> list[float]:
    """Lissage triangulaire le long du tracé : un voisin à `d` mètres pèse
    `1 − d / kernel_m`, et plus rien au-delà du noyau. Aux deux bouts, le noyau
    tronqué est renormalisé.

    Triangle et non gaussienne, et sommes faites une à une dans l'ordre : sans
    exponentielle ni `sum` compensée, le résultat est le même au bit près que
    celui du moteur JavaScript.
    """
    reach = math.floor(kernel_m / step_m)
    if reach < 1 or len(elevations) < 3:
        return list(elevations)
    weights = [1 - (k * step_m) / kernel_m for k in range(reach + 1)]
    out: list[float] = []
    n = len(elevations)
    for i in range(n):
        total_z = 0.0
        total_w = 0.0
        for k in range(-reach, reach + 1):
            j = i + k
            if j < 0 or j >= n:
                continue
            w = weights[abs(k)]
            total_z += elevations[j] * w
            total_w += w
        out.append(total_z / total_w)
    return out
