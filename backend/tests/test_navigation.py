"""Les consignes de navigation.

Ce qui est testé ici n'est pas « sait-on calculer un angle » mais « sait-on se
taire ». Un guidage piéton qui annonce chaque inflexion du tracé devient un
bruit de fond qu'on cesse d'écouter au bout de cinq minutes — c'est le défaut
le plus répandu du genre, et il ne se voit pas sur une carte.
"""

from __future__ import annotations

from collections import Counter

import pytest

from app.models import SafetyMode, SurfacePref
from app.navigation import (
    LAP_ABSORB_M,
    NAME_CHANGE_MIN_M,
    SLIGHT_DEG,
    TURN_DEG,
    build_instructions,
)
from app.osm.graph import build_graph
from app.routing.loops import generate_loops, repeat_loop
from app.routing.weights import build_profile


@pytest.fixture
def profile():
    return build_profile(SurfacePref.mixed, SafetyMode.safe, night=False)


@pytest.fixture
def scene(grid, grid_center):
    graph = build_graph(grid)
    start = graph.nearest_node(*grid_center)
    assert start is not None
    return graph, start


def _loops(scene, profile, target=2000.0):
    graph, start = scene
    loops = generate_loops(graph, start, target, profile, sectors=8)
    assert loops
    return graph, start, loops


class TestStructure:
    def test_commence_par_un_depart_et_finit_par_une_arrivee(self, scene, profile):
        graph, start, loops = _loops(scene, profile)
        for cand in loops:
            steps = build_instructions(graph, start, cand)
            assert steps[0].turn == "start"
            assert steps[-1].turn == "finish"

    def test_les_distances_sont_croissantes(self, scene, profile):
        graph, start, loops = _loops(scene, profile)
        for cand in loops:
            distances = [s.dist_m for s in build_instructions(graph, start, cand)]
            assert distances == sorted(distances), distances

    def test_aucune_consigne_ne_depasse_la_longueur_du_parcours(self, scene, profile):
        graph, start, loops = _loops(scene, profile)
        for cand in loops:
            total = cand.stats.distance_m
            for step in build_instructions(graph, start, cand):
                assert step.dist_m <= total + 1.0

    def test_toutes_les_consignes_ont_une_phrase(self, scene, profile):
        graph, start, loops = _loops(scene, profile)
        for cand in loops:
            for step in build_instructions(graph, start, cand):
                assert step.text.strip()

    def test_tracé_vide_ne_produit_rien(self, scene, profile):
        graph, start, loops = _loops(scene, profile)
        cand = loops[0]
        cand.edges = []
        assert build_instructions(graph, start, cand) == []


def _fourche():
    """Une fourche : la rue Haute s'infléchit de 35° à droite au carrefour J,
    pendant que la ruelle du Puits continue tout droit vers le nord."""
    import math

    lat0, lon0 = 48.80, 2.30
    ky, kx = 1 / 110_540, 1 / (111_320 * math.cos(math.radians(lat0)))

    def at(x: float, y: float) -> dict[str, float]:
        return {"lat": lat0 + y * ky, "lon": lon0 + x * kx}

    rad = math.radians(35)
    bend = (200 * math.sin(rad), 200 * math.cos(rad))
    tags = {"highway": "residential", "sidewalk": "both"}
    payload = {
        "elements": [
            {"type": "way", "id": 1, "tags": {**tags, "name": "Rue Haute"},
             "nodes": [1, 2, 3], "geometry": [at(0, -200), at(0, 0), at(*bend)]},
            {"type": "way", "id": 2, "tags": {**tags, "name": "Ruelle du Puits"},
             "nodes": [2, 4], "geometry": [at(0, 0), at(0, 200)]},
        ]
    }
    graph = build_graph(payload)
    node = {k: graph.nearest_node(p["lon"], p["lat"]) for k, p in
            {"A": at(0, -200), "J": at(0, 0), "B": at(*bend), "C": at(0, 200)}.items()}

    def route(*names: str) -> list[str]:
        from app.routing.loops import Candidate

        nodes = [node[n] for n in names]
        edges = [
            next(e for e in graph.adj[u] if graph.edges[e].other(u) == v)
            for u, v in zip(nodes, nodes[1:])
        ]
        steps = build_instructions(graph, nodes[0], Candidate(edges=edges, nodes=nodes))
        return [s.text for s in steps if s.turn not in {"start", "finish"}]

    return route


class TestFourches:
    """Une fourche se dit, même douce : c'est là qu'on se trompe de branche."""

    def test_la_rue_qui_s_infléchit_se_dit_quand_une_autre_continue_tout_droit(self):
        # 35°, sous le seuil d'un virage : sans la règle, rien n'était dit, et
        # l'on prenait la ruelle d'en face.
        assert _fourche()("A", "J", "B") == ["Serre à droite dans la rue Haute"]

    def test_quitter_la_rue_pour_continuer_tout_droit_se_dit(self):
        assert _fourche()("A", "J", "C") == ["Continue tout droit dans la ruelle du Puits"]


