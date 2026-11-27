"""Finir vent dans le dos.

Une boucle passe par tous les points cardinaux : l'ordre dans lequel elle le
fait est gratuit. Le seul moment où le vent se paie vraiment est la fin, quand
il ne reste plus rien dans les jambes — c'est donc la seule portion qu'on
cherche à orienter.

Ces tests vérifient surtout ce que le terme de vent **ne doit pas** faire :
prendre le pas sur la sécurité, agir par temps calme, ou casser la recherche
quand le service météo ne répond pas.
"""

from __future__ import annotations

import math

import pytest

from app.models import ElevationPref, LoopRequest
from app.routing.loops import Candidate
from app.safety.gate import RouteStats
from app.service import WIND_WEIGHT, final_score
from app.wind import MIN_SPEED_KMH, Wind, tailwind_finish

LAT = 48.85
TARGET = 10_000.0


def leg(bearing_deg: float, points: int = 30, step: float = 0.0004):
    """Une ligne droite d'une trentaine de points, dans le cap demandé."""
    out = [(2.35, LAT)]
    dy = math.cos(math.radians(bearing_deg)) * step
    dx = math.sin(math.radians(bearing_deg)) * step / math.cos(math.radians(LAT))
    for _ in range(points):
        lon, lat = out[-1]
        out.append((lon + dx, lat + dy))
    return out


def stats(**over) -> RouteStats:
    base = dict(
        distance_m=TARGET, exposed_m=0.0, longest_exposed_m=0.0,
        unprotected_crossings=0, protected_crossings=0, tunnel_unlit_m=0.0,
        closure_m=0.0, overlap_share=0.0, protected_m=TARGET, inferred_m=0.0,
    )
    base.update(over)
    return RouteStats(**base)


def candidate(geometry, **over) -> Candidate:
    cand = Candidate(edges=[1, 2, 3], nodes=[])
    cand.stats = stats(**over)
    cand.geometry = geometry
    cand.roundness = 0.5
    cand.bearing = 0.0
    return cand


NORD = Wind(bearing=0.0, speed_kmh=30.0)  # souffle **vers** le nord
CALME = Wind(bearing=0.0, speed_kmh=4.0)


class TestOrientation:
    def test_courir_dans_le_sens_du_vent_vaut_un(self):
        assert tailwind_finish(leg(0.0), NORD) == pytest.approx(1.0, abs=0.02)

    def test_courir_contre_le_vent_vaut_zero(self):
        assert tailwind_finish(leg(180.0), NORD) == pytest.approx(0.0, abs=0.02)

    def test_le_vent_de_travers_est_neutre(self):
        assert tailwind_finish(leg(90.0), NORD) == pytest.approx(0.5, abs=0.02)
        assert tailwind_finish(leg(270.0), NORD) == pytest.approx(0.5, abs=0.02)

    def test_seule_la_fin_compte(self):
        """Deux boucles identiques sauf leur dernier tiers doivent se séparer."""
        debut = leg(180.0, points=60)
        vers_le_nord = debut + leg(0.0, points=30)
        vers_le_sud = debut + leg(180.0, points=30)
        assert tailwind_finish(vers_le_nord, NORD) > tailwind_finish(vers_le_sud, NORD)

    def test_la_longitude_est_corrigee(self):
        """Sans correction de latitude, un cap est-ouest serait faussé.

        À 48,85° un degré de longitude fait 0,66 fois un degré de latitude :
        ignorer ce facteur ferait passer un plein est pour un cap à 56°.
        """
        est = Wind(bearing=90.0, speed_kmh=30.0)
        assert tailwind_finish(leg(90.0), est) == pytest.approx(1.0, abs=0.02)


class TestPrudence:
    def test_pas_de_vent_pas_d_effet(self):
        assert tailwind_finish(leg(180.0), None) == 0.5

    def test_vent_faible_pas_d_effet(self):
        """En dessous du seuil, le vent ne se sent pas en courant."""
        assert not CALME.matters
        assert tailwind_finish(leg(180.0), CALME) == 0.5

    def test_trace_trop_court_pas_d_effet(self):
        assert tailwind_finish([(2.35, LAT), (2.36, LAT)], NORD) == 0.5

    def test_la_force_est_graduee(self):
        faible = Wind(bearing=0.0, speed_kmh=MIN_SPEED_KMH + 0.1)
        fort = Wind(bearing=0.0, speed_kmh=60.0)
        assert 0.0 <= faible.strength < 0.1
        assert fort.strength == 1.0

    def test_points_confondus_ne_cassent_rien(self):
        """Une géométrie dégénérée ne doit pas provoquer de division par zéro."""
        assert tailwind_finish([(2.35, LAT)] * 12, NORD) == 0.5


class TestPoidsDansLaNotation:
    @staticmethod
    def req(**over) -> LoopRequest:
        return LoopRequest(lat=LAT, lon=2.35, distance_km=TARGET / 1000, **over)

    def test_a_qualite_egale_le_vent_departage(self):
        req = self.req()
        dos = candidate(leg(0.0))
        face = candidate(leg(180.0))
        assert final_score(dos, TARGET, req, None, NORD) > final_score(
            face, TARGET, req, None, NORD
        )

    def test_le_vent_ne_prime_jamais_sur_la_securite(self):
        """Le point le plus important : c'est un départage, pas un critère."""
        req = self.req()
        # Vent de dos, mais une traversée non protégée — donc notée B.
        confortable = candidate(leg(0.0), unprotected_crossings=2)
        # Vent de face, mais rien à lui reprocher — notée A.
        sur = candidate(leg(180.0))
        assert final_score(sur, TARGET, req, None, NORD) > final_score(
            confortable, TARGET, req, None, NORD
        )

    def test_le_vent_ne_prime_pas_sur_le_denivele_demande(self):
        req = self.req(elevation=ElevationPref.flat)
        plat_face = candidate(leg(180.0))
        raide_dos = candidate(leg(0.0))
        assert final_score(plat_face, TARGET, req, 20.0, NORD) > final_score(
            raide_dos, TARGET, req, 400.0, NORD
        )

    def test_sans_vent_la_note_est_inchangee(self):
        req = self.req()
        cand = candidate(leg(0.0))
        assert final_score(cand, TARGET, req, None, None) == final_score(
            cand, TARGET, req, None
        )

    def test_l_ecart_reste_borne(self):
        """L'effet total ne peut pas dépasser le poids annoncé."""
        req = self.req()
        dos = candidate(leg(0.0))
        face = candidate(leg(180.0))
        ecart = final_score(dos, TARGET, req, None, NORD) - final_score(
            face, TARGET, req, None, NORD
        )
        assert ecart <= 2 * WIND_WEIGHT + 1e-9
