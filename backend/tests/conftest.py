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
) -> dict:
    """Damier `size` × `size` de rues résidentielles avec trottoirs.

    `dangerous_row` remplace une ligne horizontale par une départementale nue,
    ce qui permet de vérifier que le portail L3 l'écarte.
    """
    street = tags or {"highway": "residential", "sidewalk": "both", "maxspeed": "50"}
    # `maxspeed` explicite : le damier est couvert par un polygone `landuse`,
    # donc sans lui la voie serait plafonnée à 50 km/h — la limite légale en
    # agglomération — et ne serait plus dangereuse du tout.
    danger = dangerous_tags or {"highway": "secondary", "maxspeed": "80"}

    elements: list[dict] = []
    way_id = 1

    # lignes horizontales
    for iy in range(size):
        row_tags = danger if iy == dangerous_row else street
        elements.append(
            {
                "type": "way",
                "id": way_id,
                "tags": dict(row_tags),
                "nodes": [_node_id(ix, iy) for ix in range(size)],
                "geometry": [_coord(ix, iy) for ix in range(size)],
            }
        )
        way_id += 1

    # colonnes verticales
    for ix in range(size):
        elements.append(
            {
                "type": "way",
                "id": way_id,
                "tags": dict(street),
                "nodes": [_node_id(ix, iy) for iy in range(size)],
                "geometry": [_coord(ix, iy) for iy in range(size)],
            }
        )
        way_id += 1

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

    return {"elements": elements}


@pytest.fixture
def grid() -> dict:
    return grid_payload()


@pytest.fixture
def grid_center() -> tuple[float, float]:
    """(lon, lat) du centre du damier 9 × 9."""
    return (ORIGIN_LON + 4 * STEP, ORIGIN_LAT + 4 * STEP)
