"""Le classement des propositions.

Deux exigences y sont vérifiées, et toutes deux viennent de contradictions que
l'utilisateur voyait à l'écran :

1. **L'ordre ne doit pas démentir la note affichée.** Une boucle notée B en tête
   et des A derrière, c'est l'app qui se contredit — et ça arrivait, parce que
   les traversées non protégées comptaient dans la note sans compter dans le
   score.
2. **Une demande explicite prime sur un agrément.** « Je veux du plat » n'est
   pas une préférence esthétique : proposer une boucle de montagne parce
   qu'elle part dans une direction encore inutilisée est une erreur, pas une
   variante.
"""

from __future__ import annotations

import asyncio

import pytest

from app import service
from app.elevation import Relief
from app.models import ElevationPref, LoopRequest, SurfacePref
from app.osm.extract import read as read_extract, to_cache
from app.routing.loops import Candidate, SegmentRun
from app.safety.gate import RouteStats, grade_route
from app.service import (
    ELEVATION_BAND_PER_KM,
    GRADE_PENALTY,
    VARIETY_BEARING_WEIGHT,
    VARIETY_OVERLAP_WEIGHT,
    _shortlist_key,
    elevation_goal,
    final_score,
    grade_penalty,
    name_routes,
    preliminary_score,
    select_varied,
    unpaved_share,
    wants_flat,
)

from tests.conftest import ORIGIN_LAT, ORIGIN_LON, STEP, grid_payload

TARGET = 10_000.0


def stats(**over) -> RouteStats:
    base = dict(
        distance_m=TARGET,
        exposed_m=0.0,
        longest_exposed_m=0.0,
        unprotected_crossings=0,
        protected_crossings=0,
        tunnel_unlit_m=0.0,
        closure_m=0.0,
        overlap_share=0.0,
        protected_m=TARGET,
        inferred_m=0.0,
    )
    base.update(over)
    return RouteStats(**base)


def candidate(bearing=0.0, roundness=0.5, edges=None, **over) -> Candidate:
    cand = Candidate(edges=edges if edges is not None else [1, 2, 3], nodes=[])
    cand.stats = stats(**over)
    cand.bearing = bearing
    cand.roundness = roundness
    return cand


def request(**over) -> LoopRequest:
    return LoopRequest(lat=48.0, lon=2.0, distance_km=TARGET / 1000, **over)


class TestNoteEtClassement:
    def test_les_traversees_font_baisser_le_score(self):
        """Elles comptaient dans la note et pas dans le score : c'était l'origine du problème."""
        clean = preliminary_score(candidate(), TARGET, 0.10)
        risky = preliminary_score(candidate(unprotected_crossings=2), TARGET, 0.10)
        assert risky < clean

    @pytest.mark.parametrize(
        "crossings, exposed_share, expected",
        [(0, 0.0, "A"), (1, 0.0, "B"), (0, 0.02, "B"), (0, 0.05, "C")],
    )
    def test_rappel_de_la_regle_de_notation(self, crossings, exposed_share, expected):
        """A : rien d'exposé et aucune traversée · B : jusqu'à 3 % · C : au-delà."""
        s = stats(
            unprotected_crossings=crossings,
            exposed_m=TARGET * exposed_share,
            longest_exposed_m=TARGET * exposed_share,
        )
        assert grade_route(s)[0] == expected

    def test_le_retrait_de_note_depasse_ce_que_la_variete_accorde(self):
        """C'est la condition pour qu'une B ne puisse jamais doubler une A."""
        assert GRADE_PENALTY > VARIETY_OVERLAP_WEIGHT + VARIETY_BEARING_WEIGHT

    def test_une_note_inferieure_coute_toujours_plus_qu_elle_ne_rapporte(self):
        a = candidate()
        b = candidate(unprotected_crossings=1)
        assert grade_route(a.stats)[0] == "A"
        assert grade_route(b.stats)[0] == "B"
        assert grade_penalty(b) - grade_penalty(a) == pytest.approx(GRADE_PENALTY)

    def test_la_selection_ne_remonte_pas_une_boucle_moins_bien_notee(self):
        """Le cas réel : la B partait dans une direction inutilisée et passait devant."""
        req = request()
        # La B est parfaite sur tout le reste — distance, forme — et part à
        # l'opposé, donc la variété la favorise autant qu'elle le peut.
        good = candidate(bearing=0.0, roundness=0.55, edges=[1, 2, 3])
        rival = candidate(bearing=10.0, roundness=0.55, edges=[1, 2, 4])
        worse = candidate(bearing=180.0, roundness=0.60, edges=[7, 8, 9],
                          unprotected_crossings=1)

        scored = sorted(
            ((final_score(c, TARGET, req, None), c, i) for i, c in enumerate((good, rival, worse))),
            key=lambda t: -t[0],
        )
        order = select_varied(scored, 3)
        grades = [grade_route(c.stats)[0] for _s, c, _i in order]
        assert grades == ["A", "A", "B"], grades


