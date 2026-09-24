"""D+ : le seuil d'hystérésis, et les primitives géométriques."""

from __future__ import annotations

import asyncio

import pytest

from app.elevation import (
    COARSE_THRESHOLD_M,
    ElevationCache,
    _fetch_with_fallback,
    _ign_values,
    _opentopo_values,
    ascent_descent,
    fetch_many,
    smooth,
)
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


class TestCouverture:
    """Quand un fournisseur ne couvre pas la région.

    L'IGN couvre la France et répond -99999 ailleurs. Ces -99999 devenaient des
    zéros : cinq boucles proposées en Valais annonçaient « D+ 0 m », et la
    réponse passait pour valide, si bien qu'OpenTopoData — mondial — n'était
    jamais interrogé.
    """

    @staticmethod
    def _fournisseurs(monkeypatch, ign, opentopo):
        async def faux(provider, coords):
            return ign(coords) if provider == "ign" else opentopo(coords)

        monkeypatch.setattr("app.elevation._fetch", faux)

    def test_pas_de_donnee_n_est_pas_zero_metre(self):
        # C'est ce -99999, pris pour le niveau de la mer, qui rendait plates
        # toutes les boucles hors de France.
        assert _ign_values({"elevations": [120.5, -99999.0, None]}) == [120.5, None, None]
        assert _ign_values({"elevations": [{"z": -99999.0}, {"z": 88.0}]}) == [None, 88.0]
        assert _opentopo_values({"results": [{"elevation": None}, {"elevation": 3.0}]}) == [None, 3.0]

    def test_le_second_complete_le_premier(self, monkeypatch):
        vus = []

        def ign(coords):
            # Hors de France : pas de donnée, pas zéro mètre.
            return [c[0] * 100 if c[0] < 7.2 else None for c in coords]

        def opentopo(coords):
            vus.append(list(coords))
            return [1000.0] * len(coords)

        self._fournisseurs(monkeypatch, ign, opentopo)
        coords = [(7.1, 47.5), (7.3, 47.5)]
        values, coarse = asyncio.run(_fetch_with_fallback(coords))
        assert values == [710.0, 1000.0]
        # Le second n'a reçu que le point resté sans réponse.
        assert vus == [[(7.3, 47.5)]]
        # Et la finesse suit le fournisseur : fin côté IGN, grossier côté monde.
        assert coarse == [False, True]

    def test_un_point_grossier_emporte_le_seuil(self, monkeypatch, tmp_path):
        """Un modèle à trente mètres tremble : deux mètres de seuil compteraient
        ce tremblement comme des côtes — 72 m de D+ inventés à Paris."""

        def ign(coords):
            return [c[0] * 100 if c[0] < 7.2 else None for c in coords]

        def monde(coords):
            return [1000.0] * len(coords)

        self._fournisseurs(monkeypatch, ign, monde)
        monkeypatch.setattr("app.elevation._cache", ElevationCache(tmp_path))
        fin = asyncio.run(fetch_many([[(7.1, 47.5), (7.15, 47.5)]]))[0]
        assert fin.threshold == 2.0
        mêlé = asyncio.run(fetch_many([[(7.1, 47.6), (7.3, 47.6)]]))[0]
        assert mêlé.threshold == COARSE_THRESHOLD_M

    def test_sans_profil_plutot_qu_un_faux(self, monkeypatch, tmp_path):
        def ign(coords):
            return [None] * len(coords)

        def rien(coords):
            return [None] * len(coords)

        self._fournisseurs(monkeypatch, ign, rien)
        monkeypatch.setattr("app.elevation._cache", ElevationCache(tmp_path))
        routes = [[(7.5, 46.3), (7.51, 46.3)]]
        assert asyncio.run(fetch_many(routes)) == [None]
