"""Schémas d'entrée/sortie de l'API."""

from __future__ import annotations

from enum import Enum
from typing import Literal

from pydantic import BaseModel, Field, model_validator


class Sport(str, Enum):
    run = "run"
    bike = "bike"


# Plafond de distance par sport. Au-delà, l'extrait OpenStreetMap à télécharger
# devient énorme : une boucle de 250 km demande un rayon de 80 km, soit une
# emprise de 25 000 km². C'est la limite pratique d'un serveur qui interroge
# Overpass à la volée, pas une limite de l'algorithme.
MAX_DISTANCE_KM = {Sport.run: 60.0, Sport.bike: 250.0}

# Allure par défaut : 6:30/km à pied, 20 km/h à vélo.
DEFAULT_PACE_S = 390
DEFAULT_SPEED_KMH = 20.0


class SurfacePref(str, Enum):
    road = "road"
    mixed = "mixed"
    trail = "trail"


class ElevationPref(str, Enum):
    flat = "flat"
    rolling = "rolling"
    hilly = "hilly"


class SafetyMode(str, Enum):
    safe = "safe"
    standard = "standard"


class TimeOfDay(str, Enum):
    day = "day"
    night = "night"
    auto = "auto"


class LoopRequest(BaseModel):
    lat: float = Field(ge=-90, le=90)
    lon: float = Field(ge=-180, le=180)
    sport: Sport = Sport.run

    # On vise soit une distance, soit une durée — jamais les deux. La durée est
    # convertie en distance via l'allure : c'est le tracé qui est calculé, pas
    # le temps.
    distance_km: float | None = Field(default=None, gt=0.3, le=250.0)
    duration_min: int | None = Field(default=None, ge=5, le=900)

    tolerance: float = Field(default=0.10, ge=0.02, le=0.35)
    surface: SurfacePref = SurfacePref.mixed
    elevation: ElevationPref = ElevationPref.rolling
    safety: SafetyMode = SafetyMode.safe
    time_of_day: TimeOfDay = TimeOfDay.auto

    pace_sec_per_km: int = Field(default=DEFAULT_PACE_S, ge=150, le=1200)
    speed_kmh: float = Field(default=DEFAULT_SPEED_KMH, ge=5.0, le=60.0)

    # Jusqu'à douze propositions : c'est le nombre au-delà duquel la liste
    # cesse d'être un choix pour devenir un catalogue, et le coût du calcul
    # d'altitude — un appel réseau par itinéraire — commence à se voir.
    limit: int = Field(default=5, ge=1, le=12)
    with_elevation: bool = True

    @property
    def seconds_per_km(self) -> float:
        if self.sport is Sport.bike:
            return 3600.0 / self.speed_kmh
        return float(self.pace_sec_per_km)

    @model_validator(mode="after")
    def _resolve_target(self) -> "LoopRequest":
        if self.distance_km is None and self.duration_min is None:
            raise ValueError("Indique une distance ou une durée.")
        if self.distance_km is not None and self.duration_min is not None:
            raise ValueError("Choisis une distance ou une durée, pas les deux.")

        if self.distance_km is None:
            self.distance_km = self.duration_min * 60.0 / self.seconds_per_km

        ceiling = MAX_DISTANCE_KM[self.sport]
        if self.distance_km > ceiling:
            label = "à pied" if self.sport is Sport.run else "à vélo"
            raise ValueError(
                f"{self.distance_km:.0f} km, c'est au-delà de ce que l'app sait "
                f"calculer {label} (maximum {ceiling:.0f} km)."
            )
        if self.distance_km < 0.5:
            raise ValueError("Vise au moins 500 m.")
        return self


# --- sortie ---------------------------------------------------------------

RiskLevel = Literal["safe", "caution", "risk"]


class Segment(BaseModel):
    """Tronçon homogène du tracé, prêt à être colorié sur la carte."""

    coords: list[list[float]]  # [[lon, lat], ...]
    length_m: float
    risk: float
    level: RiskLevel
    separation: float
    speed_kmh: float
    surface: str  # paved | gravel | trail | unknown
    lit: bool | None
    road: str | None
    inferred: bool  # True si la séparation vient de la règle du doute (L2)


class Crossing(BaseModel):
    lon: float
    lat: float
    protected: bool
    speed_kmh: float
    kind: str  # traffic_signals | marked | unmarked | untagged


class Instruction(BaseModel):
    """Une consigne de navigation, prête à être affichée et dite."""

    dist_m: float  # distance cumulée depuis le départ, au point de manœuvre
    turn: str  # start | left | right | slight_* | sharp_* | uturn | straight | finish
    angle: float  # positif à droite, négatif à gauche
    road: str | None
    text: str
    lon: float
    lat: float
    caution: bool  # traversée non protégée au même endroit


class ElevationPoint(BaseModel):
    dist_m: float
    ele_m: float
    surface: str


class SafetyReport(BaseModel):
    grade: Literal["A", "B", "C"]
    protected_share: float  # part du tracé sur voie propre ou trottoir
    exposed_m: float  # mètres à risque >= 1.5
    exposed_share: float
    longest_exposed_m: float
    unprotected_crossings: int
    protected_crossings: int
    unlit_m: float | None
    inferred_share: float  # part du tracé dont la séparation est estimée, pas taguée
    notes: list[str]


class SurfaceReport(BaseModel):
    paved_m: float = 0.0
    gravel_m: float = 0.0
    trail_m: float = 0.0
    unknown_m: float = 0.0


class RouteCandidate(BaseModel):
    id: str
    name: str
    distance_m: float
    duration_s: int
    ascent_m: float | None
    descent_m: float | None
    geometry: list[list[float]]
    segments: list[Segment]
    crossings: list[Crossing]
    elevation_profile: list[ElevationPoint] | None
    instructions: list[Instruction]
    safety: SafetyReport
    surfaces: SurfaceReport
    roundness: float  # 1 = cercle parfait, 0 = aller-retour
    bearing: float  # cap de départ, en degrés depuis le nord
    direction: str  # le même cap, en toutes lettres — « nord-est »
    shape: int  # nombre de côtés du polygone visé, 0 pour un aller-retour
    # Nombre de tours à parcourir. 1 pour une boucle ordinaire ; au-delà, le
    # tracé est une boucle plus courte répétée, et `lap_distance_m` en donne la
    # longueur — c'est elle qu'on lit sur la carte, pas la distance totale.
    laps: int
    lap_distance_m: float
    score: float


class Rejected(BaseModel):
    reason: str  # code machine
    label: str  # phrase affichable
    distance_m: float


class LoopResponse(BaseModel):
    routes: list[RouteCandidate]
    rejected: list[Rejected]
    meta: dict