class TestSobriete:
    """Le cœur du sujet : ne dire que ce qui se décide."""

    def test_le_damier_ne_produit_que_des_angles_droits(self, scene, profile):
        """Sur un damier, aucune manœuvre ne peut être une simple inflexion."""
        graph, start, loops = _loops(scene, profile)
        for cand in loops:
            for step in build_instructions(graph, start, cand):
                if step.turn in {"start", "finish", "straight"}:
                    continue
                assert abs(step.angle) >= SLIGHT_DEG, step.text

    def test_pas_de_consigne_tous_les_dix_metres(self, scene, profile):
        graph, start, loops = _loops(scene, profile)
        for cand in loops:
            steps = build_instructions(graph, start, cand)
            gaps = [
                steps[i + 1].dist_m - steps[i].dist_m for i in range(len(steps) - 1)
            ]
            # Les manœuvres rapprochées sont fusionnées : plus rien ne doit
            # subsister sous la barre où deux consignes deviennent inaudibles.
            assert all(g >= 0 for g in gaps)
            espacement = cand.stats.distance_m / max(len(steps) - 1, 1)
            assert espacement > 40.0, f"une consigne tous les {espacement:.0f} m"

    def test_une_courbe_douce_sur_la_meme_rue_ne_se_dit_pas(self):
        """Le tracé d'une rue n'est pas une décision de navigation."""
        from app.navigation import _classify

        # Un virage sous le seuil d'inflexion ne porte aucun nom de manœuvre.
        assert _classify(10.0) == "straight"
        assert _classify(-10.0) == "straight"
        assert _classify(SLIGHT_DEG + 1) == "slight_right"
        assert _classify(-(SLIGHT_DEG + 1)) == "slight_left"

    def test_les_virages_sont_orientes_dans_le_bon_sens(self):
        from app.navigation import _classify

        assert _classify(TURN_DEG + 5) == "right"
        assert _classify(-(TURN_DEG + 5)) == "left"
        assert _classify(179.0) == "uturn"
        assert _classify(-179.0) == "uturn"


class TestRedites:
    def test_une_rue_n_est_pas_reannoncee_sans_cesse(self, scene, profile):
        """Une rue est découpée en autant d'arêtes qu'elle a d'intersections.

        Sans mémoire des annonces, chaque tronçon anonyme intercalé faisait
        passer le retour sur la même voie pour un changement de rue.
        """
        graph, start, loops = _loops(scene, profile, target=2500.0)
        for cand in loops:
            steps = build_instructions(graph, start, cand)
            straights = [s for s in steps if s.turn == "straight" and s.road]
            names = [s.road for s in straights]
            assert len(names) == len(set(names)), names

    def test_un_changement_de_nom_court_ne_se_signale_pas(self):
        """Le seuil existe pour ne pas annoncer une venelle de trente mètres."""
        assert NAME_CHANGE_MIN_M >= 100.0


def _pas(dist: float, angle: float, before: float, turn: str | None = None, road: str | None = None):
    """Une manœuvre brute : on arrive au cap `before`, on repart à `before + angle`."""
    from app.navigation import Instruction, _classify

    return Instruction(
        dist_m=dist, turn=turn or _classify(angle), angle=angle, road=road, text="",
        lon=0.0, lat=0.0, caution=False, before=before, after=(before + angle) % 360.0,
    )


class TestFusion:
    """Deux manœuvres à moins de 25 m n'en font qu'une : laquelle ?"""

    def test_l_angle_est_celui_du_chemin_pas_la_somme_des_annonces(self):
        # Montée du Lieutenant Allouche, à Lyon : −80° puis −93°, et entre les
        # deux, tues, les inflexions (+80°) d'un trottoir d'un mètre. La somme
        # disait « fais demi-tour » (−173°) ; le chemin tourne à gauche.
        from app.navigation import _merge_all

        (pas,) = _merge_all([_pas(0.0, -80.5, 0.0), _pas(8.0, -92.6, 359.1)])
        assert pas.turn == "left"
        assert pas.angle == pytest.approx(-93.5)

    def test_un_tout_droit_juste_apres_un_virage_le_nomme(self):
        # « Tourne à droite », puis vingt mètres plus loin « Continue tout droit
        # sur Passerelle du Collège » : un seul virage, dit une fois.
        from app.navigation import _merge_all

        steps = [
            _pas(0.0, 83.7, 0.0),
            _pas(19.8, 2.8, 86.4, turn="straight", road="Passerelle du Collège"),
        ]
        (pas,) = _merge_all(steps)
        assert pas.text == "Tourne à droite sur Passerelle du Collège"

    def test_pas_de_demi_tour_que_le_virage_suivant_defait(self):
        # Quai Eustache Chappuis, à Annecy : à gauche (−57°), à gauche pour
        # traverser le quai (−108°), à droite dans la rue Saint-Maurice (+91°),
        # le tout en dix-neuf mètres. Additionnés par paires, les deux premiers
        # faisaient un demi-tour (−165°), et l'app disait « fais demi-tour puis
        # tout de suite à droite » au départ, pour un virage à gauche de −74°.
        from app.navigation import _merge_all

        steps = [
            _pas(37.4, -57.0, 327.0),
            _pas(50.2, -108.0, 270.0),
            _pas(56.4, 91.0, 162.0, road="Rue Saint-Maurice"),
        ]
        (pas,) = _merge_all(steps)
        assert pas.text == "Tourne à gauche dans la rue Saint-Maurice"
        assert pas.angle == pytest.approx(-74.0)
        assert pas.dist_m == 37.4


