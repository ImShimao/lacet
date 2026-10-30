"""Le rond-point, à pied et à vélo.

À pied, on ne court pas sur l'anneau : on en fait le tour par le trottoir, d'un
côté ou de l'autre. Le chemin le plus court le prenait dans n'importe quel sens,
et la voix découpait son passage en virages — « tourne à droite puis tout de
suite à gauche » pour aller en face. Ces tests protègent le côté choisi
(`keep_side`) et la phrase unique dite à l'entrée.
"""

from __future__ import annotations

import pytest

from app.models import SafetyMode, Side, Sport, SurfacePref
from app.navigation import build_instructions
from app.osm.graph import build_graph
from app.routing.dijkstra import node_sequence
from app.routing.loops import Candidate, keep_side, measure
from app.routing.weights import build_profile
from tests.conftest import ORIGIN_LAT, ORIGIN_LON, STEP, grid_payload

MID = 4


def _profile(side: Side = Side.right, sport: Sport = Sport.run):
    return build_profile(SurfacePref.mixed, SafetyMode.safe, night=False, sport=sport, side=side)


def _node(graph, fx: float, fy: float) -> int:
    node = graph.nearest_node(ORIGIN_LON + fx * STEP, ORIGIN_LAT + fy * STEP, max_radius_m=5.0)
    assert node is not None
    return node


def _edge(graph, u: int, v: int) -> int:
    return next(e for e in graph.adj[u] if graph.edges[e].other(u) == v)


def _path(graph, *points: tuple[float, float]) -> tuple[int, list[int]]:
    nodes = [_node(graph, *p) for p in points]
    return nodes[0], [_edge(graph, u, v) for u, v in zip(nodes, nodes[1:])]


# Les nœuds autour du rond-point central : les branches à un carrefour du
# centre, l'anneau à 0,15 pas.
SOUTH, EAST, NORTH, WEST = (MID, MID - 1), (MID + 1, MID), (MID, MID + 1), (MID - 1, MID)
RS, RE, RN, RW = (MID, MID - 0.15), (MID + 0.15, MID), (MID, MID + 0.15), (MID - 0.15, MID)


@pytest.fixture(scope="module")
def graph():
    return build_graph(grid_payload(roundabout=True))


def _forward(graph, start: int, edges: list[int]) -> list[bool]:
    """Pour chaque arête de l'anneau, est-elle prise dans le sens de la circulation ?"""
    out = []
    for node, e in zip(node_sequence(graph, start, edges), edges):
        if graph.edges[e].ring:
            out.append(graph.edges[e].a == node)
    return out


class TestGraph:
    def test_l_anneau_est_marque_et_les_rues_non(self, graph):
        rings = [e for e in graph.edges if e.ring]
        assert len(rings) == 4
        assert all(e.name == "Rond-point du Centre" for e in rings)
        assert sum(e.ring for e in graph.edges) < len(graph.edges)

    def test_a_pied_l_anneau_n_est_pas_a_sens_unique(self, graph):
        assert all(e.oneway == 0 for e in graph.edges if e.ring)


class TestKeepSide:
    def test_en_face_a_droite_fait_le_tour_dans_le_sens_de_la_circulation(self, graph):
        start, edges = _path(graph, SOUTH, RS, RW, RN, NORTH)
        assert _forward(graph, start, edges) == [False, False]
        kept = keep_side(graph, start, edges, _profile(Side.right))
        assert _forward(graph, start, kept) == [True, True]
        assert node_sequence(graph, start, kept)[-1] == _node(graph, *NORTH)

    def test_en_face_a_gauche_le_remonte(self, graph):
        start, edges = _path(graph, SOUTH, RS, RE, RN, NORTH)
        kept = keep_side(graph, start, edges, _profile(Side.left))
        assert _forward(graph, start, kept) == [False, False]

    def test_indifferent_ne_touche_a_rien(self, graph):
        start, edges = _path(graph, SOUTH, RS, RW, RN, NORTH)
        assert keep_side(graph, start, edges, _profile(Side.any)) == edges

    def test_a_gauche_on_traverse_plutot_que_faire_trois_quarts_du_tour(self, graph):
        # Tourner à gauche à droite de la route, c'est trois quarts de tour :
        # trois fois plus long, au-delà de `SIDE_RING_RATIO`. On traverse.
        start, edges = _path(graph, SOUTH, RS, RW, WEST)
        assert keep_side(graph, start, edges, _profile(Side.right)) == edges

    def test_trois_quarts_a_contresens_redeviennent_un_quart_dans_le_sens(self, graph):
        start, edges = _path(graph, SOUTH, RS, RW, RN, RE, EAST)
        kept = keep_side(graph, start, edges, _profile(Side.right))
        assert _forward(graph, start, kept) == [True]

    def test_a_velo_rien_ne_change(self, graph):
        start, edges = _path(graph, SOUTH, RS, RW, RN, NORTH)
        assert keep_side(graph, start, edges, _profile(Side.right, Sport.bike)) == edges


def _says(graph, start: int, edges: list[int], sport: str = "run") -> list[str]:
    cand = Candidate(edges=edges, nodes=node_sequence(graph, start, edges))
    measure(graph, start, cand, night=False)
    steps = build_instructions(graph, start, cand, sport)
    return [s.text for s in steps if s.turn not in ("start", "finish")]


class TestConsigne:
    def test_en_face_une_seule_phrase_qui_dit_le_cote(self, graph):
        start, edges = _path(graph, SOUTH, RS, RE, RN, NORTH)
        assert _says(graph, start, edges) == ["Au rond-point, continue en face en restant à droite"]

    def test_en_face_par_la_gauche(self, graph):
        start, edges = _path(graph, SOUTH, RS, RW, RN, NORTH)
        assert _says(graph, start, edges) == ["Au rond-point, continue en face en restant à gauche"]

    def test_a_droite_dans_le_sens_rien_a_preciser(self, graph):
        start, edges = _path(graph, SOUTH, RS, RE, EAST)
        assert _says(graph, start, edges) == ["Au rond-point, prends à droite"]

    def test_a_gauche_en_faisant_le_tour(self, graph):
        start, edges = _path(graph, SOUTH, RS, RE, RN, RW, WEST)
        assert _says(graph, start, edges) == [
            "Au rond-point, prends à gauche en faisant le tour par la droite"
        ]

    def test_a_velo_on_compte_les_sorties(self):
        bike = build_graph(grid_payload(roundabout=True), sport="bike")
        start, edges = _path(bike, SOUTH, RS, RE, RN, NORTH)
        assert _says(bike, start, edges, "bike") == ["Au rond-point, prends la deuxième sortie"]

    def test_la_rue_suivante_reste_dite(self, graph):
        # Le rond-point ne mange que sa sortie : le virage d'après se dit.
        start, edges = _path(graph, SOUTH, RS, RE, RN, NORTH, (MID + 1, MID + 1))
        assert _says(graph, start, edges) == [
            "Au rond-point, continue en face en restant à droite",
            "Tourne à droite",
        ]
