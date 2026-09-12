"""Export GPX — en particulier l'alignement des altitudes sur la géométrie."""

from __future__ import annotations

import xml.etree.ElementTree as ET

import pytest

from app.gpx import build_gpx

COORDS = [(2.0, 48.0), (2.001, 48.0), (2.002, 48.0), (2.0, 48.0)]

NS = {"gpx": "http://www.topografix.com/GPX/1/1"}


def trackpoints(xml: str):
    return ET.fromstring(xml).findall(".//gpx:trkpt", NS)


class TestStructure:
    def test_xml_valide(self):
        xml = build_gpx("Test", [(2.0, 48.0), (2.001, 48.001)])
        assert trackpoints(xml)

    def test_un_point_par_coordonnee(self):
        coords = [(2.0 + i * 0.001, 48.0) for i in range(25)]
        assert len(trackpoints(build_gpx("Test", coords))) == 25

    def test_attribution_odbl_presente(self):
        """Obligation de la licence ODbL : elle doit suivre le fichier exporté."""
        xml = build_gpx("Test", [(2.0, 48.0), (2.001, 48.0)])
        assert "OpenStreetMap" in xml
        assert "opendatacommons.org/licenses/odbl" in xml

    def test_nom_echappe(self):
        xml = build_gpx("Boucle <nord> & retour", [(2.0, 48.0), (2.001, 48.0)])
        assert "<nord>" not in xml.replace("&lt;nord&gt;", "")
        ET.fromstring(xml)  # doit rester analysable


class TestAltitudes:
    def test_serie_alignee(self):
        coords = [(2.0, 48.0), (2.001, 48.0), (2.002, 48.0)]
        xml = build_gpx("Test", coords, [100.0, 110.0, 120.0])
        eles = [float(p.find("gpx:ele", NS).text) for p in trackpoints(xml)]
        assert eles == pytest.approx([100.0, 110.0, 120.0], abs=0.5)

    def test_echantillonnage_plus_court_que_la_geometrie(self):
        """Le vrai cas : 3 altitudes pour 21 points de tracé.

        Apparier par indice donnerait 100, 200, 300 aux trois premiers points
        puis rien — soit une montée de 200 m sur les vingt premiers mètres.
        """
        coords = [(2.0 + i * 0.0001, 48.0) for i in range(21)]
        xml = build_gpx("Test", coords, [100.0, 200.0, 300.0])
        eles = [float(p.find("gpx:ele", NS).text) for p in trackpoints(xml)]

        assert len(eles) == 21
        assert eles[0] == pytest.approx(100.0, abs=0.5)
        assert eles[10] == pytest.approx(200.0, abs=1.0)  # à mi-parcours
        assert eles[-1] == pytest.approx(300.0, abs=0.5)
        # La progression doit être monotone, sans marche d'escalier.
        assert all(b >= a for a, b in zip(eles, eles[1:]))

    def test_sans_altitude(self):
        xml = build_gpx("Test", [(2.0, 48.0), (2.001, 48.0)])
        assert all(p.find("gpx:ele", NS) is None for p in trackpoints(xml))


class TestTypeDActivite:
    """Un fichier marqué « running » importé dans un compteur de vélo y arrive
    classé comme une course à pied, avec des zones d'effort qui n'ont aucun sens."""

    def test_course_par_defaut(self):
        assert "<type>running</type>" in build_gpx("Boucle", COORDS)

    def test_velo(self):
        assert "<type>cycling</type>" in build_gpx("Boucle", COORDS, sport="bike")

    def test_sport_inconnu_retombe_sur_la_course(self):
        assert "<type>running</type>" in build_gpx("Boucle", COORDS, sport="licorne")