class TestResume:
    def test_compte_les_manoeuvres(self, scene, profile):
        graph, start, loops = _loops(scene, profile)
        steps = build_instructions(graph, start, loops[0])
        counts = Counter(step.turn for step in steps)
        assert counts["start"] == 1
        assert counts["finish"] == 1
        assert sum(counts.values()) == len(steps)


class TestReperesDeTour:
    """Sur un parcours à tours, la question n'est plus « où tourner ».

    Les tours sont rigoureusement identiques : on entend les mêmes consignes
    dans le même ordre. Sans repère, rien ne dit si c'est le premier passage ou
    le dernier — et c'est la seule chose qu'on veuille savoir.
    """

    def _repete(self, scene, profile, laps):
        graph, start = scene
        loops = generate_loops(graph, start, 2000.0, profile, sectors=8)
        assert loops
        return graph, start, repeat_loop(graph, start, loops[0], laps)

    def test_une_boucle_simple_n_a_pas_de_repere(self, scene, profile):
        graph, start = scene
        cand = generate_loops(graph, start, 2000.0, profile, sectors=8)[0]
        steps = build_instructions(graph, start, cand)
        assert not [s for s in steps if s.turn == "lap"]

    def test_un_repere_par_passage_au_depart(self, scene, profile):
        for laps in (2, 3, 4):
            graph, start, cand = self._repete(scene, profile, laps)
            reperes = [s for s in build_instructions(graph, start, cand) if s.turn == "lap"]
            assert len(reperes) == laps - 1, laps

    def test_les_reperes_tombent_aux_bons_kilometres(self, scene, profile):
        graph, start, cand = self._repete(scene, profile, 3)
        tour = cand.stats.distance_m / 3
        reperes = [s for s in build_instructions(graph, start, cand) if s.turn == "lap"]
        assert reperes[0].dist_m == pytest.approx(tour, rel=0.01)
        assert reperes[1].dist_m == pytest.approx(2 * tour, rel=0.01)

    def test_le_repere_dit_combien_il_en_reste(self, scene, profile):
        graph, start, cand = self._repete(scene, profile, 3)
        reperes = [s for s in build_instructions(graph, start, cand) if s.turn == "lap"]
        assert "Encore 2 tours" in reperes[0].text
        assert "Dernier tour" in reperes[1].text

    def test_le_repere_redonne_la_direction(self, scene, profile):
        """Le passage au départ est le seul endroit où l'on peut repartir dans
        le mauvais sens sans s'en apercevoir."""
        graph, start, cand = self._repete(scene, profile, 2)
        repere = next(s for s in build_instructions(graph, start, cand) if s.turn == "lap")
        assert "Repars vers" in repere.text

    def test_aucune_manoeuvre_ne_double_le_repere(self, scene, profile):
        """« Fais demi-tour » à l'endroit où l'on repart pour un tour de plus :
        l'angle est bien de 180°, mais ce n'est pas un demi-tour."""
        graph, start, cand = self._repete(scene, profile, 3)
        steps = build_instructions(graph, start, cand)
        bornes = [s.dist_m for s in steps if s.turn == "lap"]
        manoeuvres = [s for s in steps if s.turn not in {"lap", "start", "finish"}]
        for s in manoeuvres:
            assert all(abs(s.dist_m - b) > LAP_ABSORB_M for b in bornes), s.text

    def test_l_arrivee_parle_de_tours(self, scene, profile):
        graph, start, cand = self._repete(scene, profile, 3)
        arrivee = build_instructions(graph, start, cand)[-1]
        assert arrivee.turn == "finish"
        assert "3 tours" in arrivee.text

    def test_tout_reste_dans_l_ordre_des_distances(self, scene, profile):
        """Les repères s'insèrent au milieu des manœuvres : sans tri, la fin du
        premier tour serait annoncée après les virages du deuxième."""
        graph, start, cand = self._repete(scene, profile, 3)
        distances = [s.dist_m for s in build_instructions(graph, start, cand)]
        assert distances == sorted(distances)
