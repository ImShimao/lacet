"""L'indice vert : la part de chaque arête qui longe un parc, un bois ou l'eau.

C'est l'équivalent libre de la carte de chaleur de Strava — que Lacet ne peut
pas copier, faute de millions d'activités — et de la préférence « nature » de
Trail Router, qui fait de même avec OpenStreetMap. On court volontiers le long
d'une rivière ou en lisière de forêt ; le moteur doit le savoir.

**Une grille plutôt que des distances.** Mesurer, pour chaque point de chaque
arête, la distance au polygone le plus proche coûterait des millions de calculs
de distance à un segment. Les zones vertes sont donc peintes une fois sur une
grille de `CELL_M` mètres — leur contour comme un trait, leur intérieur ligne
par ligne —, la grille est épaissie de `REACH_CELLS` cases de chaque côté, et
chaque arête n'a plus qu'à y lire, tous les `SAMPLE_M` mètres, si elle est à
portée. Tout y est arithmétique simple, sans trigonométrie hors de la
projection : `frontend/src/engine/green.js` en est le portage au bit près.

**Les multipolygones sans assemblage.** Une grande forêt est une relation dont
le contour arrive en dizaines de morceaux, extérieurs et trous mêlés. Les
recoudre en anneaux est inutile : une ligne horizontale coupe un contour fermé
un nombre pair de fois quel que soit son découpage, et compter les coupures de
tous les morceaux ensemble suffit à savoir ce qui est dedans — trous compris.
"""

from __future__ import annotations

import math

from ..geo import Coord
from .extract import GreenArea

# Une case de 50 m, épaissie de deux cases : une arête compte comme verte à
# moins de 100 à 125 m d'un parc ou d'une rive (141 m en diagonale). C'est la
# portée de `green_index` d'openrouteservice, et ce qu'on voit en courant : une
# lisière à une rue de là. Une case de 25 m quadruplerait la grille pour une
# précision que les contours d'OSM n'ont pas.
CELL_M = 50.0
REACH_CELLS = 2
# Un échantillon tous les 25 m : deux par case, assez pour qu'une arête qui ne
# fait que croiser un pont ne soit pas comptée verte sur toute sa longueur.
SAMPLE_M = 25.0


def green_index(paths: list[list[Coord]], areas: list[GreenArea], origin: Coord) -> list[float]:
    """Pour chaque géométrie de `paths`, la part de sa longueur près du vert (0 à 1)."""
    if not areas or not paths:
        return [0.0] * len(paths)

    # La grille est calée sur le degré entier le plus proche, pas sur l'origine
    # du graphe : la première voie d'un extrait dépend de l'ordre d'arrivée des
    # tuiles, et une grille qui glisse avec elle donnait à la même rue un indice
    # différent d'une recherche à l'autre — mesuré à Beaune : 0,6 % d'écart sur
    # la somme. Le plus proche et non l'inférieur : Beaune est à cheval sur le
    # 47ᵉ parallèle. `floor(x + 0,5)` plutôt que `round`, qui arrondit au pair.
    ox = math.floor(origin[0] + 0.5)
    oy = math.floor(origin[1] + 0.5)
    kx = 111_320.0 * math.cos(math.radians(oy))
    ky = 110_540.0

    def project(coords: list[Coord]) -> list[tuple[float, float]]:
        return [((lon - ox) * kx, (lat - oy) * ky) for lon, lat in coords]

    projected = [project(path) for path in paths]

    # La grille couvre les arêtes, et la portée autour : une forêt qui s'étend
    # à vingt kilomètres n'est peinte que là où l'on passe.
    gx0 = gy0 = math.inf
    gx1 = gy1 = -math.inf
    for path in projected:
        for x, y in path:
            cx = int(x // CELL_M)
            cy = int(y // CELL_M)
            gx0 = min(gx0, cx)
            gx1 = max(gx1, cx)
            gy0 = min(gy0, cy)
            gy1 = max(gy1, cy)
    gx0 -= REACH_CELLS
    gy0 -= REACH_CELLS
    gx1 += REACH_CELLS
    gy1 += REACH_CELLS
    width = gx1 - gx0 + 1
    height = gy1 - gy0 + 1

    # Une ligne de la grille est un entier, une case un bit : épaissir la
    # grille se fait alors en quelques décalages par ligne.
    rows = [0] * height

    def mark(x: float, y: float) -> None:
        cx = int(x // CELL_M) - gx0
        cy = int(y // CELL_M) - gy0
        if 0 <= cx < width and 0 <= cy < height:
            rows[cy] |= 1 << cx

    for area in areas:
        rings = [project(ring) for ring in area.rings]

        # Le contour, comme un trait : c'est tout ce qu'est une rivière, et ce
        # qui garde un square plus petit qu'une case.
        for ring in rings:
            if not ring:
                continue
            mark(*ring[0])
            for (px, py), (qx, qy) in zip(ring, ring[1:]):
                dx = qx - px
                dy = qy - py
                n = max(1, math.ceil(math.sqrt(dx * dx + dy * dy) / (CELL_M / 2)))
                for k in range(1, n + 1):
                    t = k / n
                    mark(px + dx * t, py + dy * t)

        if not area.fill:
            continue

        # L'intérieur, ligne par ligne : où le centre des cases de chaque ligne
        # coupe-t-il le contour ? Le test est celui de `point_in_ring`, demi-
        # ouvert, pour qu'un sommet partagé par deux morceaux ne compte qu'une fois.
        cuts: dict[int, list[float]] = {}
        for ring in rings:
            for (px, py), (qx, qy) in zip(ring, ring[1:]):
                lo = min(py, qy)
                hi = max(py, qy)
                first = max(gy0, math.floor(lo / CELL_M) - 1)
                last = min(gy1, math.floor(hi / CELL_M) + 1)
                for cy in range(first, last + 1):
                    yc = (cy + 0.5) * CELL_M
                    if (py > yc) != (qy > yc):
                        cuts.setdefault(cy, []).append(px + (qx - px) * (yc - py) / (qy - py))

        for cy, xs in cuts.items():
            xs.sort()
            for i in range(0, len(xs) - 1, 2):
                c0 = max(gx0, math.ceil(xs[i] / CELL_M - 0.5))
                c1 = min(gx1, math.ceil(xs[i + 1] / CELL_M - 0.5) - 1)
                if c0 <= c1:
                    rows[cy - gy0] |= ((1 << (c1 - c0 + 1)) - 1) << (c0 - gx0)

    # L'épaississement : `REACH_CELLS` cases de chaque côté, puis au-dessus et
    # au-dessous.
    wide = []
    for row in rows:
        out = row
        for k in range(1, REACH_CELLS + 1):
            out |= (row << k) | (row >> k)
        wide.append(out)
    near = []
    for cy in range(height):
        out = 0
        for k in range(max(0, cy - REACH_CELLS), min(height, cy + REACH_CELLS + 1)):
            out |= wide[k]
        near.append(out)

    out: list[float] = []
    for path in projected:
        total = 0.0
        green = 0.0
        for (px, py), (qx, qy) in zip(path, path[1:]):
            dx = qx - px
            dy = qy - py
            length = math.sqrt(dx * dx + dy * dy)
            n = max(1, math.ceil(length / SAMPLE_M))
            piece = length / n
            total += length
            for k in range(n):
                t = (k + 0.5) / n
                cx = int((px + dx * t) // CELL_M) - gx0
                cy = int((py + dy * t) // CELL_M) - gy0
                if 0 <= cy < height and 0 <= cx < width and (near[cy] >> cx) & 1:
                    green += piece
        out.append(green / total if total > 0 else 0.0)
    return out
