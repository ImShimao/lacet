"""Forme de la boucle — le quotient isopérimétrique.

C'est le critère qui distingue une vraie boucle d'un aller-retour dont le retour
passe par la rue parallèle : ce dernier ne se recoupe jamais, donc le seul
critère de recouvrement le laisse passer.
"""

from __future__ import annotations

import math

import pytest

from app.geo import backtrack_share, roundness


def circle(n: int = 64, radius_deg: float = 0.01) -> list[tuple[float, float]]:
    return [
        (
            2.0 + radius_deg * math.cos(2 * math.pi * i / n) / math.cos(math.radians(48.0)),
            48.0 + radius_deg * math.sin(2 * math.pi * i / n),
        )
        for i in range(n)
    ]


class TestRondeur:
    def test_cercle(self):
        assert roundness(circle()) == pytest.approx(1.0, abs=0.01)

    def test_carre(self):
        square = [(2.0, 48.0), (2.01, 48.0), (2.01, 48.0066), (2.0, 48.0066)]
        assert roundness(square) == pytest.approx(0.785, abs=0.05)

    def test_triangle_equilateral(self):
        pts = [
            (2.0 + 0.01 * math.cos(a) / math.cos(math.radians(48.0)), 48.0 + 0.01 * math.sin(a))
            for a in (math.pi / 2, math.pi * 7 / 6, math.pi * 11 / 6)
        ]
        assert roundness(pts) == pytest.approx(0.605, abs=0.03)

    def test_aller_retour_est_degenere(self):
        """Le cas à écarter : on part, on revient par le même chemin."""
        out = [(2.0 + i * 0.001, 48.0) for i in range(30)]
        back = list(reversed(out))
        assert roundness(out + back) < 0.01

    def test_sucette(self):
        """Long couloir, petite boucle au bout, retour par le couloir.

        Aire non nulle, donc rondeur non nulle — mais très en dessous du seuil.
        """
        corridor = [(2.0 + i * 0.001, 48.0) for i in range(30)]
        head = circle(n=16, radius_deg=0.001)
        head = [(x + 0.030, y) for x, y in head]
        path = corridor + head + list(reversed(corridor))
        assert roundness(path) < 0.12

    def test_rue_parallele_reste_degenere(self):
        """Aller par une rue, retour par celle d'à côté, 25 m plus loin.

        Le tracé ne se recoupe pas — `overlap_share` vaut zéro — mais ce n'est
        pas une boucle pour autant.
        """
        out = [(2.0 + i * 0.001, 48.0) for i in range(30)]
        back = [(x, 48.00022) for x, _ in reversed(out)]
        assert roundness(out + back) < 0.05

    def test_trace_trop_court(self):
        assert roundness([(2.0, 48.0), (2.001, 48.0)]) == 0.0
        assert roundness([]) == 0.0

    def test_borne_a_un(self):
        assert roundness(circle(n=256)) <= 1.0


def _metres(points: list[tuple[float, float]]) -> list[tuple[float, float]]:
    """(x, y) en mètres autour de Paris, en (lon, lat)."""
    kx, ky = 111_320 * math.cos(math.radians(48.8)), 110_540
    return [(2.3 + x / kx, 48.8 + y / ky) for x, y in points]


class TestCrochet:
    """Le crochet en U : aller au bout d'une branche, revenir par la rue d'à côté."""

    def test_un_carre_n_en_a_pas(self):
        carre = _metres([(0, 0), (800, 0), (800, 800), (0, 800), (0, 0)])
        assert backtrack_share(carre) == 0.0

    def test_le_crochet_se_mesure(self):
        # Un carré de 800 m, avec une branche de 300 m au milieu du côté nord :
        # montée par une rue, retour par la parallèle, trente mètres plus loin.
        avec = _metres([
            (0, 0), (800, 0), (800, 800), (415, 800), (415, 1100),
            (385, 1100), (385, 800), (0, 800), (0, 0),
        ])
        share = backtrack_share(avec)
        # Le retour de la branche, environ 300 m sur 3,8 km.
        assert 0.04 < share < 0.12

    def test_la_rue_du_depart_ne_compte_pas(self):
        # 150 m pour sortir de chez soi, la boucle, et le retour par la même rue.
        sucette = _metres([
            (0, 0), (0, 150), (400, 150), (400, 550), (-400, 550), (-400, 150), (0, 150), (0, 0),
        ])
        assert backtrack_share(sucette) == 0.0
