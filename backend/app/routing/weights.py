"""Fonction de poids du routage.

    poids = longueur × (1 + λ · risque) × facteur_surface × facteur_nuit

λ est le curseur de sécurité. À 4 (mode Sûr), un tronçon à risque 2,56 — une
départementale nue — coûte 11,2 fois sa longueur réelle : le routeur fera un
détour de 11 km plutôt que d'y passer 1 km. À 1,5 (mode Standard), le même
tronçon coûte 4,8 fois sa longueur.

Quand on demande du plat et que le relief de la zone est connu (voir
`elevation.Terrain`), chaque arête coûte en plus ce qu'elle monte et descend :

    poids × (1 + CLIMB_WEIGHT · dénivelé de l'arête / longueur)
"""

from __future__ import annotations

from dataclasses import dataclass

from ..elevation import Terrain
from ..models import SafetyMode, Side, Sport, SurfacePref
from ..osm.graph import Edge, Graph
from ..safety.night import night_factor
from ..safety.risk import CYCLE_FACILITY, EXPOSED_RISK

LAMBDA = {
    SafetyMode.safe: 4.0,
    SafetyMode.standard: 1.5,
}

# facteur[préférence][surface constatée]
SURFACE_FACTOR: dict[str, dict[str, float]] = {
    "road": {"paved": 1.0, "gravel": 1.55, "trail": 2.30, "unknown": 1.20},
    "mixed": {"paved": 1.0, "gravel": 0.95, "trail": 1.15, "unknown": 1.00},
    "trail": {"paved": 1.60, "gravel": 0.85, "trail": 0.70, "unknown": 1.10},
}

# À vélo les mêmes libellés ne recouvrent pas les mêmes réalités : « trail »
# devient du VTT, et un sentier étroit reste pénible même quand on le cherche.
SURFACE_FACTOR_BIKE: dict[str, dict[str, float]] = {
    "road": {"paved": 1.0, "gravel": 2.20, "trail": 3.50, "unknown": 1.30},
    "mixed": {"paved": 1.0, "gravel": 1.00, "trail": 1.60, "unknown": 1.05},
    "trail": {"paved": 1.50, "gravel": 0.80, "trail": 0.85, "unknown": 1.10},
}

# Voies piétonnes à vélo : praticables en descendant de selle, donc autorisées
# mais lourdement pénalisées. Les exclure couperait des passages parfois
# incontournables (ponts, traversées de places).
#
# Seules celles ouvertes aux vélos y échappent. Le test portait sur la
# séparation, qui vaut 2 aussi pour toute zone piétonne — sans voitures, elle
# est sûre — : la pénalité ne touchait donc jamais `pedestrian`, et les boucles
# à vélo traversaient les rues piétonnes du centre comme des pistes.
FOOT_ONLY_FACTOR = 4.0
FOOT_ONLY_HIGHWAY = {"footway", "pedestrian"}

# Les escaliers cassent une foulée : pénalité fixe, sans les interdire.
STEPS_FACTOR = 3.0

# Plancher du facteur de nuit — voir `safety.night.night_factor` :
# 0,70 (éclairé) × 0,90 (rue résidentielle bâtie). À maintenir en accord avec lui,
# sinon l'heuristique d'A* cesse d'être admissible.
NIGHT_MIN_FACTOR = 0.70 * 0.90

# En plat, une pente de 4 % coûte deux fois sa longueur. Orienter les polygones
# vers la plaine ne suffit pas : entre deux points de passage au même niveau,
# le chemin le moins cher coupait encore par le coteau. Mesuré à Guebwiller
# sur quatre départs et trois recherches chacun : 22 boucles plates sur 60 sans
# ce terme, 30 avec 25. À 50, à peine plus (34) pour un calcul deux fois plus
# lent. Le facteur ne descend jamais sous 1 : l'heuristique d'A* reste admissible.
CLIMB_WEIGHT = 25.0

# La préférence « nature » : une arête qui longe un parc, un bois ou l'eau
# (`Edge.green`, de 0 à 1) coûte jusqu'à `GREEN_BONUS` de moins, et une voie de
# sentier balisé `MARKED_BONUS` de moins encore. Un bonus, jamais une
# obligation : il ne descend pas sous `1 − GREEN_BONUS − MARKED_BONUS`, bien
# moins que ce que coûte le risque d'une route (×11 pour une départementale en
# mode Sûr), et il ne va jamais à une voie exposée — longer la rivière sur la
# nationale n'est pas « nature ». Valeurs mesurées : voir `docs/generation.md`.
GREEN_BONUS = 0.25
MARKED_BONUS = 0.15


@dataclass
class Profile:
    lam: float
    surface: str
    night: bool
    sport: str = "run"
    # Le relief de la zone, seulement quand on demande du plat.
    terrain: Terrain | None = None
    nature: bool = True
    # Le côté où l'on court — voir `loops.keep_side`. Il ne pèse pas sur les
    # poids : il ne retouche qu'après coup le tour des ronds-points.
    side: str = "left"

    @property
    def _factors(self) -> dict[str, float]:
        table = SURFACE_FACTOR_BIKE if self.sport == "bike" else SURFACE_FACTOR
        return table[self.surface]

    def weight(self, edge: Edge) -> float:
        s = edge.safety
        w = edge.length_m * (1.0 + self.lam * s.risk)
        w *= self._factors.get(s.surface, 1.0)
        if self.sport == "bike":
            if s.highway in FOOT_ONLY_HIGHWAY and s.reason != CYCLE_FACILITY:
                w *= FOOT_ONLY_FACTOR
        elif s.highway == "steps":
            w *= STEPS_FACTOR
        if self.night:
            w *= night_factor(s)
        if self.terrain is not None:
            w *= 1.0 + CLIMB_WEIGHT * self.terrain.climb(edge.coords) / max(edge.length_m, 1.0)
        if self.nature and s.risk < EXPOSED_RISK:
            w *= 1.0 - GREEN_BONUS * edge.green - (MARKED_BONUS if edge.marked else 0.0)
        return w

    def precompute(self, graph: Graph) -> list[float]:
        """Poids de toutes les arêtes, une bonne fois pour toutes.

        Le graphe ne change pas pendant une génération et le profil non plus :
        recalculer ces valeurs à chaque visite d'arête, dans une douzaine de
        parcours successifs, est du travail pur perdu.
        """
        return [self.weight(edge) for edge in graph.edges]

    @property
    def min_factor(self) -> float:
        """Poids minimal par mètre que cette fonction de coût puisse produire.

        Sert d'heuristique admissible à A*. Le terme de risque vaut au minimum 1
        (risque nul) et la pénalité d'escalier au minimum 1 : seuls la surface,
        le facteur de nuit et la préférence « nature » peuvent descendre sous 1.
        """
        factor = min(self._factors.values())
        if self.night:
            factor *= NIGHT_MIN_FACTOR
        if self.nature:
            factor *= 1.0 - GREEN_BONUS - MARKED_BONUS
        return factor


def build_profile(
    surface: SurfacePref,
    safety: SafetyMode,
    night: bool,
    sport: Sport = Sport.run,
    terrain: Terrain | None = None,
    nature: bool = True,
    side: Side = Side.left,
) -> Profile:
    return Profile(
        lam=LAMBDA[safety],
        surface=surface.value,
        night=night,
        sport=sport.value,
        terrain=terrain,
        nature=nature,
        side=side.value,
    )
