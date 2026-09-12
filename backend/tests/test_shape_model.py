"""Le modèle géométrique de la génération.

Ces tests protègent la correction la plus importante du moteur : **le départ est
un sommet de la boucle, pas son centre.** Répartir les points de passage sur 360°
plaçait le départ au milieu de la figure, obligeait chaque côté à retraverser ce
milieu, et faisait s'annuler les aires — la rondeur tombait à 0,03 sans qu'aucun
autre indicateur ne bouge. Le symptôme ne désignait pas la cause ; ces tests, si.
"""

from __future__ import annotations

import math

import pytest

from app.geo import roundness
from app.models import SafetyMode, SurfacePref
from app.osm.graph import build_graph
from app.routing.loops import (
    FINE_SECTORS,
    SHAPES,
    generate_loops,
    node_sectors,
    sweep_gate,
    waypoint_plan,
)
from app.routing.weights import build_profile


@pytest.fixture
def profile():
    return build_profile(SurfacePref.mixed, SafetyMode.safe, night=False)


def _start(graph, center):
    node = graph.nearest_node(*center)
    assert node is not None
    return node


class TestPlanDesPointsDePassage:
    @pytest.mark.parametrize("m", SHAPES)
    def test_un_point_de_moins_que_de_cotes(self, m):
        """Le départ compte pour un sommet : il n'en reste que m−1 à placer."""
        assert len(waypoint_plan(m, 10_000.0)) == m - 1

    @pytest.mark.parametrize("m", SHAPES)
    def test_les_points_ne_font_pas_le_tour(self, m):
        """Ils tiennent sur (m−2)·180/m degrés — 60° pour un triangle."""
        plan = waypoint_plan(m, 10_000.0)
        spread = plan[-1][0] - plan[0][0]
        assert spread == pytest.approx((m - 2) * 180.0 / m)
        assert spread < 180.0

    @pytest.mark.parametrize("m", SHAPES)
    def test_ecart_angulaire_regulier(self, m):
        plan = waypoint_plan(m, 10_000.0)
        gaps = [plan[i + 1][0] - plan[i][0] for i in range(len(plan) - 1)]
        assert all(g == pytest.approx(180.0 / m) for g in gaps)

    @pytest.mark.parametrize("m", SHAPES)
    def test_le_perimetre_reconstitue_est_la_cible(self, m):
        """Somme des côtés = distance visée, sinon toute la calibration est fausse.

        Le côté du polygone se retrouve en reliant les points de passage entre
        eux : c'est la corde entre deux sommets consécutifs du cercle circonscrit.
        """
        perimeter = 10_000.0
        radius = perimeter / (2 * m * math.sin(math.pi / m))
        side = 2 * radius * math.sin(math.pi / m)
        assert m * side == pytest.approx(perimeter)

        # Et le premier point de passage est bien à un côté du départ.
        assert waypoint_plan(m, perimeter)[0][1] == pytest.approx(side)

    @pytest.mark.parametrize("m", SHAPES)
    def test_le_point_le_plus_loin_est_a_mi_parcours(self, m):
        """L'éloignement croît puis décroît : le sommet opposé au départ est le plus loin."""
        distances = [d for _a, d in waypoint_plan(m, 10_000.0)]
        peak = distances.index(max(distances))
        assert peak in ((len(distances) - 1) // 2, len(distances) // 2)
        assert distances[:peak] == sorted(distances[:peak])
        assert distances[peak:] == sorted(distances[peak:], reverse=True)

        # Aucun point ne dépasse 0,36 fois le périmètre. C'est ce qui borne la
        # portée du parcours aller, donc le rayon de données à télécharger.
        assert max(distances) <= 0.36 * 10_000.0

    def test_les_distances_sont_symetriques(self):
        """Aller et retour sont de même longueur dans un polygone régulier."""
        plan = waypoint_plan(6, 12_000.0)
        distances = [d for _a, d in plan]
        assert distances == pytest.approx(distances[::-1])


class TestCouloirDeProgression:
    def test_ouvre_le_secteur_vise(self):
        gate = sweep_gate(0.0, 90.0, margin=0.0)
        width = 360.0 / FINE_SECTORS
        assert gate[int(45.0 // width)] == 1
        assert gate[int(0.0 // width)] == 1

    def test_ferme_le_tour_a_l_envers(self):
        """Le point même de ce garde-fou : interdire le grand tour."""
        gate = sweep_gate(0.0, 90.0, margin=30.0)
        width = 360.0 / FINE_SECTORS
        assert gate[int(200.0 // width)] == 0
        assert gate[int(270.0 // width)] == 0

    def test_passe_par_le_nord_sans_se_tromper(self):
        """Un couloir de 330° à 30° traverse le zéro : cas classique d'erreur."""
        gate = sweep_gate(330.0, 30.0, margin=10.0)
        width = 360.0 / FINE_SECTORS
        for angle in (335.0, 350.0, 0.0, 10.0, 25.0):
            assert gate[int(angle // width) % FINE_SECTORS] == 1, angle
        assert gate[int(180.0 // width)] == 0

    def test_la_marge_elargit(self):
        etroit = sum(sweep_gate(0.0, 60.0, margin=0.0))
        large = sum(sweep_gate(0.0, 60.0, margin=45.0))
        assert large > etroit


class TestTableDesDirections:
    def test_les_quatre_points_cardinaux(self, grid, grid_center):
        graph = build_graph(grid)
        start = _start(graph, grid_center)
        table = node_sectors(graph, start)
        assert len(table) == len(graph.nodes)

        width = 360.0 / FINE_SECTORS
        slon, slat = graph.nodes[start]
        for node, (lon, lat) in enumerate(graph.nodes):
            if node == start:
                continue
            # Un nœud franchement au nord doit tomber dans une tranche proche de 0.
            if abs(lon - slon) < 1e-9 and lat > slat:
                assert table[node] == 0
            if abs(lat - slat) < 1e-9 and lon > slon:
                assert table[node] == int(90.0 // width)


class TestBouclesReelles:
    """Sur le damier, un polygone régulier est réalisable : la rondeur doit suivre."""

    def test_les_boucles_sont_rondes(self, grid, grid_center, profile):
        graph = build_graph(grid)
        start = _start(graph, grid_center)
        loops = generate_loops(graph, start, 2000.0, profile, sectors=8)
        assert loops

        best = max(c.roundness for c in loops)
        # Un carré parfait vaut 0,785 ; sur un damier on doit approcher. Le seuil
        # de rejet de forme, lui, est à 0,12 — l'ancien moteur plafonnait à 0,05
        # sur ce même damier.
        assert best > 0.45, f"rondeur maximale {best:.3f}, boucles trop étirées"

    def test_la_mediane_reste_correcte(self, grid, grid_center, profile):
        graph = build_graph(grid)
        start = _start(graph, grid_center)
        loops = generate_loops(graph, start, 2000.0, profile, sectors=8)
        ronds = sorted(c.roundness for c in loops)
        assert ronds[len(ronds) // 2] > 0.30

    def test_le_trace_ne_revient_pas_au_depart_en_cours_de_route(
        self, grid, grid_center, profile
    ):
        """Le symptôme direct du départ-au-centre : un passage près du départ à mi-parcours."""
        from app.geo import haversine_m

        graph = build_graph(grid)
        start = _start(graph, grid_center)
        origin = graph.nodes[start]

        for cand in generate_loops(graph, start, 2500.0, profile, sectors=8):
            if cand.roundness < 0.3:
                continue  # tracé déjà écarté par la note de forme
            n = len(cand.geometry)
            middle = cand.geometry[n // 4 : 3 * n // 4]
            closest = min(haversine_m(origin, p) for p in middle)
            assert closest > 150.0, (
                f"la boucle repasse à {closest:.0f} m du départ en son milieu"
            )

    def test_plusieurs_formes_sont_proposees(self, grid, grid_center, profile):
        graph = build_graph(grid)
        start = _start(graph, grid_center)
        loops = generate_loops(graph, start, 2500.0, profile, sectors=8, max_candidates=32)
        shapes = {c.shape for c in loops}
        assert len(shapes) >= 2, f"une seule forme produite : {shapes}"

    def test_les_directions_couvrent_le_tour(self, grid, grid_center, profile):
        """Le départ étant un sommet, faire tourner le polygone doit balayer 360°."""
        graph = build_graph(grid)
        start = _start(graph, grid_center)
        loops = generate_loops(graph, start, 2000.0, profile, sectors=8, max_candidates=32)
        bearings = sorted(c.bearing for c in loops)
        assert max(bearings) - min(bearings) > 180.0, bearings


class TestRondeurDeReference:
    """`geo.roundness` sert de juge : on vérifie qu'il note juste."""

    @pytest.mark.parametrize(
        "sides, expected",
        [(3, 0.605), (4, 0.785), (6, 0.907), (60, 1.0)],
    )
    def test_polygones_reguliers(self, sides, expected):
        # Construit à la latitude de Paris pour inclure la projection.
        lat0, lon0 = 48.85, 2.35
        r = 0.01
        pts = [
            (
                lon0 + r * math.cos(2 * math.pi * k / sides) / math.cos(math.radians(lat0)),
                lat0 + r * math.sin(2 * math.pi * k / sides),
            )
            for k in range(sides)
        ]
        pts.append(pts[0])
        assert roundness(pts) == pytest.approx(expected, abs=0.02)
