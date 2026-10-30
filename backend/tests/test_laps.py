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

from app.models import LoopRequest, SafetyMode, SurfacePref
from app.navigation import build_instructions
from app.osm.graph import build_graph
from app.routing.loops import Candidate, figure_eight, generate_loops, repeat_loop, similarity
from app.routing.weights import build_profile
from app.safety.gate import run_gate
from app.service import (
    DUPLICATE_THRESHOLD,
    EIGHT_MIN_GAP_DEG,
    LAP_DIVISORS,
    LAP_PENALTY,
    MIN_LAP_M,
    _figure_eights,
    _lap_distances,
)


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


class TestHuit:
    """Deux boucles différentes enchaînées au départ plutôt que deux fois la même.

    « 2 × 4,5 km » faisait courir deux fois les mêmes rues. Un « 8 » fait la
    même distance avec deux boucles qui partent de deux côtés du départ, et
    reste validé comme une boucle répétée : le portail voit la sortie entière.
    """

    @pytest.fixture
    def paire(self, scene, profile):
        graph, start = scene
        loops = generate_loops(graph, start, 2000.0, profile, sectors=8)
        for a in loops:
            for b in loops:
                gap = abs((a.bearing - b.bearing + 180.0) % 360.0 - 180.0)
                if gap >= EIGHT_MIN_GAP_DEG and similarity(a, b) <= DUPLICATE_THRESHOLD:
                    return graph, start, a, b
        pytest.fail("le damier doit offrir deux boucles de côtés opposés")

    def test_enchaine_les_deux_boucles(self, paire):
        graph, start, a, b = paire
        huit = figure_eight(graph, start, a, b)
        assert huit.edges == a.edges + b.edges
        assert huit.laps == 2
        assert huit.lap_breaks == [len(a.edges)]
        assert huit.stats.distance_m == pytest.approx(a.stats.distance_m + b.stats.distance_m)
        assert huit.nodes[0] == start and huit.nodes[-1] == start
        # Le passage au départ, entre les deux boucles.
        assert huit.nodes[len(a.edges)] == start

    def test_la_rondeur_est_celle_de_la_moins_ronde(self, paire):
        graph, start, a, b = paire
        assert figure_eight(graph, start, a, b).roundness == min(a.roundness, b.roundness)

    def test_la_longueur_de_chaque_boucle_est_rendue(self, paire):
        graph, start, a, b = paire
        huit = figure_eight(graph, start, a, b)
        assert _lap_distances(graph, huit) == [round(a.stats.distance_m, 1), round(b.stats.distance_m, 1)]
        # Une boucle répétée, elle, se coupe à parts égales.
        repete = repeat_loop(graph, start, a, 2)
        assert _lap_distances(graph, repete) == [round(repete.stats.distance_m / 2, 1)] * 2

    def test_le_repere_tombe_a_la_fin_de_la_premiere_boucle(self, paire):
        """Pas à mi-parcours : les deux boucles n'ont pas la même longueur, et
        le guidage dit de quel côté repart la seconde."""
        from app.navigation import _bearing_from_start, _heading_words

        graph, start, a, b = paire
        huit = figure_eight(graph, start, a, b)
        repere = next(s for s in build_instructions(graph, start, huit) if s.turn == "lap")
        assert repere.dist_m == round(a.stats.distance_m, 1)
        cap = _bearing_from_start(graph.edges[b.edges[0]].coords_from(start))
        assert repere.text.endswith(f"Repars vers {_heading_words(cap)}.")

    def test_une_boucle_ne_sert_qu_a_un_seul_huit(self, scene, profile):
        """Deux 8 qui partagent une boucle — ou deux boucles presque pareilles —
        partageraient la moitié de la sortie. Sur le damier, trois 8 sortaient à
        l'identique."""
        graph, start = scene
        loops = generate_loops(graph, start, 2000.0, profile, sectors=8)
        huits = _figure_eights(graph, start, loops, "safe", LoopRequest(lat=0, lon=0, distance_km=4), 6)
        assert huits
        boucles = []
        for h in huits:
            cut = h.lap_breaks[0]
            for edges in (h.edges[:cut], h.edges[cut:]):
                boucles.append(Candidate(edges=edges, nodes=[]))
        for i, a in enumerate(boucles):
            for b in boucles[i + 1:]:
                assert similarity(a, b) <= DUPLICATE_THRESHOLD
        for h in huits:
            assert run_gate(h.stats, "safe", "run").passed


