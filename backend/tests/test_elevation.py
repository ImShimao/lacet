"""D+ : le seuil d'hystérésis, et les primitives géométriques."""

from __future__ import annotations

import asyncio
import math
import struct
import zlib

import pytest

from app.elevation import (
    COARSE_THRESHOLD_M,
    ElevationCache,
    Relief,
    Terrain,
    _fetch_with_fallback,
    _ign_values,
    _opentopo_values,
    ascent_descent,
    fetch_many,
    shape_relief,
    smooth_along,
    terrain_values,
    terrarium_grid,
    terrarium_pixel,
)
from app.geo import bearing_deg, haversine_m, point_in_ring, resample
from app.solar import is_night


class TestTerrain:
    """La grille du relief de la zone, lue avant de tracer."""

    @staticmethod
    def plane(lon: float, lat: float) -> float:
        return 200.0 + 3000.0 * (lon - 2.3) - 5000.0 * (lat - 48.8)

    def test_la_grille_couvre_le_rayon(self):
        t = Terrain(48.8, 2.3, 2000.0)
        lons = [p[0] for p in t.points()]
        lats = [p[1] for p in t.points()]
        assert len(lons) == t.n_lat * t.n_lon
        assert min(lats) <= 48.8 - 2000.0 / 111_320.0 and max(lats) >= 48.8 + 2000.0 / 111_320.0
        half_lon = 2000.0 / (111_320.0 * math.cos(math.radians(48.8)))
        assert min(lons) <= 2.3 - half_lon and max(lons) >= 2.3 + half_lon

    def test_un_plan_est_rendu_exactement(self):
        """L'interpolation bilinéaire reproduit une pente régulière."""
        t = Terrain(48.8, 2.3, 2000.0)
        t.values = [self.plane(lon, lat) for lon, lat in t.points()]
        assert t.at(2.3123, 48.8077) == pytest.approx(self.plane(2.3123, 48.8077))

    def test_au_dela_du_bord_la_valeur_du_bord(self):
        t = Terrain(48.8, 2.3, 2000.0)
        t.values = [self.plane(lon, lat) for lon, lat in t.points()]
        edge = t.at(2.3, (t.i0 + t.n_lat - 1) * t.step_lat)
        assert t.at(2.3, 49.5) == pytest.approx(edge)

    def test_la_grille_garde_la_meme_taille_quand_la_boucle_grandit(self):
        """Une seule requête à l'IGN, du 5 au 100 km."""
        for radius in (1500.0, 5000.0, 12_000.0, 55_000.0):
            t = Terrain(47.9, 7.2, radius)
            assert t.n_lat * t.n_lon < 3000, radius

    def test_la_montee_compte_aussi_la_descente(self):
        t = Terrain(48.8, 2.3, 2000.0)
        t.values = [self.plane(lon, lat) for lon, lat in t.points()]
        aller = [(2.30, 48.8), (2.31, 48.8)]
        assert t.climb(aller + [(2.30, 48.8)]) == pytest.approx(2 * 3000.0 * 0.01)


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
        ascent, descent = ascent_descent(noisy, threshold=2.0)
        assert ascent == 0.0
        assert descent == 0.0

    def test_vraie_bosse_dans_le_bruit(self):
        series = [100, 101, 100, 108, 107, 108, 100, 101, 100]
        ascent, descent = ascent_descent(series, threshold=2.0)
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
        out = smooth_along([100, 100, 130, 100, 100], 50, 60)
        assert out[2] < 130
        assert len(out) == 5

    def test_serie_courte_inchangee(self):
        assert smooth_along([100, 101], 50, 60) == [100, 101]

    def test_noyau_plus_court_que_le_pas(self):
        """Des points tous les 100 m et un noyau de 60 : rien à lisser."""
        assert smooth_along([100, 104, 100, 104], 100, 60) == [100, 104, 100, 104]

    def test_le_tremblement_du_modele_ne_monte_pas(self):
        """Un mètre de bruit, un point sur deux : le lissage l'efface avant le seuil."""
        noisy = [100.0 + (i % 2) for i in range(40)]
        values, threshold = shape_relief(Relief(noisy, False), 50)
        assert ascent_descent(values, threshold)[0] == 0.0

    def test_une_bosse_courte_garde_sa_hauteur(self):
        """Le défaut corrigé : quinze mètres de bosse sur deux cents fondaient de
        moitié dans l'ancienne moyenne sur trois points espacés de cent mètres."""
        flat = [200.0] * 10
        bump = [205.0, 210.0, 215.0, 210.0, 205.0]
        values, threshold = shape_relief(Relief(flat + bump + flat, False), 50)
        assert ascent_descent(values, threshold)[0] == pytest.approx(15.0, abs=2.5)

    def test_le_grossier_lisse_et_seuille_davantage(self):
        values, threshold = shape_relief(Relief([100.0, 102.0, 100.0, 102.0, 100.0], True), 50)
        assert threshold == COARSE_THRESHOLD_M
        assert ascent_descent(values, threshold)[0] == 0.0


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
    def _fournisseurs(monkeypatch, ign, opentopo, terrain=lambda coords: [None] * len(coords)):
        async def faux(provider, coords):
            if provider == "terrain":
                return terrain(coords)
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
        values, coarse, _local = asyncio.run(_fetch_with_fallback(coords))
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
        assert fin.coarse is False
        mêlé = asyncio.run(fetch_many([[(7.1, 47.6), (7.3, 47.6)]]))[0]
        assert mêlé.coarse is True

    def test_un_point_relu_juste_apres_sa_mise_en_cache_reste_un_nombre(self, monkeypatch, tmp_path):
        """En mémoire, le cache garde le couple (altitude, finesse) tel quel, et
        sa relecture l'emballait une seconde fois : la recherche suivante au
        même endroit recevait des couples en guise d'altitudes, et le relief de
        la zone plantait."""

        def ign(coords):
            return [200.0 + c[0] for c in coords]

        self._fournisseurs(monkeypatch, ign, ign)
        monkeypatch.setattr("app.elevation._cache", ElevationCache(tmp_path))
        route = [[(7.1, 47.5), (7.15, 47.5)]]
        premier = asyncio.run(fetch_many(route))[0]
        second = asyncio.run(fetch_many(route))[0]
        assert second == premier
        assert all(isinstance(z, float) for z in second.values)

    def test_sans_profil_plutot_qu_un_faux(self, monkeypatch, tmp_path):
        def ign(coords):
            return [None] * len(coords)

        def rien(coords):
            return [None] * len(coords)

        self._fournisseurs(monkeypatch, ign, rien)
        monkeypatch.setattr("app.elevation._cache", ElevationCache(tmp_path))
        routes = [[(7.5, 46.3), (7.51, 46.3)]]
        assert asyncio.run(fetch_many(routes)) == [None]


