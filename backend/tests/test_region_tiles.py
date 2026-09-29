"""Ce que la carte régionale livre, et ce qu'elle laisse à Overpass.

Le script vit dans `frontend/scripts` — c'est la compilation de l'app iPhone qui
l'exécute —, mais le choix des tuiles est une décision de moteur : une tuile
livrée de trop, et l'app embarque des rues fausses ; une tuile manquante, et
quelqu'un attend Overpass en bas de chez lui, ce qui est arrivé.
"""

from __future__ import annotations

import importlib.util
from pathlib import Path

import pytest

SCRIPT = Path(__file__).resolve().parents[2] / "frontend" / "scripts" / "region_tiles.py"
spec = importlib.util.spec_from_file_location("region_tiles", SCRIPT)
region_tiles = importlib.util.module_from_spec(spec)
spec.loader.exec_module(region_tiles)

TILE = region_tiles.TILE_DEG
# Un carré de 0,4° de côté, aligné sur la grille : huit tuiles de côté.
CARRE = [[(7.0, 47.0), (7.4, 47.0), (7.4, 47.4), (7.0, 47.4)]]


@pytest.fixture
def sans_marge():
    return region_tiles.shipped_tiles(CARRE, [], 0.0, None)


class TestTuilesLivrees:
    def test_sans_marge_le_territoire_et_rien_autour(self, sans_marge):
        # Une tuile n'est livrée que si la limite ne la traverse pas : sur un
        # carré de 8 × 8 tuiles, la rangée du bord porte les sommets de la
        # limite, et il en reste 7 × 7. C'est volontairement prudent — une tuile
        # coupée par le bord des données serait à moitié vide sans le dire.
        assert len(sans_marge) == 49
        assert (141, 941) in sans_marge
        assert (140, 940) not in sans_marge  # la rangée du bord, écartée
        assert (139, 940) not in sans_marge  # et plus à l'ouest, dehors

    def test_la_marge_ajoute_une_couronne(self, sans_marge):
        avec = region_tiles.shipped_tiles(CARRE, [], 6000.0, None)
        assert avec > sans_marge
        # Six kilomètres, c'est un peu plus d'une tuile en longitude (3,7 km à
        # cette latitude) : la rangée écartée revient, et celle d'après avec.
        assert (140, 941) in avec
        assert (139, 941) in avec
        assert (136, 941) not in avec

    def test_rien_de_ce_que_la_source_ne_couvre_pas(self):
        # L'emprise réellement extraite s'arrête à 7,10 : au-delà, une tuile
        # serait tronquée, et une tuile tronquée ment sur ce qu'elle contient.
        source = (7.0, 47.0, 7.1, 47.4)
        tiles = region_tiles.shipped_tiles(CARRE, [], 6000.0, source)
        # Seules 7,00–7,05 et 7,05–7,10 tiennent entièrement dans l'emprise.
        assert {ix for ix, _ in tiles} == {140, 141}
        # Et rien qui chevauche son bord, ni au-delà.
        assert all(iy * TILE >= 47.0 - 1e-9 for _, iy in tiles)

    def test_une_marge_sans_source_reste_possible(self):
        """Le cas du script lancé à la main, sur un extrait qu'on sait large."""
        assert region_tiles.shipped_tiles(CARRE, [], 6000.0, None)


class TestLesNoeudsGardes:
    """Ce qu'une tuile garde des nœuds : passages piétons et barrières fermées.

    Un portail fermé au bout de sept cents mètres de boucle a fait faire demi-tour
    en pleine sortie. OpenStreetMap le savait ; la tuile ne le gardait pas.
    """

    def test_les_passages_pietons(self):
        assert region_tiles.kept_node({"highway": "crossing", "crossing": "zebra"})

    def test_un_portail_prive_ou_verrouille(self):
        assert region_tiles.kept_node({"barrier": "gate", "access": "private"})
        assert region_tiles.kept_node({"barrier": "gate", "locked": "yes"})
        assert region_tiles.kept_node({"barrier": "lift_gate", "foot": "no"})

    def test_ce_qui_ne_ferme_qu_aux_velos(self):
        assert region_tiles.kept_node({"barrier": "stile"})
        assert region_tiles.kept_node({"barrier": "gate", "bicycle": "no"})

    def test_pas_les_portails_ouverts(self):
        # La plupart des portails de parc, les bornes, les chicanes : on passe.
        assert not region_tiles.kept_node({"barrier": "gate"})
        assert not region_tiles.kept_node({"barrier": "bollard"})
        assert not region_tiles.kept_node({"barrier": "kerb"})
        assert not region_tiles.kept_node({"amenity": "bench"})
