"""Terrain Tiles d'AWS peuvent-elles remplacer l'IGN quand le réseau manque ?

    python scripts/terrain_tiles.py

Mesure seulement : le moteur n'est pas touché. Pour une quinzaine de boucles
réelles autour de Guebwiller et de Soultz (produites par `plan_loops`, donc par
Overpass et l'IGN), le script relit chaque profil — un point tous les 50 m,
comme l'app — dans les tuiles terrarium aux zooms 12, 13 et 14, puis compare :
écart d'altitude point à point, et D+ calculé exactement comme le moteur
(`shape_relief` puis `ascent_descent`), avec le réglage fin (noyau 60 m, seuil
1 m) et le grossier (100 m, 3 m).

Il estime aussi le poids des tuiles pour l'Alsace — la zone que le budget des
rues (`tilestore.js`, 250 Mo ≈ trois fois l'Alsace) est taillé pour garder —
en pesant un échantillon tiré au hasard à chaque zoom.

Les tuiles sont gardées dans `.cache/terrarium/` : le second passage ne
redemande que ce qui manque. Le PNG est décodé par `app.elevation`, qui lit ces
mêmes tuiles quand le réseau manque.
"""

from __future__ import annotations

import asyncio
import logging
import math
import random
import statistics
import sys
from pathlib import Path

import httpx

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from app.config import settings  # noqa: E402
from app.elevation import (  # noqa: E402
    BATCH,
    TERRAIN_DIR,
    TERRAIN_URL,
    Relief,
    _cache,
    _ign_batch,
    _round,
    ascent_descent,
    shape_relief,
    terrarium_grid,
)
from app.geo import resample  # noqa: E402
from app.models import ElevationPref, LoopRequest  # noqa: E402
from app.service import plan_loops  # noqa: E402

URL = TERRAIN_URL
# Le dossier où le moteur lit ses tuiles sans réseau : celles de la mesure
# servent ensuite au moteur de référence.
CACHE = TERRAIN_DIR
ZOOMS = (12, 13, 14)
STEP_M = settings.elevation_sample_m

DEPARTS = {
    "Guebwiller": (47.9097, 7.2108),
    "Soultz": (47.8875, 7.2297),
}
# Plat, vallonné, montagne : sans demande de relief, les boucles restent en
# plaine, et une source grossière n'y serait jamais prise en défaut.
DEMANDES = [
    (6, ElevationPref.flat),
    (10, ElevationPref.rolling),
    (14, ElevationPref.hilly),
]
# L'Alsace, à peu près : c'est la zone que garde le budget des rues.
ALSACE = (6.84, 47.42, 8.24, 49.08)  # ouest, sud, est, nord
ECHANTILLON = 40  # tuiles pesées par zoom


# --- tuiles terrarium -------------------------------------------------------


