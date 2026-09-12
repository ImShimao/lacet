"""Les boucles parcourues plusieurs fois.

Quand aucune boucle de la longueur demandée ne tient — un village dont toutes
les sorties sont des départementales, une presqu'île, un réseau trop pauvre —
il reste une réponse évidente : *une boucle deux fois plus courte, parcourue
deux fois*. C'est ce que fait tout coureur qui connaît son quartier.

Deux exigences, et ce sont elles que ces tests protègent :

1. **Rien n'est relâché.** Le tour est validé comme n'importe quelle boucle, et
   le parcours répété est revalidé dans son ensemble — parce que répéter change
   des choses réelles : on franchit chaque traversée à chaque tour.
2. **On préfère répéter plutôt qu'abaisser la sécurité.** Une boucle courte
   répétée qui tient le mode Sûr vaut mieux qu'une boucle entière qui ne le
   tient pas.
"""

from __future__ import annotations

import pytest

from app.models import SafetyMode, SurfacePref
from app.osm.graph import build_graph
from app.routing.loops import generate_loops, repeat_loop
from app.routing.weights import build_profile
from app.safety.gate import run_gate
from app.service import LAP_DIVISORS, LAP_PENALTY, MIN_LAP_M


@pytest.fixture
def profile():
    return build_profile(SurfacePref.mixed, SafetyMode.safe, night=False)


@pytest.fixture
def scene(grid, grid_center):
    graph = build_graph(grid)
    start = graph.nearest_node(*grid_center)
    assert start is not None
    return graph, start


@pytest.fixture
def boucle(scene, profile):
    graph, start = scene
    loops = generate_loops(graph, start, 2000.0, profile, sectors=8)
    assert loops
    # La plus ronde : c'est celle dont on vérifiera que la forme survit.
    return graph, start, max(loops, key=lambda c: c.roundness)


class TestRepetition:
    def test_la_distance_est_multipliee(self, boucle):
        graph, start, cand = boucle
        for laps in (2, 3, 4):
            repete = repeat_loop(graph, start, cand, laps)
            assert repete.stats.distance_m == pytest.approx(cand.stats.distance_m * laps)

    def test_le_parcours_reste_ferme(self, boucle):
        graph, start, cand = boucle
        repete = repeat_loop(graph, start, cand, 3)
        assert repete.geometry[0] == repete.geometry[-1]
        assert repete.nodes[0] == start
        assert repete.nodes[-1] == start
        assert repete.stats.closure_m < 1.0

    def test_la_rondeur_est_celle_du_tour(self, boucle):
        """L'aire d'un tracé parcouru deux fois double quand son périmètre
        double aussi : la formule isopérimétrique ferait chuter la rondeur de
        moitié alors que la forme est rigoureusement la même."""
        graph, start, cand = boucle
        repete = repeat_loop(graph, start, cand, 2)
        assert repete.roundness == cand.roundness

    def test_le_recouvrement_est_celui_du_tour(self, boucle):
        """Il vaudrait mécaniquement (n−1)/n et ne dirait plus rien du tour."""
        graph, start, cand = boucle
        repete = repeat_loop(graph, start, cand, 3)
        assert repete.stats.overlap_share == cand.stats.overlap_share

    def test_les_traversees_se_repetent(self, boucle):
        """On les franchit à chaque tour : c'est un fait, pas une convention."""
        graph, start, cand = boucle
        repete = repeat_loop(graph, start, cand, 3)
        assert len(repete.crossings) == len(cand.crossings) * 3

    def test_le_denivele_et_l_exposition_se_repetent(self, boucle):
        graph, start, cand = boucle
        repete = repeat_loop(graph, start, cand, 2)
        assert repete.stats.exposed_m == pytest.approx(cand.stats.exposed_m * 2)
        assert repete.stats.protected_m == pytest.approx(cand.stats.protected_m * 2)
        # Les parts, elles, ne bougent pas.
        assert repete.stats.exposed_share == pytest.approx(cand.stats.exposed_share)

    def test_la_geometrie_repasse_par_le_meme_chemin(self, boucle):
        graph, start, cand = boucle
        repete = repeat_loop(graph, start, cand, 2)
        assert repete.edges == cand.edges * 2
        # Un tour complet plus un tour complet : le point de jonction est le départ.
        assert repete.geometry[len(cand.geometry) - 1] == cand.geometry[-1]

    def test_le_nombre_de_tours_est_porte_par_le_candidat(self, boucle):
        graph, start, cand = boucle
        assert cand.laps == 1
        assert repeat_loop(graph, start, cand, 4).laps == 4

    def test_un_seul_tour_ne_change_rien(self, boucle):
        graph, start, cand = boucle
        repete = repeat_loop(graph, start, cand, 1)
        assert repete.stats.distance_m == pytest.approx(cand.stats.distance_m)
        assert repete.edges == cand.edges


class TestReglages:
    def test_les_divisions_vont_du_plus_simple_au_plus_morcele(self):
        """Deux tours avant trois : on ne morcelle pas plus que nécessaire."""
        assert list(LAP_DIVISORS) == sorted(LAP_DIVISORS)
        assert LAP_DIVISORS[0] == 2

    def test_un_tour_ne_peut_pas_etre_ridicule(self):
        """« Cinq tours de 800 m » n'est pas une sortie, c'est de la piste."""
        assert MIN_LAP_M >= 1000.0

    def test_repeter_coute_moins_qu_un_cran_de_note(self):
        """La sécurité prime : une boucle notée A répétée doit passer devant une
        B entière, jamais l'inverse."""
        from app.service import GRADE_PENALTY

        assert LAP_PENALTY * (max(LAP_DIVISORS) - 1) < GRADE_PENALTY

    def test_repeter_reste_moins_bien_qu_une_boucle_entiere(self):
        assert LAP_PENALTY > 0


class TestSecurite:
    def test_le_parcours_repete_est_revalide(self, boucle):
        """Le portail doit voir le parcours réel, pas le tour isolé."""
        graph, start, cand = boucle
        repete = repeat_loop(graph, start, cand, 3)
        # Le recouvrement étant celui du tour, il ne doit pas faire échouer un
        # parcours répété que le portail accepterait par ailleurs.
        verdict = run_gate(repete.stats, "safe", "run")
        assert verdict.passed == run_gate(cand.stats, "safe", "run").passed

    def test_une_portion_exposee_qui_se_recolle_est_comptee(self):
        """Si le départ tombe au milieu d'un tronçon exposé, les tours le
        mettent bout à bout — et la mesure doit le voir.

        On ne peut pas le fabriquer sur le damier de test, mais on vérifie au
        moins que la plus longue portion continue n'est jamais **sous-estimée**
        par rapport au tour unique.
        """
        from tests.conftest import grid_payload

        graph = build_graph(grid_payload(dangerous_row=4))
        start = graph.nearest_node(2.3 + 4 * 0.0015, 48.8 + 4 * 0.0015)
        profile = build_profile(SurfacePref.mixed, SafetyMode.standard, night=False)
        loops = generate_loops(graph, start, 2000.0, profile, sectors=8)
        assert loops

        for cand in loops:
            repete = repeat_loop(graph, start, cand, 2)
            assert repete.stats.longest_exposed_m >= cand.stats.longest_exposed_m
