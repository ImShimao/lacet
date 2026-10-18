"""L1 / L2 — le tableau de risque de référence.

Ces valeurs sont celles annoncées dans le document de conception. Si un test
d'ici casse, ce n'est pas le test qu'il faut corriger : c'est que le modèle a
changé, et il faut décider si c'était voulu.
"""

from __future__ import annotations

import pytest

from app.models import SafetyMode, Sport, SurfacePref
from app.osm.graph import Edge
from app.routing.weights import build_profile
from app.safety.exclusion import is_excluded, oneway_for
from app.safety.risk import (
    EXPOSED_RISK,
    classify_surface,
    evaluate_edge,
    risk_score,
    separation,
    separation_bike,
    speed_of,
)


class TestFormule:
    def test_voie_dediee_risque_nul(self):
        assert risk_score(10, 2.0) == 0.0

    def test_trottoir_annule_le_risque(self):
        assert risk_score(50, 2.0) == 0.0

    def test_rue_lente_est_gratuite(self):
        """Personne ne fait un détour pour éviter une rue à 30."""
        assert risk_score(30, 0.0) == 0.0
        assert risk_score(40, 0.0) == 0.0

    def test_cinquante_sans_trottoir_reste_anodin(self):
        """On court tous les jours sur une rue à 50 sans trottoir."""
        assert risk_score(50, 0.0) == pytest.approx(0.111, abs=0.005)

    def test_soixante_dix_reste_acceptable(self):
        """Sur le bas-côté d'une route à 70, ça passe — sous le seuil d'exposition."""
        assert risk_score(70, 0.0) == pytest.approx(1.0)
        assert risk_score(70, 0.0) < EXPOSED_RISK

    def test_quatre_vingts_bascule(self):
        assert risk_score(80, 0.0) == pytest.approx(1.778, abs=0.005)
        assert risk_score(80, 0.0) >= EXPOSED_RISK

    def test_accotement_ramene_sous_le_seuil(self):
        """Un accotement sur une route à 80 la rend de nouveau fréquentable."""
        assert risk_score(80, 1.0) == pytest.approx(0.889, abs=0.005)
        assert risk_score(80, 1.0) < EXPOSED_RISK

    def test_croissance_superlineaire(self):
        """Passer de 70 à 100 doit bien plus que doubler le risque."""
        assert risk_score(100, 0.0) / risk_score(70, 0.0) == pytest.approx(4.0)

    def test_borne_superieure(self):
        assert risk_score(500, 0.0) == 8.0


class TestVitesse:
    @pytest.mark.parametrize(
        "tags,expected",
        [
            ({"highway": "residential"}, 50.0),
            ({"highway": "secondary"}, 80.0),
            ({"highway": "living_street"}, 20.0),
            ({"highway": "residential", "maxspeed": "30"}, 30.0),
            ({"highway": "residential", "maxspeed": "30 km/h"}, 30.0),
            ({"highway": "residential", "maxspeed": "FR:urban"}, 50.0),
            ({"highway": "residential", "maxspeed": "walk"}, 10.0),
            ({"highway": "residential", "maxspeed": "n'importe quoi"}, 50.0),
        ],
    )
    def test_lecture_maxspeed(self, tags, expected):
        assert speed_of(tags) == expected

    def test_zone_30_ecrase_la_classe(self):
        assert speed_of({"highway": "residential", "zone:maxspeed": "FR:30"}) == 30.0

    def test_agglomeration_plafonne_a_50(self):
        """Une départementale qui traverse un bourg n'y roule pas à 80."""
        tags = {"highway": "secondary"}
        assert speed_of(tags, in_builtup=False) == 80.0
        assert speed_of(tags, in_builtup=True) == 50.0

    def test_agglomeration_ne_releve_jamais(self):
        """Le plafond urbain abaisse, il n'augmente pas les voies déjà lentes."""
        assert speed_of({"highway": "living_street"}, in_builtup=True) == 20.0
        assert speed_of({"highway": "service"}, in_builtup=True) == 30.0

    def test_maxspeed_tague_prime_sur_l_agglomeration(self):
        tags = {"highway": "secondary", "maxspeed": "70"}
        assert speed_of(tags, in_builtup=True) == 70.0