class Tiles:
    """Les tuiles d'un zoom, lues sur le disque ou le réseau, et leur poids."""

    def __init__(self, client: httpx.AsyncClient) -> None:
        self.client = client
        self.grids: dict[tuple[int, int, int], list[list[float]]] = {}
        self.bytes: dict[tuple[int, int, int], int] = {}

    async def raw(self, z: int, x: int, y: int) -> bytes:
        path = CACHE / str(z) / str(x) / f"{y}.png"
        if path.exists():
            data = path.read_bytes()
        else:
            resp = await self.client.get(URL.format(z=z, x=x, y=y))
            resp.raise_for_status()
            data = resp.content
            path.parent.mkdir(parents=True, exist_ok=True)
            path.write_bytes(data)
        self.bytes[(z, x, y)] = len(data)
        return data

    async def load(self, z: int, x: int, y: int) -> list[list[float]]:
        key = (z, x, y)
        if key not in self.grids:
            self.grids[key] = terrarium_grid(await self.raw(z, x, y))
        return self.grids[key]

    async def at(self, z: int, lon: float, lat: float) -> float:
        """Interpolation bilinéaire entre centres de pixels, au-delà des bords
        de tuile s'il le faut — comme le relief de MapLibre."""
        n = 2**z * 256
        gx = (lon + 180) / 360 * n - 0.5
        s = math.sin(math.radians(lat))
        gy = (0.5 - math.log((1 + s) / (1 - s)) / (4 * math.pi)) * n - 0.5
        x0, y0 = math.floor(gx), math.floor(gy)
        u, v = gx - x0, gy - y0

        async def px(x: int, y: int) -> float:
            grid = await self.load(z, x // 256, y // 256)
            return grid[y % 256][x % 256]

        top = (1 - u) * await px(x0, y0) + u * await px(x0 + 1, y0)
        bottom = (1 - u) * await px(x0, y0 + 1) + u * await px(x0 + 1, y0 + 1)
        return (1 - v) * top + v * bottom


def tile_xy(z: int, lon: float, lat: float) -> tuple[int, int]:
    n = 2**z
    s = math.sin(math.radians(lat))
    return (
        int((lon + 180) / 360 * n),
        int((0.5 - math.log((1 + s) / (1 - s)) / (4 * math.pi)) * n),
    )


# --- mesure -----------------------------------------------------------------


def climb(values: list[float], coarse: bool) -> float:
    """Le D+ que le moteur afficherait pour ces altitudes."""
    elevations, threshold = shape_relief(Relief(values, coarse), STEP_M)
    return ascent_descent(elevations, threshold)[0]


async def boucles() -> list[tuple[str, list[tuple[float, float]]]]:
    out = []
    for ville, (lat, lon) in DEPARTS.items():
        for km, pref in DEMANDES:
            req = LoopRequest(lat=lat, lon=lon, distance_km=km, elevation=pref, limit=3)
            result = await plan_loops(req)
            for route in result.routes[:2]:
                label = f"{ville} {route.distance_m / 1000:4.1f} km {pref.value:<7}"
                pts = [c for _i, c in resample([tuple(c) for c in route.geometry], STEP_M)]
                out.append((label, pts))
    return out


async def ign_reference(routes: list[list[tuple[float, float]]]) -> list[list[float] | None]:
    """L'altitude IGN de chaque point, et rien d'autre.

    `fetch_many` envoie tous ses lots à la fois ; sur une quinzaine de boucles,
    l'IGN répond alors « 429 » et la moitié des points passe par le repli — la
    référence ne serait plus l'IGN. Ici, un lot après l'autre, avec reprise. Le
    cache disque sert, mais seulement pour des valeurs fines : un point rangé
    par OpenTopoData pendant `plan_loops` est redemandé.
    """
    wanted = {_round(c) for pts in routes for c in pts}
    known = {c: v[0] for c, v in _cache.lookup(list(wanted)).items() if not v[1]}
    missing = [c for c in wanted if c not in known]
    async with httpx.AsyncClient(timeout=30) as client:
        for i in range(0, len(missing), BATCH):
            batch = missing[i : i + BATCH]
            for attempt in range(6):
                try:
                    values = await _ign_batch(client, batch)
                    break
                except httpx.HTTPStatusError as exc:
                    if exc.response.status_code != 429 or attempt == 5:
                        raise
                    await asyncio.sleep(2**attempt)
            fresh = {c: (z, False) for c, z in zip(batch, values) if z is not None}
            _cache.store(fresh)
            known.update({c: v[0] for c, v in fresh.items()})
            await asyncio.sleep(0.3)
    out = []
    for pts in routes:
        vals = [known.get(_round(c)) for c in pts]
        out.append(None if any(v is None for v in vals) else vals)
    return out


def pct(values: list[float], q: float) -> float:
    ordered = sorted(values)
    return ordered[min(len(ordered) - 1, int(q * len(ordered)))]


async def main() -> int:
    # La console de Windows n'écrit pas « ⚠ » en cp1252.
    sys.stdout.reconfigure(encoding="utf-8")
    # Les « 429 » de l'IGN pendant `plan_loops` sont attendus (le repli prend
    # le relais) et noieraient le rapport sous des URL de deux mille signes.
    logging.disable(logging.WARNING)
    loops = await boucles()
    print(f"\n  {len(loops)} boucles, un point tous les {STEP_M:.0f} m\n")
    reliefs = await ign_reference([pts for _l, pts in loops])
    kept = [(l, p, r) for (l, p), r in zip(loops, reliefs) if r]
    if len(kept) < len(loops):
        print(f"  ⚠ {len(loops) - len(kept)} boucle(s) sans altitude IGN complète, écartée(s)\n")

    async with httpx.AsyncClient(timeout=30) as client:
        tiles = Tiles(client)
        aws: dict[int, list[list[float]]] = {
            z: [[await tiles.at(z, lon, lat) for lon, lat in pts] for _l, pts, _v in kept]
            for z in ZOOMS
        }

        # D+ boucle par boucle, au réglage grossier : celui qu'aurait une source à 25 m
        print(f"  {'boucle':<34}{'D+ IGN':>8}" + "".join(f"{'z' + str(z):>14}" for z in ZOOMS))
        for k, (label, _pts, ign) in enumerate(kept):
            ref = climb(ign, False)
            cells = []
            for z in ZOOMS:
                d = climb(aws[z][k], True) - ref
                cells.append(f"{d:+6.0f} m {d / ref * 100 if ref else 0:+4.0f}%")
            print(f"  {label:<34}{ref:6.0f} m" + "".join(f"{c:>14}" for c in cells))

        # Bilan par zoom et par réglage
        print("\n  Bilan par zoom")
        for z in ZOOMS:
            diffs = [a - b for k, (_l, _p, ign) in enumerate(kept) for a, b in zip(aws[z][k], ign)]
            absd = [abs(d) for d in diffs]
            print(
                f"  z{z} altitude : biais {statistics.fmean(diffs):+.1f} m · "
                f"écart moyen {statistics.fmean(absd):.1f} m · "
                f"p95 {pct(absd, 0.95):.1f} m · max {max(absd):.0f} m"
            )
            for coarse, nom in ((False, "fin 60 m / 1 m"), (True, "grossier 100 m / 3 m")):
                refs = [climb(ign, False) for _l, _p, ign in kept]
                gots = [climb(aws[z][k], coarse) for k in range(len(kept))]
                rel = [abs(g - r) / r * 100 for g, r in zip(gots, refs) if r > 0]
                print(
                    f"      D+ {nom:<20}: total {(sum(gots) - sum(refs)) / sum(refs) * 100:+.0f} % · "
                    f"par boucle {statistics.fmean(rel):.0f} % (pire {max(rel):.0f} %) · "
                    f"écart moyen {statistics.fmean(abs(g - r) for g, r in zip(gots, refs)):.0f} m"
                )

        # Poids : ce que ces boucles ont lu, puis l'Alsace par échantillon
        print("\n  Poids des tuiles")
        rng = random.Random(4)
        w, s, e, n = ALSACE
        for z in ZOOMS:
            lues = [b for (zz, _x, _y), b in tiles.bytes.items() if zz == z]
            x0, y1 = tile_xy(z, w, s)
            x1, y0 = tile_xy(z, e, n)
            count = (x1 - x0 + 1) * (y1 - y0 + 1)
            sample = [
                (rng.randint(x0, x1), rng.randint(y0, y1)) for _ in range(min(ECHANTILLON, count))
            ]
            sizes = [len(await tiles.raw(z, x, y)) for x, y in sample]
            mean = statistics.fmean(sizes)
            print(
                f"  z{z} : boucles {len(lues)} tuiles, {sum(lues) / 1e6:.1f} Mo · "
                f"Alsace {count} tuiles × {mean / 1e3:.0f} ko ≈ {count * mean / 1e6:.0f} Mo"
            )
    print()
    return 0


if __name__ == "__main__":
    raise SystemExit(asyncio.run(main()))
