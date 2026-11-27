"""L3 — le portail de validation."""

from __future__ import annotations

from app.safety.gate import RouteStats, grade_route, run_gate, thresholds_for


def stats(**overrides) -> RouteStats:
    base = dict(
        distance_m=10_000.0,
        exposed_m=0.0,
        longest_exposed_m=0.0,
        unprotected_crossings=0,
        protected_crossings=0,
        tunnel_unlit_m=0.0,
        closure_m=0.0,
        overlap_share=0.0,
        protected_m=10_000.0,
        inferred_m=0.0,
    )
    base.update(overrides)
    return RouteStats(**base)


class TestPortail:
    def test_boucle_propre_passe(self):
        assert run_gate(stats(), "safe").passed

    def test_exposition_globale_trop_forte(self):
        result = run_gate(stats(exposed_m=500.0, longest_exposed_m=100.0), "safe")
        assert not result.passed
        assert result.failures[0].code == "exposed_share"

    def test_portion_continue_trop_longue(self):
        """Le cas que le pourcentage seul laisse passer.

        200 m exposés sur 10 km, c'est 2 % : sous le seuil de 3 %. Mais c'est
        200 m d'un seul tenant le long d'une départementale, donc c'est non.
        """
        result = run_gate(stats(exposed_m=200.0, longest_exposed_m=200.0), "safe")
        assert not result.passed
        assert result.failures[0].code == "longest_exposed"

    def test_vingt_metres_de_traversee_acceptes(self):
        assert run_gate(stats(exposed_m=20.0, longest_exposed_m=20.0), "safe").passed

    def test_trop_de_traversees(self):
        result = run_gate(stats(unprotected_crossings=3), "safe")
        assert not result.passed
        assert result.failures[0].code == "crossings"

    def test_tunnel_interdit(self):
        assert not run_gate(stats(tunnel_unlit_m=10.0), "safe").passed

    def test_boucle_non_fermee(self):
        assert not run_gate(stats(closure_m=120.0), "safe").passed

    def test_aller_retour_rejete(self):
        assert not run_gate(stats(overlap_share=0.55), "safe").passed

    def test_mode_standard_plus_permissif(self):
        s = stats(exposed_m=600.0, longest_exposed_m=300.0)
        assert not run_gate(s, "safe").passed
        assert run_gate(s, "standard").passed

    def test_tous_les_motifs_sont_rapportes(self):
        result = run_gate(
            stats(exposed_m=900.0, longest_exposed_m=900.0, unprotected_crossings=9),
            "safe",
        )
        assert len(result.failures) == 3

    def test_chaque_refus_a_son_message_de_repechage(self):
        """Le repêchage explique le refus le plus fréquent par son code.

        Deux messages étaient rangés sous le nom de la mesure plutôt que sous le
        code du refus : un village où tout traversait la départementale lisait
        le message général, jamais celui qui parlait des traversées.
        """
        from app.service import _SALVAGED_MESSAGE

        for overrides in (
            {"exposed_m": 500.0, "longest_exposed_m": 100.0},
            {"exposed_m": 200.0, "longest_exposed_m": 200.0},
            {"unprotected_crossings": 3},
        ):
            code = run_gate(stats(**overrides), "safe").failures[0].code
            assert code in _SALVAGED_MESSAGE, code


class TestNote:
    def test_note_a(self):
        grade, _ = grade_route(stats())
        assert grade == "A"

    def test_une_traversee_isolee_garde_le_a(self):
        grade, _ = grade_route(stats(unprotected_crossings=1))
        assert grade == "A"

    def test_plusieurs_traversees_non_protegees_empechent_le_a(self):
        grade, _ = grade_route(stats(unprotected_crossings=2))
        assert grade == "B"

    def test_note_b(self):
        grade, _ = grade_route(stats(exposed_m=250.0, longest_exposed_m=100.0))
        assert grade == "B"

    def test_note_c(self):
        grade, _ = grade_route(stats(exposed_m=800.0, longest_exposed_m=300.0))
        assert grade == "C"

    def test_avertissement_si_trop_estime(self):
        _, notes = grade_route(stats(inferred_m=6_000.0))
        assert any("estimée" in n for n in notes)


class TestBudgetDeTraversees:
    """Le budget de traversées grandit avec la distance — au-delà de 10 km.

    Un nombre fixe ne peut pas couvrir une plage de 0,8 à 250 km. La mesure sur
    des villes réelles est sans ambiguïté : en ville, les boucles générées
    comptent **zéro** traversée non protégée ; en rase campagne, quatre à douze
    par dix kilomètres, parce qu'il n'y a pas d'autre façon d'aller quelque part.
    Un seuil de deux rejetait donc tout, partout, dès qu'on sortait de la ville —
    y compris les meilleurs candidats disponibles.
    """

    def test_une_sortie_urbaine_garde_les_seuils_d_avant(self):
        """La règle ne doit rien changer là où elle ne servait déjà à rien."""
        for km in (1.0, 5.0, 10.0):
            th = thresholds_for("safe", "run")
            assert th.crossings_budget(km * 1000) == 2, km

    def test_le_budget_grandit_au_dela_de_dix_kilometres(self):
        th = thresholds_for("safe", "run")
        assert th.crossings_budget(21_100) == 6
        assert th.crossings_budget(42_000) == 15

    def test_il_croit_de_facon_monotone(self):
        th = thresholds_for("safe", "run")
        budgets = [th.crossings_budget(km * 1000) for km in range(1, 60)]
        assert budgets == sorted(budgets)

    def test_le_mode_standard_est_plus_large(self):
        for km in (10.0, 21.1, 42.0):
            strict = thresholds_for("safe", "run").crossings_budget(km * 1000)
            loose = thresholds_for("standard", "run").crossings_budget(km * 1000)
            assert loose > strict, km

    def test_un_semi_marathon_rural_reste_discriminant(self):
        """Le portail doit encore trancher, pas tout accepter.

        Sur un semi en Bourgogne, les candidats mesurés s'étalent de 12 à 24
        traversées : le budget doit tomber entre les deux.
        """
        budget = thresholds_for("standard", "run").crossings_budget(21_100)
        assert 12 <= budget < 24


class TestSeuilsParSport:
    """Ce qui est une exposition acceptable n'est pas la même chose à pied et à vélo."""

    def test_le_velo_tolere_de_plus_longs_troncons(self):
        run = thresholds_for("safe", "run")
        bike = thresholds_for("safe", "bike")
        assert bike.longest_exposed_m > run.longest_exposed_m
        assert bike.exposed_share > run.exposed_share

    def test_un_kilometre_de_departementale_passe_a_velo_pas_a_pied(self):
        """Le cas qui rendait le mode Sûr inutilisable au-delà de la ville."""
        long_stretch = stats(distance_m=80_000.0, exposed_m=900.0, longest_exposed_m=900.0)
        assert not run_gate(long_stretch, "safe", "run").passed
        assert run_gate(long_stretch, "safe", "bike").passed

    def test_le_sport_inconnu_retombe_sur_la_course(self):
        """Le réglage le plus strict est le repli sûr."""
        assert thresholds_for("safe", "trottinette") is thresholds_for("safe", "run")

    def test_le_mode_inconnu_retombe_sur_le_mode_sur(self):
        assert thresholds_for("nimportequoi", "run") is thresholds_for("safe", "run")