class TestPreferenceDeDenivele:
    def test_la_fourchette_exclut_l_absurde(self):
        low, high = ELEVATION_BAND_PER_KM[ElevationPref.flat]
        assert low <= 3.0 <= high
        assert not (low <= 30.0 <= high), "300 m de D+ sur 10 km ne sont pas du plat"

    def test_une_boucle_hors_fourchette_passe_derriere(self):
        """Elle reste proposée — mais jamais devant une boucle conforme."""
        req = request(elevation=ElevationPref.flat)
        flat = candidate(bearing=0.0)
        steep = candidate(bearing=180.0, roundness=0.60)  # meilleure forme, autre direction

        assert final_score(steep, TARGET, req, 300.0) < final_score(flat, TARGET, req, 20.0)

    def test_hors_fourchette_le_moins_eloigne_passe_devant(self):
        """Le cas de Guebwiller : 290 m en tête d'une demande de plat, 120 m en
        troisième, parce que la plus raide partait dans une autre direction."""
        req = request(elevation=ElevationPref.flat)
        first = candidate(bearing=0.0, edges=[1, 2, 3])
        milder = candidate(bearing=10.0, edges=[1, 2, 4])
        steeper = candidate(bearing=180.0, roundness=0.60, edges=[7, 8, 9])
        scored = sorted(
            (
                (final_score(c, TARGET, req, gain), c, i)
                for i, (c, gain) in enumerate(((first, 50.0), (milder, 140.0), (steeper, 320.0)))
            ),
            key=lambda t: -t[0],
        )
        order = [c for _s, c, _i in select_varied(scored, 3)]
        assert order == [first, milder, steeper]

    def test_en_plat_une_b_plate_passe_devant_une_a_de_montagne(self):
        """« Je veux du plat » est un réglage : la B a passé le portail du mode
        choisi, la A monte quatre fois trop."""
        req = request(elevation=ElevationPref.flat)
        steep_a = candidate(bearing=0.0, edges=[1, 2, 3])
        flat_b = candidate(bearing=180.0, edges=[7, 8, 9], unprotected_crossings=1)
        scored = sorted(
            ((final_score(steep_a, TARGET, req, 400.0), steep_a, 0),
             (final_score(flat_b, TARGET, req, 30.0), flat_b, 1)),
            key=lambda t: -t[0],
        )
        assert [c for _s, c, _i in select_varied(scored, 2)] == [flat_b, steep_a]

    def test_en_plat_meme_une_c_plate_passe_devant_une_a_de_montagne(self):
        """Le mode Standard laisse passer des C : qui demande du plat les veut
        avant une boucle de coteau, même mieux notée. Le retrait valait moins
        d'un cran, et une A vallonnée gardait la tête."""
        req = request(elevation=ElevationPref.flat)
        hilly_a = candidate(bearing=0.0, edges=[1, 2, 3])
        flat_c = candidate(bearing=180.0, edges=[7, 8, 9], exposed_m=500.0, longest_exposed_m=300.0)
        assert grade_route(flat_c.stats)[0] == "C"
        # 13 m/km : à peine hors de la fourchette du plat.
        assert final_score(flat_c, TARGET, req, 30.0) > final_score(hilly_a, TARGET, req, 130.0)

    def test_dans_la_fourchette_la_note_garde_la_main(self):
        """Deux boucles plates : la A passe devant la B, même un peu moins plate."""
        req = request(elevation=ElevationPref.flat)
        a = candidate(bearing=0.0, edges=[1, 2, 3])
        b = candidate(bearing=180.0, edges=[7, 8, 9], unprotected_crossings=1)
        assert final_score(a, TARGET, req, 90.0) > final_score(b, TARGET, req, 30.0)

    def test_les_cotes_ecartent_le_plat(self):
        req = request(elevation=ElevationPref.hilly)
        hilly = candidate(bearing=0.0)
        flat = candidate(bearing=180.0, roundness=0.60)
        assert final_score(flat, TARGET, req, 15.0) < final_score(hilly, TARGET, req, 250.0)

    def test_sans_altitude_la_preference_ne_joue_pas(self):
        """Le dénivelé n'est connu qu'après coup : sans lui, on ne pénalise rien."""
        req = request(elevation=ElevationPref.flat)
        cand = candidate()
        assert final_score(cand, TARGET, req, None) == pytest.approx(
            preliminary_score(cand, TARGET, req.tolerance) - grade_penalty(cand)
        )

    def test_le_plus_proche_de_la_cible_gagne(self):
        req = request(elevation=ElevationPref.rolling)
        a = candidate(bearing=0.0)
        b = candidate(bearing=0.0)
        # cible 10 m/km, soit 100 m sur 10 km
        assert final_score(a, TARGET, req, 100.0) > final_score(b, TARGET, req, 160.0)