class TestSeparation:
    def test_voie_dediee(self):
        sep, inferred, _ = separation({"highway": "footway"}, in_builtup=True)
        assert (sep, inferred) == (2.0, False)

    def test_trottoir_tague(self):
        sep, inferred, _ = separation(
            {"highway": "residential", "sidewalk": "both"}, in_builtup=True
        )
        assert (sep, inferred) == (2.0, False)

    def test_trottoir_par_cote(self):
        sep, _, _ = separation(
            {"highway": "residential", "sidewalk:left": "yes"}, in_builtup=True
        )
        assert sep == 2.0

    def test_absence_taguee_est_croyable(self):
        """`sidewalk=no` est une information, pas une absence d'information."""
        sep, inferred, _ = separation(
            {"highway": "residential", "sidewalk": "no"}, in_builtup=True
        )
        assert (sep, inferred) == (0.0, False)

    def test_accotement(self):
        sep, _, _ = separation(
            {"highway": "tertiary", "shoulder": "yes"}, in_builtup=False
        )
        assert sep == 1.0


class TestRegleDuDoute:
    """L2 — l'inférence doit être asymétrique."""

    def test_ville_optimiste(self):
        sep, inferred, _ = separation({"highway": "residential"}, in_builtup=True)
        assert sep == 1.5
        assert inferred is True

    def test_campagne_pessimiste(self):
        sep, inferred, _ = separation({"highway": "unclassified"}, in_builtup=False)
        assert sep == 0.0
        assert inferred is True

    def test_voie_rapide_reste_pessimiste(self):
        """Une voie à 80 sans tag ne mérite pas le bénéfice du doute."""
        sep, _, _ = separation({"highway": "secondary", "maxspeed": "80"}, in_builtup=True)
        assert sep == 0.0

    def test_asymetrie_effective(self):
        ville = evaluate_edge({"highway": "residential"}, in_builtup=True)
        campagne = evaluate_edge({"highway": "residential"}, in_builtup=False)
        assert ville.risk < campagne.risk

    def test_voie_communale_penalisee_sans_etre_exposee(self):
        """Une route de vignes n'est pas une départementale.

        À 80 par défaut, toutes les voies communales comptaient comme exposées,
        et à Meursault la recherche à pied ne rendait que des tours répétés.
        """
        communale = evaluate_edge({"highway": "unclassified"}, in_builtup=False)
        assert communale.level == "caution"
        assert communale.risk < EXPOSED_RISK
        assert evaluate_edge({"highway": "tertiary"}, in_builtup=False).level == "risk"
        # Une limite taguée l'emporte toujours sur la valeur par défaut.
        taguee = evaluate_edge({"highway": "unclassified", "maxspeed": "80"}, in_builtup=False)
        assert taguee.level == "risk"


