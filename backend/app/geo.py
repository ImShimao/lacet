"""Primitives géométriques : distances, caps, bbox, point-dans-polygone.

Tout est en degrés décimaux WGS84. Les distances sortent en mètres.
"""

from __future__ import annotations

import math

EARTH_RADIUS_M = 6_371_008.8

Coord = tuple[float, float]  # (lon, lat) — ordre GeoJSON


def haversine_m(a: Coord, b: Coord) -> float:
    """Distance orthodromique entre deux points (lon, lat)."""
    lon1, lat1 = a
    lon2, lat2 = b
    p1 = math.radians(lat1)
    p2 = math.radians(lat2)
    dp = math.radians(lat2 - lat1)
    dl = math.radians(lon2 - lon1)
    h = math.sin(dp / 2) ** 2 + math.cos(p1) * math.cos(p2) * math.sin(dl / 2) ** 2
    return 2 * EARTH_RADIUS_M * math.asin(math.sqrt(min(1.0, h)))


def planar_distance(lat0: float):
    """Fabrique une fonction de distance rapide, valable localement.

    Projette en équirectangulaire autour de `lat0` : une racine carrée par appel,
    contre une dizaine d'opérations trigonométriques pour le haversine. Sur les
    centaines de milliers de segments d'un extrait de ville, la différence se
    compte en secondes.

    L'erreur reste sous 0,2 % tant qu'on ne s'écarte pas de plus d'une centaine
    de kilomètres de `lat0` — sans commune mesure avec l'imprécision du tracé
    OSM lui-même. Pour toute distance exposée à l'utilisateur ou comparée à un
    seuil serré, garder `haversine_m`.
    """
    kx = EARTH_RADIUS_M * math.cos(math.radians(lat0)) * math.pi / 180.0
    ky = EARTH_RADIUS_M * math.pi / 180.0

    def distance(a: Coord, b: Coord) -> float:
        dx = (a[0] - b[0]) * kx
        dy = (a[1] - b[1]) * ky
        return math.sqrt(dx * dx + dy * dy)

    return distance


def bearing_deg(a: Coord, b: Coord) -> float:
    """Cap de a vers b, en degrés depuis le nord (0-360)."""
    lon1, lat1 = a
    lon2, lat2 = b
    p1, p2 = math.radians(lat1), math.radians(lat2)
    dl = math.radians(lon2 - lon1)
    y = math.sin(dl) * math.cos(p2)
    x = math.cos(p1) * math.sin(p2) - math.sin(p1) * math.cos(p2) * math.cos(dl)
    return (math.degrees(math.atan2(y, x)) + 360.0) % 360.0


def bbox_around(lat: float, lon: float, radius_m: float) -> tuple[float, float, float, float]:
    """Boîte englobante (south, west, north, east) autour d'un point."""
    dlat = math.degrees(radius_m / EARTH_RADIUS_M)
    # Aux pôles cos(lat) tend vers 0 : on borne pour éviter une bbox infinie.
    cos_lat = max(0.01, math.cos(math.radians(lat)))
    dlon = math.degrees(radius_m / (EARTH_RADIUS_M * cos_lat))
    return (lat - dlat, lon - dlon, lat + dlat, lon + dlon)


def roundness(coords: list[Coord]) -> float:
    """Quotient isopérimétrique : 4πA / P². Entre 0 et 1.

    Vaut 1 pour un cercle parfait, ~0,61 pour un triangle équilatéral, ~0,79
    pour un carré, et tend vers 0 pour un aller-retour — dont l'aire est nulle.

    C'est la mesure qui distingue une vraie boucle d'une « sucette » : un long
    aller sur un trottoir, un petit tour au bout, et le retour par le trottoir
    d'en face. Techniquement le tracé ne se recoupe pas, donc le critère de
    recouvrement le laisse passer ; géométriquement, ce n'est pas une boucle.
    """
    if len(coords) < 3:  # un triangle est un polygone, une ligne n'en est pas un
        return 0.0

    lat0 = sum(c[1] for c in coords) / len(coords)
    lon0 = sum(c[0] for c in coords) / len(coords)
    kx = EARTH_RADIUS_M * math.cos(math.radians(lat0)) * math.pi / 180.0
    ky = EARTH_RADIUS_M * math.pi / 180.0
    # Coordonnées **centrées** sur le tracé. Projetées telles quelles, elles
    # valent quelques milliers de kilomètres : la formule du lacet soustrait
    # alors des produits de l'ordre de 10¹² pour obtenir une aire de 10⁷, et perd
    # huit chiffres significatifs en route. C'est le test de parité avec le
    # moteur JavaScript qui l'a révélé — un écart d'une unité de précision sur un
    # cosinus ressortait amplifié au neuvième chiffre de la rondeur. L'aire ne
    # dépend pas de l'origine : centrer ne change rien au résultat exact, et
    # rend le calcul stable.
    pts = [((c[0] - lon0) * kx, (c[1] - lat0) * ky) for c in coords]

    # Formule du lacet (shoelace) — l'aire orientée du polygone.
    area2 = 0.0
    perimeter = 0.0
    for i in range(len(pts)):
        x1, y1 = pts[i]
        x2, y2 = pts[(i + 1) % len(pts)]
        area2 += x1 * y2 - x2 * y1
        perimeter += math.hypot(x2 - x1, y2 - y1)

    if perimeter <= 0:
        return 0.0
    area = abs(area2) / 2.0
    return min(1.0, 4.0 * math.pi * area / (perimeter * perimeter))