def surfaced(paved: float, unpaved: float, **over) -> Candidate:
    """Une boucle de 10 km, `unpaved` mètres de chemins et le reste goudronné."""
    cand = candidate(**over)
    cand.segments = [
        SegmentRun(
            coords=[], length_m=length, risk=0.0, level="safe", separation=2.0,
            speed_kmh=10.0, surface=surface, lit=None, road=None, inferred=False,
        )
        for surface, length in (("paved", paved), ("trail", unpaved))
        if length
    ]
    return cand


class TestPreferenceDeTerrain:
    """Route, Mixte, Sentier : le réglage ne jouait qu'au tracé, jamais au classement."""

    def test_la_part_hors_bitume(self):
        assert unpaved_share(surfaced(6000.0, 4000.0)) == pytest.approx(0.4)
        assert unpaved_share(candidate()) is None

    def test_en_sentier_une_b_de_chemins_passe_devant_une_a_goudronnee(self):
        req = request(surface=SurfacePref.trail)
        road_a = surfaced(10_000.0, 0.0, bearing=0.0, edges=[1, 2, 3])
        trail_b = surfaced(3000.0, 7000.0, bearing=180.0, edges=[7, 8, 9], unprotected_crossings=1)
        assert final_score(trail_b, TARGET, req, None) > final_score(road_a, TARGET, req, None)

    def test_en_route_les_chemins_passent_derriere(self):
        req = request(surface=SurfacePref.road)
        paved = surfaced(9500.0, 500.0)
        dirt = surfaced(6000.0, 4000.0, roundness=0.60)
        assert final_score(paved, TARGET, req, None) > final_score(dirt, TARGET, req, None)

    def test_mixte_ecarte_le_tout_bitume_quand_il_y_a_des_chemins(self):
        req = request(surface=SurfacePref.mixed)
        assert final_score(surfaced(7000.0, 3000.0), TARGET, req, None) > final_score(
            surfaced(10_000.0, 0.0, roundness=0.60), TARGET, req, None
        )

    def test_en_ville_sans_chemins_la_note_decide_comme_avant(self):
        """Toutes hors fourchette « Mixte » : le retrait commun ne change rien, et
        quelques allées de parc ne font pas passer une B devant une A."""
        req = request(surface=SurfacePref.mixed)
        street_a = surfaced(10_000.0, 0.0, bearing=0.0, edges=[1, 2, 3])
        park_b = surfaced(9000.0, 1000.0, bearing=180.0, edges=[7, 8, 9], unprotected_crossings=1)
        assert final_score(street_a, TARGET, req, None) > final_score(park_b, TARGET, req, None)

    def test_la_reserve_se_choisit_sur_les_reglages(self):
        """Seule la réserve reçoit son altitude : une boucle plate écartée avant
        ne pouvait plus jamais sortir. Le relief de la zone l'y fait entrer."""

        class Slope:
            """Un relief qui monte de 10 m par degré de longitude."""

            def climb(self, coords):
                return sum(abs(b[0] - a[0]) * 10.0 for a, b in zip(coords, coords[1:]))

        req = request(elevation=ElevationPref.flat)
        flat = candidate(roundness=0.30)
        flat.geometry = [(0.0, 0.0), (0.0, 1.0), (0.0, 0.0)]
        steep = candidate(roundness=0.60)
        steep.geometry = [(0.0, 0.0), (30.0, 0.0), (0.0, 0.0)]  # 300 m de D+ sur 10 km
        assert preliminary_score(steep, TARGET, 0.1) > preliminary_score(flat, TARGET, 0.1)
        assert _shortlist_key(flat, TARGET, req, Slope()) > _shortlist_key(steep, TARGET, req, Slope())
        assert _shortlist_key(steep, TARGET, req, None) > _shortlist_key(flat, TARGET, req, None)