class TestExclusion:
    @pytest.mark.parametrize(
        "tags",
        [
            {"highway": "motorway"},
            {"highway": "trunk"},
            {"highway": "motorway_link"},
            {"highway": "construction"},
            {"highway": "residential", "foot": "no"},
            {"highway": "service", "access": "private"},
            {"highway": "path", "sac_scale": "alpine_hiking"},
            {"highway": "footway", "route": "ferry"},
        ],
    )
    def test_exclusions(self, tags):
        assert is_excluded(tags) is not None

    @pytest.mark.parametrize(
        "tags",
        [
            {"highway": "residential"},
            {"highway": "footway"},
            {"highway": "path"},
            {"highway": "track"},
            {"highway": "service", "access": "private", "foot": "yes"},
        ],
    )
    def test_admissions(self, tags):
        assert is_excluded(tags) is None

    def test_tunnel_sans_trottoir(self):
        assert is_excluded({"highway": "secondary", "tunnel": "yes"}) is not None

    def test_tunnel_pieton_accepte(self):
        assert is_excluded({"highway": "footway", "tunnel": "yes"}) is None

    def test_sentier_difficile_autorise_en_mode_trail(self):
        tags = {"highway": "path", "sac_scale": "demanding_mountain_hiking"}
        assert is_excluded(tags) is not None
        assert is_excluded(tags, allow_trail=True) is None

    @pytest.mark.parametrize(
        "tags",
        [
            {"highway": "track", "abandoned": "yes"},
            {"highway": "path", "disused": "yes"},
            {"highway": "track", "abandoned:highway": "track"},
            {"highway": "path", "trail_visibility": "horrible"},
            {"highway": "path", "trail_visibility": "no"},
        ],
    )
    def test_chemin_disparu_exclu_meme_en_mode_trail(self, tags):
        assert is_excluded(tags, allow_trail=True) is not None

    def test_ancienne_piste_devenue_sentier_admise(self):
        """Mesuré à Guebwiller : c'est la piste qui est désaffectée, pas le sentier."""
        assert is_excluded({"highway": "path", "disused:highway": "track"}) is None

    @pytest.mark.parametrize(
        "tags",
        [
            {"highway": "path", "trail_visibility": "bad"},
            {"highway": "path", "informal": "yes"},
            {"highway": "track", "smoothness": "impassable"},
        ],
    )
    def test_chemin_mal_trace_reserve_au_mode_trail(self, tags):
        assert is_excluded(tags) is not None
        assert is_excluded(tags, allow_trail=True) is None

    def test_aucune_roue_ne_passe_meme_en_vtt(self):
        tags = {"highway": "track", "smoothness": "impassable"}
        assert is_excluded(tags, allow_trail=True, sport="bike") is not None


class TestSurface:
    @pytest.mark.parametrize(
        "tags,expected",
        [
            ({"surface": "asphalt"}, "paved"),
            ({"surface": "gravel"}, "gravel"),
            ({"surface": "dirt"}, "trail"),
            ({"highway": "path"}, "trail"),
            ({"highway": "track", "tracktype": "grade1"}, "gravel"),
            ({"highway": "track"}, "trail"),
            ({"highway": "residential"}, "paved"),
        ],
    )
    def test_classification(self, tags, expected):
        assert classify_surface(tags) == expected


class TestNiveaux:
    def test_niveau_expose(self):
        ev = evaluate_edge({"highway": "secondary"}, in_builtup=False)
        assert ev.level == "risk"

    def test_niveau_sur(self):
        ev = evaluate_edge({"highway": "footway"}, in_builtup=True)
        assert ev.level == "safe"

    def test_rue_de_ville_sans_trottoir_reste_sure(self):
        ev = evaluate_edge({"highway": "residential", "sidewalk": "no"}, in_builtup=True)
        assert ev.level == "safe"

    def test_soixante_dix_est_une_vigilance_pas_un_rejet(self):
        ev = evaluate_edge({"highway": "tertiary", "maxspeed": "70"}, in_builtup=False)
        assert ev.level == "caution"


