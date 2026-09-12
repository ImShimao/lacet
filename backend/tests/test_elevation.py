"""D+ : le seuil d'hystérésis, et les primitives géométriques."""

from __future__ import annotations

import pytest

from app.elevation import ascent_descent, smooth
from app.geo import bearing_deg, haversine_m, point_in_ring, resample
from app.solar import is_night


class TestDenivele:
    def test_montee_franche(self):
        ascent, descent = ascent_descent([100, 110, 120, 130])
        assert ascent == pytest.approx(30.0)
        assert descent == 0.0

    def test_bruit_ignore(self):
        """Le cœur du problème : un MNT bruité sur terrain plat.

        Sans seuil, ces oscillations de ±1 m donneraient D+ ≈ 9 m sur du plat.
        """
        noisy = [100, 101, 100, 101, 100, 99, 100, 101, 100, 99]
        ascent, descent = ascent_descent(noisy)
        assert ascent == 0.0
        assert descent == 0.0

    def test_vraie_bosse_dans_le_bruit(self):
        series = [100, 101, 100, 108, 107, 108, 100, 101, 100]
        ascent, descent = ascent_descent(series)
        assert ascent == pytest.approx(8.0)
        assert descent == pytest.approx(8.0)

    def test_boucle_fermee_equilibree(self):
        """Une boucle revient à son point de départ : D+ et D− doivent coïncider."""
        series = [100, 105, 112, 120, 115, 108, 100]
        ascent, descent = ascent_descent(series)
        assert ascent == pytest.approx(descent)

    def test_seuil_configurable(self):
        series = [100, 103, 100]
        assert ascent_descent(series, threshold=2.0)[0] == pytest.approx(3.0)
        assert ascent_descent(series, threshold=5.0)[0] == 0.0

    def test_serie_trop_courte(self):
        assert ascent_descent([100]) == (0.0, 0.0)
        assert ascent_descent([]) == (0.0, 0.0)


class TestLissage:
    def test_pic_isole_attenue(self):
        out = smooth([100, 100, 130, 100, 100], window=3)
        assert out[2] < 130
        assert len(out) == 5

    def test_serie_courte_inchangee(self):
        assert smooth([100, 101], window=5) == [100, 101]


class TestGeometrie:
    def test_distance_connue(self):
        """Un degré de latitude ≈ 111,2 km."""
        d = haversine_m((2.0, 48.0), (2.0, 49.0))
        assert d == pytest.approx(111_195, rel=0.01)

    def test_distance_nulle(self):
        assert haversine_m((2.0, 48.0), (2.0, 48.0)) == 0.0

    @pytest.mark.parametrize(
        "target,expected",
        [((2.0, 49.0), 0.0), ((3.0, 48.0), 90.0), ((2.0, 47.0), 180.0)],
    )
    def test_cap(self, target, expected):
        assert bearing_deg((2.0, 48.0), target) == pytest.approx(expected, abs=1.0)

    def test_point_dans_polygone(self):
        carre = [(0.0, 0.0), (2.0, 0.0), (2.0, 2.0), (0.0, 2.0)]
        assert point_in_ring((1.0, 1.0), carre)
        assert not point_in_ring((3.0, 1.0), carre)
        assert not point_in_ring((1.0, 5.0), carre)

    def test_echantillonnage(self):
        ligne = [(2.0, 48.0), (2.0, 48.01)]  # ≈ 1112 m
        points = resample(ligne, 200.0)
        assert len(points) >= 6
        assert points[0][1] == ligne[0]
        assert points[-1][1] == ligne[-1]


class TestSoleil:
    def test_minuit_est_la_nuit(self):
        from datetime import datetime, timezone

        minuit = datetime(2026, 6, 21, 0, 30, tzinfo=timezone.utc)
        assert is_night(48.85, 2.35, minuit)

    def test_midi_est_le_jour(self):
        from datetime import datetime, timezone

        midi = datetime(2026, 6, 21, 12, 0, tzinfo=timezone.utc)
        assert not is_night(48.85, 2.35, midi)

    def test_dix_huit_heures_hiver_vs_ete(self):
        """À 18 h UTC, il fait jour en juin et nuit en décembre à Paris."""
        from datetime import datetime, timezone

        juin = datetime(2026, 6, 21, 18, 0, tzinfo=timezone.utc)
        decembre = datetime(2026, 12, 21, 18, 0, tzinfo=timezone.utc)
        assert not is_night(48.85, 2.35, juin)
        assert is_night(48.85, 2.35, decembre)
