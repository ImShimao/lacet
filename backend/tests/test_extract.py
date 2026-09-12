"""Le format d'extrait, brut et compact.

Overpass rend chaque point de géométrie comme un petit dictionnaire
`{"lat": …, "lon": …}` : sur un extrait parisien, 2,9 millions de
dictionnaires à reconstruire **à chaque lecture du cache**. Le format compact
range les coordonnées à plat, ce qui allège le fichier de 41 % et sa lecture de
30 %.

Un changement de format de cache est exactement le genre de chose qui casse en
silence : ces tests vérifient donc surtout que les deux formats décrivent le
**même** extrait, et qu'un cache écrit par la version précédente reste lisible.
"""

from __future__ import annotations

import json

import pytest

from app.osm.extract import (
    FORMAT_VERSION,
    Extract,
    from_cache,
    from_overpass,
    read,
    to_cache,
)
from app.osm.graph import build_graph
from tests.conftest import grid_payload


@pytest.fixture
def brut() -> dict:
    return grid_payload(dangerous_row=4)


def aller_retour(payload: dict) -> Extract:
    """Passe par le disque, sérialisation JSON comprise."""
    return from_cache(json.loads(json.dumps(to_cache(from_overpass(payload)))))


class TestLecture:
    def test_les_voies_sont_reconnues(self, brut):
        extract = from_overpass(brut)
        assert extract.ways
        assert all(w.tags.get("highway") for w in extract.ways)

    def test_les_polygones_de_zone_batie_sont_separes(self, brut):
        extract = from_overpass(brut)
        assert len(extract.landuse) == 1
        assert all("highway" not in w.tags or w.tags["highway"] for w in extract.ways)

    def test_les_coordonnees_sont_en_lon_lat(self, brut):
        """L'ordre GeoJSON, pas celui d'Overpass — une inversion serait invisible
        sur un damier carré et catastrophique sur une vraie ville."""
        lon, lat = from_overpass(brut).ways[0].coords[0]
        assert 2.0 < lon < 3.0
        assert 48.0 < lat < 49.0

    def test_une_voie_sans_geometrie_est_ignoree(self):
        payload = {"elements": [{"type": "way", "id": 1, "tags": {"highway": "residential"}}]}
        assert not from_overpass(payload).ways

    def test_un_extrait_vide_reste_vide(self):
        assert not from_overpass({"elements": []})
        assert not from_overpass({})


class TestAllerRetour:
    def test_les_voies_survivent(self, brut):
        avant, apres = from_overpass(brut), aller_retour(brut)
        assert len(avant.ways) == len(apres.ways)
        for a, b in zip(avant.ways, apres.ways):
            assert (a.id, a.tags, a.nodes) == (b.id, b.tags, b.nodes)

    def test_les_geometries_sont_identiques_au_point_pres(self, brut):
        avant, apres = from_overpass(brut), aller_retour(brut)
        for a, b in zip(avant.ways, apres.ways):
            assert a.coords == b.coords

    def test_les_polygones_survivent(self, brut):
        assert from_overpass(brut).landuse == aller_retour(brut).landuse

    def test_les_traversees_survivent(self):
        payload = {
            "elements": [
                {"type": "node", "id": 7, "lon": 2.3, "lat": 48.8,
                 "tags": {"highway": "crossing", "crossing": "traffic_signals"}},
                {"type": "node", "id": 8, "lon": 2.4, "lat": 48.9, "tags": {"amenity": "bench"}},
            ]
        }
        crossings = aller_retour(payload).crossings
        assert len(crossings) == 1, "seuls les nœuds de traversée sont gardés"
        assert (crossings[0].id, crossings[0].lon, crossings[0].lat) == (7, 2.3, 48.8)

    def test_le_graphe_obtenu_est_le_meme(self, brut):
        """Le contrôle qui compte : mêmes nœuds, mêmes arêtes, même sécurité."""
        g1 = build_graph(from_overpass(brut))
        g2 = build_graph(aller_retour(brut))

        assert len(g1.nodes) == len(g2.nodes)
        assert len(g1.edges) == len(g2.edges)
        assert g1.nodes == g2.nodes
        for e1, e2 in zip(g1.edges, g2.edges):
            assert (e1.a, e1.b, e1.name, e1.tunnel) == (e2.a, e2.b, e2.name, e2.tunnel)
            assert e1.length_m == pytest.approx(e2.length_m)
            assert e1.safety == e2.safety
            assert e1.coords == e2.coords


class TestCompatibilite:
    def test_un_cache_de_l_ancienne_version_reste_lisible(self, brut):
        """Sans cela, tous les extraits déjà sur disque deviendraient muets."""
        assert read(brut).ways

    def test_le_format_compact_est_reconnu(self, brut):
        assert read(to_cache(from_overpass(brut))).ways

    def test_une_version_inconnue_est_refusee(self, brut):
        futur = to_cache(from_overpass(brut))
        futur["v"] = FORMAT_VERSION + 1
        assert from_cache(futur) is None

    def test_une_version_inconnue_ne_passe_pas_pour_du_brut(self, brut):
        """`read` doit rendre un extrait vide, pas interpréter n'importe quoi."""
        futur = to_cache(from_overpass(brut))
        futur["v"] = FORMAT_VERSION + 1
        assert not read(futur).ways

    def test_le_compact_porte_sa_version(self, brut):
        assert to_cache(from_overpass(brut))["v"] == FORMAT_VERSION


class TestPoids:
    def test_le_compact_est_plus_leger(self, brut):
        extract = from_overpass(brut)
        gros = json.dumps(brut)
        compact = json.dumps(to_cache(extract))
        assert len(compact) < len(gros)

    def test_la_geometrie_est_a_plat(self, brut):
        """C'est là que se joue le gain : plus un dictionnaire par point."""
        premiere = to_cache(from_overpass(brut))["ways"][0]
        plat = premiere[3]
        assert all(isinstance(v, float) for v in plat)
        assert len(plat) % 2 == 0