class TestDeniveleVise:
    """« Environ 150 m » : RunnrZ ne permet pas de demander un D+, et 150 m sur
    10 km tombaient entre Vallonné (100 m) et Côtes (220 m). Même règle que les
    préférences : hors fourchette derrière, jamais rejetée ; dedans, la note."""

    def test_la_fourchette_se_centre_sur_le_d_plus_vise(self):
        def goal(climb: float) -> list[float]:
            target, (low, high) = elevation_goal(request(climb_m=climb))
            return [target, low, high]

        assert goal(150.0) == pytest.approx([15.0, 12.0, 18.0])
        # 20 % de 30 m, c'est 6 m : la fourchette garde 2 m/km de part et d'autre.
        assert goal(30.0) == pytest.approx([3.0, 1.0, 5.0])
        assert goal(0.0) == pytest.approx([0.0, 0.0, 2.0])

    def test_sans_d_plus_vise_la_preference_reste(self):
        req = request(elevation=ElevationPref.hilly)
        assert elevation_goal(req) == (22.0, ELEVATION_BAND_PER_KM[ElevationPref.hilly])

    def test_le_d_plus_vise_remplace_la_preference(self):
        """Un D+ visé avec « Plat » resté choisi : c'est le D+ qui compte, et la
        pente ne se paie plus au tracé."""
        req = request(elevation=ElevationPref.flat, climb_m=300.0)
        assert not wants_flat(req)
        assert final_score(candidate(), TARGET, req, 300.0) > final_score(candidate(), TARGET, req, 30.0)

    def test_hors_fourchette_meme_une_a_passe_derriere(self):
        req = request(climb_m=150.0)
        steep_a = candidate(bearing=0.0, edges=[1, 2, 3])
        near_c = candidate(bearing=180.0, edges=[7, 8, 9], exposed_m=500.0, longest_exposed_m=300.0)
        assert grade_route(near_c.stats)[0] == "C"
        assert final_score(near_c, TARGET, req, 150.0) > final_score(steep_a, TARGET, req, 230.0)

    def test_dans_la_fourchette_la_note_reprend_la_main(self):
        req = request(climb_m=150.0)
        a = candidate(bearing=0.0, edges=[1, 2, 3])
        b = candidate(bearing=180.0, edges=[7, 8, 9], unprotected_crossings=1)
        assert final_score(a, TARGET, req, 125.0) > final_score(b, TARGET, req, 150.0)

    def test_un_d_plus_negatif_est_refuse(self):
        with pytest.raises(ValueError):
            request(climb_m=-10.0)

    def test_sur_le_damier_le_d_plus_vise_choisit_le_coteau(self, monkeypatch):
        """Un damier dont la moitié est monte de 5 % : 0 m visé reste à
        l'ouest, 60 m vont chercher le coteau — en traçant comme en classant."""
        payload = grid_payload(15)
        extract = read_extract(to_cache(read_extract(payload)))
        foot = ORIGIN_LON + 7 * STEP

        def height(lon: float) -> float:
            return 100.0 + max(0.0, lon - foot) * 111_000.0 * 0.05

        async def fake_area(lat, lon, radius_m, *, target_m=0.0):
            return extract

        async def fake_many(routes):
            return [Relief([height(lon) for lon, _lat in coords], False) for coords in routes]

        async def calm(lat, lon):
            return None

        monkeypatch.setattr(service, "fetch_area", fake_area)
        monkeypatch.setattr(service, "fetch_many", fake_many)
        monkeypatch.setattr(service, "current_wind", calm)

        def ascents(climb: float) -> list[float]:
            service.graph_cache.clear()
            req = LoopRequest(
                lat=ORIGIN_LAT + 7 * STEP, lon=foot, distance_km=4.0, climb_m=climb,
                time_of_day="day", limit=4,
            )
            return [r.ascent_m for r in asyncio.run(service.plan_loops(req)).routes]

        try:
            flat, hilly = ascents(0.0), ascents(60.0)
        finally:
            service.graph_cache.clear()
        assert flat and hilly
        assert abs(hilly[0] - 60.0) < abs(flat[0] - 60.0)
        assert sum(hilly) / len(hilly) > sum(flat) / len(flat) + 20.0, (flat, hilly)


