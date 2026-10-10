"""Génération de boucles, de bout en bout sur un réseau synthétique."""

from __future__ import annotations

import pytest

from app.elevation import Terrain
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


class TestRelief:
    """Tracer vers le terrain demandé, quand on connaît le relief.

    Le cas réel : au pied des Vosges, à Guebwiller, deux boucles sur trois
    montaient dans les vignes, et une demande de plat sortait 290 m de D+ en
    tête. Ici, la moitié ouest du damier est un coteau.
    """

    @staticmethod
    def hillside(center) -> Terrain:
        terrain = Terrain(center[1], center[0], 3000.0)
        terrain.values = [
            200.0 + 40_000.0 * max(0.0, center[0] - lon) for lon, _lat in terrain.points()
        ]
        return terrain

    @staticmethod
    def mean_climb(loops, terrain) -> float:
        return sum(terrain.climb(c.geometry) for c in loops) / len(loops)

    def test_en_plat_les_boucles_restent_en_bas(self, grid, grid_center, profile):
        graph = build_graph(grid)
        start = _start(graph, grid_center)
        terrain = self.hillside(grid_center)
        blind = generate_loops(graph, start, 2000.0, profile, sectors=8, max_candidates=6)
        flat = generate_loops(
            graph, start, 2000.0, profile, sectors=8, max_candidates=6,
            terrain=terrain, climb_fit=lambda per_km: per_km,
        )
        assert flat and blind
        assert self.mean_climb(flat, terrain) < self.mean_climb(blind, terrain) / 2

    def test_la_pente_coute_en_plat(self, grid, grid_center):
        graph = build_graph(grid)
        terrain = self.hillside(grid_center)
        plain = build_profile(SurfacePref.mixed, SafetyMode.safe, night=False)
        flat = build_profile(SurfacePref.mixed, SafetyMode.safe, night=False, terrain=terrain)
        before, after = plain.precompute(graph), flat.precompute(graph)
        assert all(a >= b for a, b in zip(after, before))
        assert any(a > b for a, b in zip(after, before))

    def test_sans_relief_rien_ne_change(self, grid, grid_center, profile):
        graph = build_graph(grid)
        start = _start(graph, grid_center)
        before = generate_loops(graph, start, 2000.0, profile, sectors=8)
        after = generate_loops(graph, start, 2000.0, profile, sectors=8, climb_fit=lambda x: x)
        assert [c.edges for c in after] == [c.edges for c in before]


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