class TestFormeDemandee:
    """« Une boucle », « Deux boucles », « 3 tours » : la forme se choisit.

    Le moteur choisissait seul — une boucle entière d'abord, des tours faute de
    mieux. Une forme demandée se tient **strictement** : plutôt aucune
    proposition, avec un message qui le dit, qu'une autre forme que celle-là.
    """

    @pytest.fixture
    def plan(self, monkeypatch):
        import asyncio

        from app import service
        from app.osm.extract import read as read_extract, to_cache
        from tests.conftest import ORIGIN_LAT, ORIGIN_LON, STEP, grid_payload

        extract = read_extract(to_cache(read_extract(grid_payload(9))))

        async def fake_area(lat, lon, radius_m, *, target_m=0.0):
            return extract

        async def calm(lat, lon):
            return None

        monkeypatch.setattr(service, "fetch_area", fake_area)
        monkeypatch.setattr(service, "current_wind", calm)

        def run(**extra):
            service.graph_cache.clear()
            req = LoopRequest(
                lat=ORIGIN_LAT + 4 * STEP, lon=ORIGIN_LON + 4 * STEP, time_of_day="day",
                with_elevation=False, limit=6, **extra,
            )
            return asyncio.run(service.plan_loops(req))

        yield run
        service.graph_cache.clear()

    def test_auto_complete_de_tours_et_de_huits(self, plan):
        """Le damier est trop petit pour 6 km d'une traite : « Auto » propose des
        tours — c'est le cas que les formes demandées départagent."""
        routes = plan(distance_km=6.0).routes
        assert routes and all(r.laps > 1 for r in routes)

    def test_deux_boucles_ne_rend_que_des_huits(self, plan):
        routes = plan(distance_km=6.0, form="eight").routes
        assert routes
        assert all(r.figure_eight and r.laps == 2 for r in routes)

    def test_des_tours_rendent_ce_nombre_de_tours(self, plan):
        routes = plan(distance_km=6.0, form="laps", laps=3).routes
        assert routes
        assert all(r.laps == 3 and not r.figure_eight for r in routes)
        # Deux tours de la même boucle, et pas un « 8 » : c'est ce qu'on a demandé.
        two = plan(distance_km=6.0, form="laps", laps=2).routes
        assert two and all(r.laps == 2 and not r.figure_eight for r in two)

    def test_une_boucle_ne_se_complete_jamais_de_tours(self, plan):
        """Aucune boucle entière de 6 km sur le damier : rien, et on le dit — avec
        ce que « Auto » ferait à la place."""
        res = plan(distance_km=6.0, form="loop")
        assert res.routes == []
        assert "« Auto »" in res.meta["message"]
        # Là où une boucle entière existe, elle sort, seule de son espèce.
        whole = plan(distance_km=2.5, form="loop").routes
        assert whole and all(r.laps == 1 for r in whole)

    def test_une_forme_trop_courte_est_refusee_avant_de_chercher(self, plan):
        from app.service import PlanningError

        with pytest.raises(PlanningError, match="5 tours de 1,0 km"):
            plan(distance_km=5.0, form="laps", laps=5)
        with pytest.raises(PlanningError, match="Deux boucles de 1,2 km"):
            plan(distance_km=2.5, form="eight")

    def test_la_duree_se_convertit_avant_la_forme(self, plan):
        """40 min à 6:40/km, c'est 6 km : trois tours de 2 km."""
        routes = plan(duration_min=40, pace_sec_per_km=400, form="laps", laps=3).routes
        assert routes and all(r.laps == 3 for r in routes)