def _png(rows: list[list[tuple[int, int, int]]], filters: list[int]) -> bytes:
    """Un PNG RGB, chaque ligne avec le filtre demandé (0 rien, 1 gauche, 2 haut)."""

    def chunk(kind: bytes, body: bytes) -> bytes:
        return struct.pack(">I", len(body)) + kind + body + struct.pack(">I", zlib.crc32(kind + body))

    width, raw, prev = len(rows[0]), b"", bytes(len(rows[0]) * 3)
    for row, f in zip(rows, filters):
        line = bytes(v for px in row for v in px)
        if f == 1:
            line = bytes((line[i] - (line[i - 3] if i >= 3 else 0)) & 255 for i in range(len(line)))
        elif f == 2:
            line = bytes((line[i] - prev[i]) & 255 for i in range(len(line)))
        raw += bytes([f]) + line
        prev = bytes(v for px in row for v in px)
    head = struct.pack(">IIBBBBB", width, len(rows), 8, 2, 0, 0, 0)
    return b"\x89PNG\r\n\x1a\n" + chunk(b"IHDR", head) + chunk(b"IDAT", zlib.compress(raw)) + chunk(b"IEND", b"")


class TestTerrainTiles:
    """L'altitude sans réseau, lue dans les tuiles terrarium gardées."""

    def test_le_png_se_decode_quel_que_soit_le_filtre(self):
        # 128 × 256 + 10 + 128 / 256 − 32768 = 10,5 m
        rows = [[(128, 10, 128), (128, 20, 0)], [(128, 30, 64), (127, 255, 0)]]
        for filters in ([0, 0], [1, 2], [2, 1]):
            assert terrarium_grid(_png(rows, filters)) == [[10.5, 20.0], [30.25, -1.0]]

    def test_au_centre_d_un_pixel_sa_valeur(self):
        grid = [[float(x + 1000 * y) for x in range(256)] for y in range(256)]
        gx, gy = terrarium_pixel(7.2108, 47.9097)
        x, y = math.floor(gx), math.floor(gy)
        # Un point posé pile au centre du pixel lit ce pixel, sans voisin.
        lon = (x + 0.5) / (2**12 * 256) * 360 - 180
        z = terrain_values([(lon, 47.9097)], lambda *_: grid)[0]
        assert z == pytest.approx(x % 256 + 1000 * (gy % 256), abs=1e-6)

    def test_sans_tuile_pas_de_reponse(self):
        assert terrain_values([(7.21, 47.91)], lambda *_: None) == [None]

    def test_les_tuiles_completent_l_ign_sans_entrer_au_cache(self, monkeypatch, tmp_path):
        """Hors ligne, les tuiles répondent, au réglage grossier. Mais leur
        réponse n'est pas rangée : l'IGN, sinon, ne serait plus redemandé."""

        def hors_ligne(coords):
            raise OSError("pas de réseau")

        TestCouverture._fournisseurs(
            monkeypatch, hors_ligne, hors_ligne, terrain=lambda coords: [300.0] * len(coords)
        )
        cache = ElevationCache(tmp_path)
        monkeypatch.setattr("app.elevation._cache", cache)
        relief = asyncio.run(fetch_many([[(7.1, 47.5), (7.15, 47.5)]]))[0]
        assert relief == Relief([300.0, 300.0], True)
        assert cache.lookup([(7.1, 47.5)]) == {}
