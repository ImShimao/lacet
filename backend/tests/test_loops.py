"""Génération de boucles, de bout en bout sur un réseau synthétique."""

from __future__ import annotations

import pytest

from app.models import SafetyMode, SurfacePref
from app.osm.graph import build_graph
from app.routing.loops import generate_loops, similarity
from app.routing.weights import build_profile
from app.safety.gate import run_gate
from tests.conftest import grid_payload


@pytest.fixture
def profile():
    return build_profile(SurfacePref.mixed, SafetyMode.safe, night=False)


def _start(graph, center):
    node = graph.nearest_node(*center)
    assert node is not None
    return node


class TestGeneration:
    def test_produit_des_boucles(self, grid, grid_center, profile):
        graph = build_graph(grid)
        start = _start(graph, grid_center)
        loops = generate_loops(graph, start, 2000.0, profile, sectors=8)
        assert loops, "aucune boucle générée sur un damier régulier"

    def test_les_boucles_reviennent_au_depart(self, grid, grid_center, profile):
        graph = build_graph(grid)
        start = _start(graph, grid_center)
        for cand in generate_loops(graph, start, 2000.0, profile, sectors=8):
            assert cand.nodes[0] == start
            assert cand.nodes[-1] == start
            assert cand.stats.closure_m < 1.0

    def test_distance_dans_le_bon_ordre_de_grandeur(self, grid, grid_center, profile):
        graph = build_graph(grid)
        start = _start(graph, grid_center)
        loops = generate_loops(graph, start, 2000.0, profile, sectors=8)
        distances = [c.stats.distance_m for c in loops]
        assert any(1400 <= d <= 2600 for d in distances), distances

    def test_le_retour_evite_l_aller(self, grid, grid_center, profile):
        """C'est tout l'intérêt de la pénalité : pas d'aller-retour identique."""
        graph = build_graph(grid)
        start = _start(graph, grid_center)
        for cand in generate_loops(graph, start, 2500.0, profile, sectors=8):
            assert cand.stats.overlap_share < 0.5

    def test_geometrie_continue(self, grid, grid_center, profile):
        graph = build_graph(grid)
        start = _start(graph, grid_center)
        for cand in generate_loops(graph, start, 2000.0, profile, sectors=8):
            assert len(cand.geometry) >= len(cand.edges)
            assert cand.geometry[0] == cand.geometry[-1]

    def test_les_troncons_couvrent_toute_la_distance(self, grid, grid_center, profile):
        graph = build_graph(grid)
        start = _start(graph, grid_center)
        for cand in generate_loops(graph, start, 2000.0, profile, sectors=8):
            total = sum(s.length_m for s in cand.segments)
            assert total == pytest.approx(cand.stats.distance_m, rel=1e-6)


class TestEvitementDuDanger:
    def test_la_departementale_est_contournee(self, grid_center, profile):
        """Une ligne dangereuse au milieu du damier ne doit pas être empruntée
        alors qu'un chemin parallèle sûr existe à 165 m."""
        payload = grid_payload(dangerous_row=4)
        graph = build_graph(payload)
        start = _start(graph, grid_center)

        loops = generate_loops(graph, start, 2000.0, profile, sectors=8)
        assert loops

        passing = [c for c in loops if run_gate(c.stats, "safe").passed]
        assert passing, "aucune boucle sûre alors que le damier en permet"
        for cand in passing:
            assert cand.stats.exposed_share <= 0.03

    def test_mode_standard_moins_severe(self, grid_center):
        payload = grid_payload(dangerous_row=4)
        graph = build_graph(payload)
        start = _start(graph, grid_center)

        safe = build_profile(SurfacePref.mixed, SafetyMode.safe, night=False)
        standard = build_profile(SurfacePref.mixed, SafetyMode.standard, night=False)

        exposure_safe = _mean_exposure(graph, start, safe)
        exposure_standard = _mean_exposure(graph, start, standard)
        assert exposure_safe <= exposure_standard


def _mean_exposure(graph, start, profile) -> float:
    loops = generate_loops(graph, start, 2000.0, profile, sectors=8)
    if not loops:
        return 0.0
    return sum(c.stats.exposed_share for c in loops) / len(loops)


class TestSimilarite:
    def test_identique(self, grid, grid_center, profile):
        graph = build_graph(grid)
        start = _start(graph, grid_center)
        loops = generate_loops(graph, start, 2000.0, profile, sectors=8)
        assert similarity(loops[0], loops[0]) == 1.0

    def test_directions_opposees_peu_similaires(self, grid, grid_center, profile):
        graph = build_graph(grid)
        start = _start(graph, grid_center)
        loops = generate_loops(graph, start, 2000.0, profile, sectors=8)
        if len(loops) < 2:
            pytest.skip("pas assez de candidats sur ce réseau")
        pairs = [
            similarity(a, b)
            for i, a in enumerate(loops)
            for b in loops[i + 1 :]
        ]
        assert min(pairs) < 0.6