class TestTours:
    """Les tours complètent la liste ; ils ne passent pas devant une boucle entière.

    Depuis la rue des Primevères, à Soultz, douze propositions de 9 km en
    mettaient huit en tours, et cinq en tête : notés A, et restés en plaine,
    ils passaient devant des boucles entières notées B ou à peine trop
    vallonnées. « 2 × 4,5 km » n'est pas une variante de la boucle demandée,
    c'est ce qu'on propose faute de mieux.
    """

    @staticmethod
    def lapped(**over) -> Candidate:
        cand = candidate(**over)
        cand.laps = 2
        return cand

    def test_une_boucle_entiere_notee_b_passe_devant_des_tours_notes_a(self):
        req = request()
        tours = self.lapped(bearing=0.0, edges=[1, 2, 3])
        entiere = candidate(bearing=180.0, edges=[7, 8, 9], unprotected_crossings=1)
        scored = sorted(
            ((final_score(c, TARGET, req, None), c, i) for i, c in enumerate((tours, entiere))),
            key=lambda t: -t[0],
        )
        assert [c for _s, c, _i in select_varied(scored, 2)] == [entiere, tours]

    def test_meme_hors_fourchette_la_boucle_entiere_passe_devant(self):
        req = request(elevation=ElevationPref.rolling)
        tours = self.lapped(bearing=0.0, edges=[1, 2, 3])
        entiere = candidate(bearing=180.0, edges=[7, 8, 9])
        scored = sorted(
            (
                (final_score(tours, TARGET, req, 100.0), tours, 0),
                (final_score(entiere, TARGET, req, 230.0), entiere, 1),
            ),
            key=lambda t: -t[0],
        )
        assert select_varied(scored, 2)[0][1] is entiere

    def test_les_tours_completent_la_liste(self):
        req = request()
        scored = [(final_score(self.lapped(), TARGET, req, None), self.lapped(), 0)]
        assert len(select_varied(scored, 5)) == 1


