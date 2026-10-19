"""L'indice vert et les sentiers balisés : ce que le routage préfère quand on veut de la nature.

Protège trois choses : qu'une rue dans un parc ou au bord de l'eau soit vue
comme telle (et une rue loin de tout, non), qu'un multipolygone livré en
morceaux soit rempli quand même, et que le bonus ne profite jamais à une voie
exposée.
"""

from __future__ import annotations

from tests.conftest import ORIGIN_LAT, ORIGIN_LON, STEP, grid_payload

from app.models import SafetyMode, SurfacePref
from app.osm.extract import from_cache, read, to_cache
from app.osm.graph import build_graph
from app.routing.weights import GREEN_BONUS, MARKED_BONUS, build_profile


def _edges_at(graph, test):
    """Les arêtes dont le milieu vérifie `test(fx, fy)`, en pas du damier."""
    out = []
    for edge in graph.edges:
        lon = (edge.coords[0][0] + edge.coords[-1][0]) / 2
        lat = (edge.coords[0][1] + edge.coords[-1][1]) / 2
        if test((lon - ORIGIN_LON) / STEP, (lat - ORIGIN_LAT) / STEP):
            out.append(edge)
    assert out
    return out


def test_un_parc_en_morceaux_est_rempli():
    graph = build_graph(grid_payload(9, nature=True))
    # Au cœur du parc, à plus de 100 m de son contour : seul le remplissage le voit.
    inside = _edges_at(graph, lambda fx, fy: fx > 6 and fy > 6)
    assert all(e.green > 0.999 for e in inside)
    # Au sud-ouest, loin du parc comme de la rivière.
    far = _edges_at(graph, lambda fx, fy: fx < 4 and 2.5 < fy < 4)
    assert all(e.green == 0.0 for e in far)


def test_la_rue_qui_longe_la_riviere_est_verte():
    graph = build_graph(grid_payload(9, nature=True))
    bank = _edges_at(graph, lambda fx, fy: abs(fy - 1) < 0.01 and 1 < fx < 7)
    assert all(e.green > 0.999 for e in bank)


def test_le_sentier_balise_est_reconnu():
    graph = build_graph(grid_payload(9, nature=True))
    marked = {e.way_id for e in graph.edges if e.marked}
    assert marked == {10}  # la première colonne


def test_rien_sans_donnees():
    graph = build_graph(grid_payload(9))
    assert all(e.green == 0.0 and not e.marked for e in graph.edges)


def test_le_cache_garde_le_vert():
    extract = read(grid_payload(9, nature=True))
    again = from_cache(to_cache(extract))
    assert [a.rings for a in again.green] == [a.rings for a in extract.green]
    assert again.marked == extract.marked == {10}


def test_le_bonus_reste_borne_et_epargne_les_voies_exposees():
    graph = build_graph(grid_payload(9, nature=True, dangerous_row=1))
    profile = build_profile(SurfacePref.mixed, SafetyMode.safe, night=False)
    plain = build_profile(SurfacePref.mixed, SafetyMode.safe, night=False, nature=False)
    for edge in graph.edges:
        ratio = profile.weight(edge) / plain.weight(edge)
        assert 1 - GREEN_BONUS - MARKED_BONUS - 1e-12 <= ratio <= 1.0
        if edge.safety.risk >= 1.5:
            assert ratio == 1.0
    # La départementale longe la rivière : verte, mais sans bonus.
    assert any(e.green > 0.999 and e.safety.risk >= 1.5 for e in graph.edges)
    assert profile.min_factor == plain.min_factor * (1 - GREEN_BONUS - MARKED_BONUS)