# Le crochet en U, échantillonné tous les vingt mètres. Les écarts sont donnés
# en échantillons entiers et non en mètres : `round(12.5)` vaut 12 en Python et
# 13 en JavaScript, et la parité des deux moteurs n'y survivrait pas.
BACKTRACK_STEP_M = 20.0
BACKTRACK_NEAR_M = 40.0
BACKTRACK_GAP_MIN = 13  # 260 m : en deçà, c'est un virage serré, pas un crochet
BACKTRACK_GAP_MAX = 75  # 1,5 km : au-delà, c'est la boucle qui se referme
BACKTRACK_STEM = 10  # 200 m : la rue de la maison, prise à l'aller et au retour
BACKTRACK_OPPOSITE_DEG = 135.0


def backtrack_share(coords: list[Coord]) -> float:
    """Part du tracé qui revient sur ses pas par une voie voisine.

    Le crochet en U : aller au bout d'une branche, revenir par la rue d'à côté.
    Ce ne sont pas les mêmes rues, donc le recouvrement ne le voit pas ; la
    boucle reste ronde, donc la rondeur non plus. Mesuré sur les boucles de
    Beaune et de Lyon : une sur cinq en avait un, de 250 à 550 m — et c'est ce
    qu'on remarque en courant, un détour qui ne mène nulle part.

    Un point compte quand, entre 260 m et 1,5 km plus tôt, le tracé est passé à
    moins de 40 m dans l'autre sens. La rue du départ, prise à l'aller et au
    retour, ne compte pas : on ne choisit pas où l'on habite.
    """
    samples = [c for _, c in resample(coords, BACKTRACK_STEP_M)]
    n = len(samples)
    if n < BACKTRACK_GAP_MIN + 2:
        return 0.0
    heads = [bearing_deg(samples[k], samples[k + 1]) for k in range(n - 1)]
    hits = 0
    for j in range(BACKTRACK_GAP_MIN, n - 1):
        for i in range(j - BACKTRACK_GAP_MIN, max(-1, j - BACKTRACK_GAP_MAX - 1), -1):
            if i < BACKTRACK_STEM and j >= n - 1 - BACKTRACK_STEM:
                continue
            turn = abs((heads[i] - heads[j] + 180.0) % 360.0 - 180.0)
            if turn > BACKTRACK_OPPOSITE_DEG and haversine_m(samples[i], samples[j]) < BACKTRACK_NEAR_M:
                hits += 1
                break
    return hits / (n - 1)


def point_in_ring(pt: Coord, ring: list[Coord]) -> bool:
    """Ray casting. `ring` est une liste de (lon, lat), fermée ou non."""
    x, y = pt
    inside = False
    n = len(ring)
    if n < 3:
        return False
    j = n - 1
    for i in range(n):
        xi, yi = ring[i]
        xj, yj = ring[j]
        if (yi > y) != (yj > y):
            x_cross = (xj - xi) * (y - yi) / (yj - yi) + xi
            if x_cross > x:
                inside = not inside
        j = i
    return inside


def ring_bbox(ring: list[Coord]) -> tuple[float, float, float, float]:
    """(min_lon, min_lat, max_lon, max_lat)"""
    lons = [c[0] for c in ring]
    lats = [c[1] for c in ring]
    return (min(lons), min(lats), max(lons), max(lats))


def resample(coords: list[Coord], step_m: float) -> list[tuple[int, Coord]]:
    """Échantillonne un tracé tous les `step_m`.

    Rend une liste de (index du point d'origine le plus proche, coordonnée).
    Le premier et le dernier point sont toujours inclus.
    """
    if not coords:
        return []
    out: list[tuple[int, Coord]] = [(0, coords[0])]
    carried = 0.0
    for i in range(len(coords) - 1):
        a, b = coords[i], coords[i + 1]
        seg = haversine_m(a, b)
        if seg <= 0:
            continue
        pos = step_m - carried
        while pos < seg:
            t = pos / seg
            out.append((i, (a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t)))
            pos += step_m
        carried = (carried + seg) % step_m
    if out[-1][1] != coords[-1]:
        out.append((len(coords) - 1, coords[-1]))
    return out