class TestVariete:
    def test_le_premier_choisi_est_le_mieux_note(self):
        req = request()
        best = candidate(bearing=0.0, roundness=0.60, edges=[1, 2, 3])
        other = candidate(bearing=180.0, roundness=0.30, edges=[7, 8, 9])
        scored = sorted(
            ((final_score(c, TARGET, req, None), c, i) for i, c in enumerate((best, other))),
            key=lambda t: -t[0],
        )
        assert select_varied(scored, 2)[0][1] is best

    def test_a_note_egale_la_direction_departage(self):
        """Deux clones et un tracé opposé : le tracé opposé doit être retenu."""
        req = request()
        first = candidate(bearing=0.0, edges=[1, 2, 3])
        clone = candidate(bearing=5.0, edges=[1, 2, 3])
        away = candidate(bearing=170.0, edges=[7, 8, 9])
        scored = sorted(
            ((final_score(c, TARGET, req, None), c, i) for i, c in enumerate((first, clone, away))),
            key=lambda t: -t[0],
        )
        picked = select_varied(scored, 2)
        bearings = sorted(c.bearing for _s, c, _i in picked)
        assert bearings[-1] > 100.0, bearings

    def test_on_rend_tout_ce_qu_on_a_si_c_est_peu(self):
        req = request()
        scored = [(final_score(candidate(), TARGET, req, None), candidate(), 0)]
        assert len(select_varied(scored, 5)) == 1


class TestNoms:
    """Nommer les propositions ensemble, pour qu'elles se distinguent.

    Nommer chaque boucle par sa voie la plus longue échoue précisément quand on
    en propose beaucoup : les boucles d'un même quartier partagent leur artère,
    et l'écran affiche quatre fois le même nom. Le nom cesse alors d'aider à
    choisir, ce qui est sa seule fonction.
    """

    @staticmethod
    def with_roads(bearing: float, roads: dict[str, float]) -> Candidate:
        cand = candidate(bearing=bearing)
        cand.segments = [
            SegmentRun(
                coords=[], length_m=length, risk=0.0, level="safe", separation=2.0,
                speed_kmh=30.0, surface="paved", lit=None, road=road, inferred=False,
            )
            for road, length in roads.items()
        ]
        return cand

    def test_l_artere_partagee_perd_contre_la_rue_propre(self):
        """Le cœur du sujet : ce qui distingue prime sur ce qui est long."""
        a = self.with_roads(0.0, {"Avenue Commune": 3000.0, "Rue des Lilas": 800.0})
        b = self.with_roads(90.0, {"Avenue Commune": 3000.0, "Rue du Port": 700.0})
        noms = name_routes([a, b])
        assert "Rue des Lilas" in noms[0], noms
        assert "Rue du Port" in noms[1], noms

    def test_deux_boucles_n_ont_jamais_le_meme_nom(self):
        identiques = [
            self.with_roads(0.0, {"Avenue Commune": 3000.0, "Rue A": 500.0}),
            self.with_roads(10.0, {"Avenue Commune": 3000.0, "Rue B": 400.0}),
            self.with_roads(20.0, {"Avenue Commune": 3000.0, "Rue C": 300.0}),
        ]
        noms = name_routes(identiques)
        assert len(set(noms)) == 3, noms

    def test_une_impasse_ne_bat_pas_une_berge(self):
        """L'exclusivité est pondérée par la longueur, sinon 30 m l'emporteraient."""
        a = self.with_roads(0.0, {"Quai de Seine": 2500.0, "Impasse Muette": 30.0})
        b = self.with_roads(180.0, {"Rue Ailleurs": 2000.0})
        assert "Quai de Seine" in name_routes([a, b])[0]

    def test_une_boucle_sans_voie_nommee_garde_sa_direction(self):
        anonyme = self.with_roads(0.0, {})
        assert name_routes([anonyme]) == ["Boucle nord"]

    def test_la_direction_reste_dans_le_nom(self):
        a = self.with_roads(90.0, {"Rue Unique": 1000.0})
        assert name_routes([a])[0].startswith("Boucle est")

    def test_toutes_les_voies_deja_prises_retombe_sur_la_plus_longue(self):
        """Deux boucles rigoureusement identiques : la seconde doit tout de même
        recevoir un nom, quitte à répéter la voie — la direction les sépare."""
        a = self.with_roads(0.0, {"Rue Seule": 1000.0})
        b = self.with_roads(180.0, {"Rue Seule": 1000.0})
        noms = name_routes([a, b])
        assert all("Rue Seule" in n for n in noms)
        assert noms[0] != noms[1]
