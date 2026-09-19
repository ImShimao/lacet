"""Découpe un extrait OpenStreetMap régional en tuiles embarquées dans l'app.

    python scripts/region_tiles.py alsace-latest.osm.pbf alsace.poly public/region --name Alsace

La première recherche dans une zone commençait par télécharger ses rues sur
Overpass : un serveur public, gratuit et souvent saturé, qui mettait de vingt
secondes à plusieurs minutes à répondre. Augmenter la distance au-delà de 25 km
recommençait l'attente. Pour la région où l'on court, ce téléchargement n'a
pas lieu d'être : les rues y sont préparées ici, une fois par semaine, sur un
serveur de GitHub, et livrées **dans l'app**. Une recherche y part tout de
suite, et même sans réseau.

**Mêmes voies qu'Overpass, à la tuile près.** Le moteur de l'app doit recevoir
exactement ce que lui aurait rendu sa requête (`src/engine/overpass.js`,
niveau de détail 0) : mêmes filtres, mêmes étiquettes, mêmes géométries. Les
filtres sont recopiés ici, et un test (`region.test.js`) vérifie qu'ils n'ont
pas divergé.

**Seules les tuiles entièrement dans la région sont livrées.** Une tuile à
cheval sur la limite n'aurait que la moitié de ses rues — l'autre moitié est
dans l'extrait voisin. Livrée, elle ferait proposer des boucles qui s'arrêtent
net à la frontière du département. Ces tuiles-là restent donc à Overpass.

**Un format serré.** Coordonnées en entiers de 1e-7 degré, et chaque point
écrit comme l'écart au précédent ; même chose pour les numéros de nœuds. Un
point de rue passe ainsi d'une vingtaine de caractères à cinq ou six.
"""

from __future__ import annotations

import argparse
import json
import math
import time
from collections import defaultdict
from pathlib import Path

import osmium

TILE_DEG = 0.05
EDGE = 1e-9

# Recopiés de `src/engine/overpass.js` — voir la docstring.
EXCLUDED_HIGHWAYS = "motorway|motorway_link|trunk|trunk_link|construction|proposed|raceway|bus_guideway|escape"
BUILTUP_LANDUSE = "residential|retail|commercial|industrial|education"
EXCLUDED_SERVICE = "parking_aisle|driveway|drive-through|slipway"

EXCLUDED = set(EXCLUDED_HIGHWAYS.split("|"))
BUILTUP = set(BUILTUP_LANDUSE.split("|"))
SERVICE = set(EXCLUDED_SERVICE.split("|"))


# --- la limite de la région ------------------------------------------------------


def read_poly(path: Path) -> tuple[list[list[tuple[float, float]]], list[list[tuple[float, float]]]]:
    """Anneaux extérieurs et trous d'un fichier `.poly` de Geofabrik."""
    outer, holes = [], []
    lines = [line.strip() for line in path.read_text(encoding="utf-8").splitlines()]
    i = 1  # la première ligne est le nom
    while i < len(lines):
        name = lines[i]
        i += 1
        if name == "END" or not name:
            continue
        ring = []
        while lines[i] != "END":
            lon, lat = lines[i].split()[:2]
            ring.append((float(lon), float(lat)))
            i += 1
        i += 1
        (holes if name.startswith("!") else outer).append(ring)
    return outer, holes


def inside_ring(lon: float, lat: float, ring: list[tuple[float, float]]) -> bool:
    inside = False
    j = len(ring) - 1
    for i in range(len(ring)):
        xi, yi = ring[i]
        xj, yj = ring[j]
        if (yi > lat) != (yj > lat) and lon < (xj - xi) * (lat - yi) / (yj - yi) + xi:
            inside = not inside
        j = i
    return inside


def inside(lon: float, lat: float, outer, holes) -> bool:
    return any(inside_ring(lon, lat, r) for r in outer) and not any(inside_ring(lon, lat, r) for r in holes)


def complete_tiles(outer, holes) -> set[tuple[int, int]]:
    """Les tuiles entièrement à l'intérieur de la limite.

    Quatre coins dedans ne suffisent pas : une limite en dents de scie peut
    entrer dans la tuile entre deux coins. On exige donc aussi qu'aucun sommet
    de la limite ne tombe dans la tuile.
    """
    vertices = [v for ring in outer + holes for v in ring]
    lons = [v[0] for v in vertices]
    lats = [v[1] for v in vertices]
    ix0, ix1 = math.floor(min(lons) / TILE_DEG), math.floor(max(lons) / TILE_DEG)
    iy0, iy1 = math.floor(min(lats) / TILE_DEG), math.floor(max(lats) / TILE_DEG)

    by_tile = defaultdict(int)
    for lon, lat in vertices:
        by_tile[(math.floor(lon / TILE_DEG), math.floor(lat / TILE_DEG))] += 1

    tiles = set()
    for ix in range(ix0, ix1 + 1):
        for iy in range(iy0, iy1 + 1):
            w, s = ix * TILE_DEG, iy * TILE_DEG
            corners = [(w, s), (w + TILE_DEG, s), (w, s + TILE_DEG), (w + TILE_DEG, s + TILE_DEG)]
            if by_tile[(ix, iy)] == 0 and all(inside(x, y, outer, holes) for x, y in corners):
                tiles.add((ix, iy))
    return tiles


