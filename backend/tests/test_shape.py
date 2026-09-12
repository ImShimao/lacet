"""Forme de la boucle — le quotient isopérimétrique.

C'est le critère qui distingue une vraie boucle d'un aller-retour dont le retour
passe par la rue parallèle : ce dernier ne se recoupe jamais, donc le seul
critère de recouvrement le laisse passer.
"""

from __future__ import annotations

import math

import pytest

from app.geo import roundness


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
