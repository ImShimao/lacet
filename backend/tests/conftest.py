"""Fabrique de données OSM synthétiques.

On construit une petite ville en damier plutôt que d'appeler Overpass : les
tests doivent tourner hors ligne et de façon déterministe.
"""

from __future__ import annotations

import pytest

# ~111 m par 0,001° de latitude ; on prend la même valeur en longitude pour
# simplifier — l'erreur est sans conséquence sur un damier de test.
STEP = 0.0015  # ≈ 165 m
ORIGIN_LAT = 48.8000
ORIGIN_LON = 2.3000


def _node_id(ix: int, iy: int) -> int:
    return 1_000_000 + iy * 1_000 + ix


def _coord(ix: int, iy: int) -> dict[str, float]:
    return {"lat": ORIGIN_LAT + iy * STEP, "lon": ORIGIN_LON + ix * STEP}


def grid_payload(
    size: int = 9,
    *,
    tags: dict[str, str] | None = None,
    dangerous_row: int | None = None,
    dangerous_tags: dict[str, str] | None = None,
    nature: bool = False,
    roundabout: bool = False,
) -> dict:
    """Damier `size` × `size` de rues résidentielles avec trottoirs.

    `dangerous_row` remplace une ligne horizontale par une départementale nue,
    ce qui permet de vérifier que le portail L3 l'écarte.

    `nature` ajoute un parc sur le quart nord-est — un multipolygone, en deux
    morceaux de contour —, une rivière qui longe la deuxième rue horizontale et
    un sentier balisé sur la première colonne.

    `roundabout` remplace le carrefour central par un rond-point : un anneau de
    quatre nœuds, à ~25 m du centre, dessiné comme OpenStreetMap le fait, dans
    le sens de la circulation — sud, est, nord, ouest.
    """
    street = tags or {"highway": "residential", "sidewalk": "both", "maxspeed": "50"}
    # `maxspeed` explicite : le damier est couvert par un polygone `landuse`,
    # donc sans lui la voie serait plafonnée à 50 km/h — la limite légale en
    # agglomération — et ne serait plus dangereuse du tout.
    danger = dangerous_tags or {"highway": "secondary", "maxspeed": "80"}

    elements: list[dict] = []
    way_id = 1
    mid = size // 2 if roundabout else -1
    # Les nœuds de l'anneau : sud, est, nord, ouest.
    ring = {
        side: (3_000_001 + k, {"lat": ORIGIN_LAT + (mid + dy) * STEP, "lon": ORIGIN_LON + (mid + dx) * STEP})
        for k, (side, dx, dy) in enumerate(
            [("s", 0, -0.15), ("e", 0.15, 0), ("n", 0, 0.15), ("w", -0.15, 0)]
        )
    }

    def street_ways(tags_: dict, cells: list[tuple[int, int]], ends: tuple[str, str]) -> None:
        """Une rue du damier — en deux, de part et d'autre de l'anneau, s'il y en a un."""
        nonlocal way_id
        pieces = [cells]
        if (mid, mid) in cells:
            cut = cells.index((mid, mid))
            pieces = [cells[:cut] + [ends[0]], [ends[1]] + cells[cut + 1 :]]
        for piece in pieces:
            elements.append(
                {
                    "type": "way",
                    "id": way_id,
                    "tags": dict(tags_),
                    "nodes": [ring[p][0] if isinstance(p, str) else _node_id(*p) for p in piece],
                    "geometry": [ring[p][1] if isinstance(p, str) else _coord(*p) for p in piece],
                }
            )
            way_id += 1

    # lignes horizontales
    for iy in range(size):
        row_tags = danger if iy == dangerous_row else street
        street_ways(row_tags, [(ix, iy) for ix in range(size)], ("w", "e"))

    # colonnes verticales
    for ix in range(size):
        street_ways(street, [(ix, iy) for iy in range(size)], ("s", "n"))

    if roundabout:
        loop = ["s", "e", "n", "w", "s"]
        elements.append(
            {
                "type": "way",
                "id": 70_000,
                "tags": {**street, "junction": "roundabout", "name": "Rond-point du Centre"},
                "nodes": [ring[p][0] for p in loop],
                "geometry": [ring[p][1] for p in loop],
            }
        )

    # polygone de zone bâtie couvrant tout le damier
    span = (size - 1) * STEP
    elements.append(
        {
            "type": "way",
            "id": 90_000,
            "tags": {"landuse": "residential"},
            "geometry": [
                {"lat": ORIGIN_LAT - STEP, "lon": ORIGIN_LON - STEP},
                {"lat": ORIGIN_LAT - STEP, "lon": ORIGIN_LON + span + STEP},
                {"lat": ORIGIN_LAT + span + STEP, "lon": ORIGIN_LON + span + STEP},
                {"lat": ORIGIN_LAT + span + STEP, "lon": ORIGIN_LON - STEP},
                {"lat": ORIGIN_LAT - STEP, "lon": ORIGIN_LON - STEP},
            ],
        }
    )

    if nature:
        def at(fx: float, fy: float) -> dict[str, float]:
            return {"lat": ORIGIN_LAT + fy * STEP, "lon": ORIGIN_LON + fx * STEP}

        lo, hi = size * 0.6, size + 0.5
        elements.append({
            "type": "relation",
            "id": 1,
            "tags": {"type": "multipolygon", "leisure": "park"},
            "members": [
                {"type": "way", "ref": 80_001, "role": "outer",
                 "geometry": [at(lo, lo), at(hi, lo), at(hi, hi)]},
                {"type": "way", "ref": 80_002, "role": "outer",
                 "geometry": [at(hi, hi), at(lo, hi), at(lo, lo)]},
            ],
        })
        elements.append({
            "type": "way",
            "id": 80_003,
            "tags": {"waterway": "river"},
            "geometry": [at(-1, 0.8), at(size, 0.8)],
        })
        elements.append({
            "type": "relation",
            "id": 2,
            "tags": {"type": "route", "route": "hiking"},
            "members": [{"type": "way", "ref": size + 1, "role": ""}],
        })

    return {"elements": elements}


@pytest.fixture
def grid() -> dict:
    return grid_payload()


@pytest.fixture
def grid_center() -> tuple[float, float]:
    """(lon, lat) du centre du damier 9 × 9."""
    return (ORIGIN_LON + 4 * STEP, ORIGIN_LAT + 4 * STEP)