class TestVelo:
    """Ce qui protège un cycliste n'est pas ce qui protège un coureur."""

    def test_trottoir_ne_protege_pas_le_cycliste(self):
        tags = {"highway": "secondary", "sidewalk": "both", "maxspeed": "80"}
        assert separation(tags, in_builtup=False)[0] == 2.0
        assert separation_bike(tags, in_builtup=False)[0] == 0.0

    @pytest.mark.parametrize(
        "tags",
        [
            {"highway": "secondary", "cycleway": "track"},
            {"highway": "secondary", "cycleway:right": "lane"},
            {"highway": "cycleway"},
            {"highway": "path", "bicycle": "designated"},
        ],
    )
    def test_amenagement_cyclable_protege(self, tags):
        assert separation_bike(tags, in_builtup=True)[0] == 2.0

    def test_rue_apaisee_compte_comme_accotement(self):
        tags = {"highway": "residential", "maxspeed": "30"}
        assert separation_bike(tags, in_builtup=True)[0] == 1.0

    def test_escaliers_exclus_a_velo(self):
        assert is_excluded({"highway": "steps"}, sport="bike") is not None
        assert is_excluded({"highway": "steps"}, sport="run") is None

    def test_interdiction_velo_respectee(self):
        tags = {"highway": "residential", "bicycle": "no"}
        assert is_excluded(tags, sport="bike") is not None
        assert is_excluded(tags, sport="run") is None

    def test_piste_interdite_aux_pietons_ouverte_au_velo(self):
        """Le marquage même d'une piste cyclable séparée : elle manquait au graphe vélo."""
        tags = {"highway": "cycleway", "foot": "no"}
        assert is_excluded(tags, sport="bike") is None
        assert is_excluded(tags, sport="run") is not None

    def test_acces_ferme_rouvert_pour_le_velo_par_bicycle(self):
        tags = {"highway": "service", "access": "no", "bicycle": "designated"}
        assert is_excluded(tags, sport="bike") is None
        assert is_excluded(tags, sport="run") is not None
        assert is_excluded({**tags, "foot": "yes"}, sport="run") is None

    def test_une_piste_cyclable_protege_aussi_le_coureur(self):
        """Pas de voitures : ni « trottoir supposé », ni exposée hors agglomération."""
        for builtup in (True, False):
            sep, inferred, _ = separation({"highway": "cycleway"}, in_builtup=builtup)
            assert sep == 2.0 and not inferred

    def test_sens_unique_a_velo_pas_a_pied(self):
        tags = {"highway": "residential", "oneway": "yes"}
        assert oneway_for(tags, "run") == 0
        assert oneway_for(tags, "bike") == 1
        assert oneway_for({**tags, "oneway": "-1"}, "bike") == -1
        assert oneway_for({"highway": "primary", "junction": "roundabout"}, "bike") == 1

    @pytest.mark.parametrize(
        "extra",
        [
            {"oneway:bicycle": "no"},
            {"cycleway": "opposite_lane"},
            {"cycleway:left": "opposite_track"},
            {"cycleway:left": "lane", "cycleway:left:oneway": "-1"},
        ],
    )
    def test_contresens_cyclable(self, extra):
        assert oneway_for({"highway": "residential", "oneway": "yes", **extra}, "bike") == 0

    def test_voie_verte_sans_revetement_tague_n_est_pas_un_sentier(self):
        assert classify_surface({"highway": "path", "bicycle": "designated"}) == "paved"
        assert classify_surface({"highway": "path"}) == "trail"

    def test_zone_pietonne_fermee_aux_velos_se_roule_au_pas(self):
        """Sûre, puisque sans voitures, mais pénalisée comme un trottoir — sauf ouverte aux vélos.

        La séparation de 2 qu'elle reçoit la faisait échapper à la pénalité des
        voies piétonnes, et les boucles traversaient le centre piéton à vélo.
        """
        profile = build_profile(SurfacePref.mixed, SafetyMode.safe, False, Sport.bike)

        def weight(tags: dict[str, str]) -> float:
            safety = evaluate_edge(tags, in_builtup=True, sport="bike")
            edge = Edge(a=0, b=1, length_m=100.0, coords=[], safety=safety, way_id=1, name=None, tunnel=False)
            return profile.weight(edge)

        ouverte = weight({"highway": "pedestrian", "bicycle": "yes"})
        assert weight({"highway": "pedestrian"}) == pytest.approx(4 * ouverte)
        assert weight({"highway": "footway"}) == pytest.approx(4 * ouverte)
        assert weight({"highway": "footway", "bicycle": "designated"}) == pytest.approx(ouverte)