# --- les données -------------------------------------------------------------------


def delta(values: list[int]) -> list[int]:
    return [values[0]] + [values[k] - values[k - 1] for k in range(1, len(values))]


def delta_pairs(xs: list[int], ys: list[int]) -> list[int]:
    out = [xs[0], ys[0]]
    for k in range(1, len(xs)):
        out.append(xs[k] - xs[k - 1])
        out.append(ys[k] - ys[k - 1])
    return out


def tiles_of(xs: list[int], ys: list[int], keep: set[tuple[int, int]]):
    """Les tuiles que touche l'emprise d'une géométrie — comme `splitIntoTiles`."""
    ix0 = math.floor((min(xs) / 1e7 - EDGE) / TILE_DEG)
    ix1 = math.floor((max(xs) / 1e7 + EDGE) / TILE_DEG)
    iy0 = math.floor((min(ys) / 1e7 - EDGE) / TILE_DEG)
    iy1 = math.floor((max(ys) / 1e7 + EDGE) / TILE_DEG)
    for ix in range(ix0, ix1 + 1):
        for iy in range(iy0, iy1 + 1):
            if (ix, iy) in keep:
                yield ix, iy


def build(pbf: Path, keep: set[tuple[int, int]]):
    """Parcourt l'extrait et range voies, polygones bâtis et traversées par tuile.

    Les filtres reproduisent ceux de la requête Overpass : une voie `highway`
    hors de la liste exclue, sans `service` exclu ni `area=yes` ; un polygone
    `landuse` bâti ; un nœud `highway=crossing`. Une voie qui porte à la fois
    `highway` et un `landuse` bâti est rangée comme voie — c'est ce que fait
    `fromOverpass` de la même voie revenue par la seconde requête.
    """
    ways = defaultdict(list)
    landuse = defaultdict(list)
    crossings = defaultdict(list)

    # Le filtre ne laisse remonter en Python que ce qui porte une de ces clés :
    # sur l'Alsace, quelques centaines de milliers d'objets au lieu de vingt
    # millions de nœuds. Les positions, elles, sont retenues avant le filtre.
    processor = (
        osmium.FileProcessor(str(pbf))
        .with_locations()
        .with_filter(osmium.filter.KeyFilter("highway", "landuse"))
    )
    for obj in processor:
        tags = {t.k: t.v for t in obj.tags}
        if obj.is_node():
            if tags.get("highway") == "crossing" and obj.location.valid():
                x, y = obj.location.x, obj.location.y
                tile = (math.floor(x / 1e7 / TILE_DEG), math.floor(y / 1e7 / TILE_DEG))
                if tile in keep:
                    crossings[tile].append([obj.id, x, y, tags])
            continue
        if not obj.is_way():
            continue

        highway = tags.get("highway")
        road = (
            highway is not None
            and highway not in EXCLUDED
            and tags.get("service") not in SERVICE
            and tags.get("area") != "yes"
        )
        built = tags.get("landuse") in BUILTUP
        if not road and not built:
            continue

        refs, xs, ys = [], [], []
        for node in obj.nodes:
            if not node.location.valid():
                continue
            refs.append(node.ref)
            xs.append(node.location.x)
            ys.append(node.location.y)
        if not xs:
            continue

        if highway is not None:
            record = [obj.id, tags, delta(refs), delta_pairs(xs, ys)]
            for tile in tiles_of(xs, ys, keep):
                ways[tile].append(record)
        else:
            record = [obj.id, delta_pairs(xs, ys)]
            for tile in tiles_of(xs, ys, keep):
                landuse[tile].append(record)

    return ways, landuse, crossings


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    parser.add_argument("pbf", type=Path)
    parser.add_argument("poly", type=Path)
    parser.add_argument("out", type=Path)
    parser.add_argument("--name", default="Région")
    args = parser.parse_args()

    started = time.time()
    outer, holes = read_poly(args.poly)
    keep = complete_tiles(outer, holes)
    ways, landuse, crossings = build(args.pbf, keep)

    args.out.mkdir(parents=True, exist_ok=True)
    written = []
    total = 0
    for tile in sorted(keep):
        if not ways[tile]:
            continue  # une tuile sans rue — lac, forêt sans chemin : Overpass dira pareil
        data = {
            "w": sorted(ways[tile], key=lambda r: r[0]),
            "l": sorted(landuse[tile], key=lambda r: r[0]),
            "c": sorted(crossings[tile], key=lambda r: r[0]),
        }
        text = json.dumps(data, ensure_ascii=False, separators=(",", ":"))
        (args.out / f"{tile[0]}_{tile[1]}.json").write_text(text, encoding="utf-8")
        written.append(f"{tile[0]}_{tile[1]}")
        total += len(text.encode("utf-8"))

    index = {
        "v": 3,
        "name": args.name,
        "builtAt": int(time.time() * 1000),
        "tileDeg": TILE_DEG,
        "tiles": written,
    }
    (args.out / "index.json").write_text(json.dumps(index, separators=(",", ":")), encoding="utf-8")
    print(
        f"{args.name} : {len(written)} tuiles, {total / 1e6:.1f} Mo, "
        f"{sum(len(ways[t]) for t in keep)} voies, en {time.time() - started:.0f} s"
    )


if __name__ == "__main__":
    main()
