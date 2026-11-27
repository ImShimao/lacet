"""L3 — le portail de validation.

Une bonne pondération ne suffit pas : le routeur empruntera quand même 800 m de
départementale s'il n'a aucune autre option, parce qu'un poids élevé reste pour
lui un chemin valide. Il faut donc un contrôle **après** génération, avec des
règles binaires — un candidat qui échoue est jeté, pas déclassé.

Le seuil le plus important est `longest_exposed_m`. Traverser une départementale
sur 20 m est acceptable ; la longer sur 900 m ne l'est pas. Un critère purement
exprimé en pourcentage du parcours laisse passer le second.
"""

from __future__ import annotations

from dataclasses import dataclass, field


@dataclass
class RouteStats:
    """Mesures brutes d'un candidat, telles que le portail les consomme."""

    distance_m: float
    exposed_m: float  # cumul des tronçons à risque >= EXPOSED_RISK
    longest_exposed_m: float  # plus longue portion exposée *continue*
    unprotected_crossings: int
    protected_crossings: int
    tunnel_unlit_m: float
    closure_m: float  # écart entre le point d'arrivée et le départ
    overlap_share: float  # part du tracé parcourue deux fois
    protected_m: float  # cumul sur voie propre ou trottoir (sep >= 2)
    inferred_m: float  # cumul dont la séparation est estimée (L2)
    unlit_m: float | None = None

    @property
    def exposed_share(self) -> float:
        return self.exposed_m / self.distance_m if self.distance_m else 0.0

    @property
    def protected_share(self) -> float:
        return self.protected_m / self.distance_m if self.distance_m else 0.0

    @property
    def inferred_share(self) -> float:
        return self.inferred_m / self.distance_m if self.distance_m else 0.0


@dataclass
class Threshold:
    exposed_share: float
    longest_exposed_m: float
    unprotected_crossings: int  # budget de base, pour une sortie de 10 km ou moins
    # Traversées supplémentaires accordées par tranche de 10 km au-delà de 10.
    #
    # Un budget fixe ne peut pas couvrir une plage de 0,8 à 250 km. La mesure
    # est sans appel : en ville, les boucles générées comptent **zéro**
    # traversée non protégée, quelle que soit la distance — le seuil ne sert
    # jamais. En rase campagne, elles en comptent 4 à 12 par 10 km, parce qu'il
    # n'existe pas d'autre façon d'aller quelque part : le seuil rejetait alors
    # absolument tout, y compris les meilleurs candidats.
    #
    # Le supplément ne démarre qu'au-delà de 10 km : une sortie urbaine ordinaire
    # garde exactement les seuils d'avant. Et l'écart entre candidats reste
    # discriminant — sur 80 km à vélo, ils s'étalent de 35 à 98 traversées, donc
    # le portail continue d'écarter la moitié la moins bonne.
    crossings_per_10km: float = 0.0
    closure_m: float = 50.0
    overlap_share: float = 0.25
    tunnel_unlit_m: float = 0.0

    def crossings_budget(self, distance_m: float) -> int:
        extra = max(0.0, distance_m / 1000.0 - 10.0) / 10.0
        return self.unprotected_crossings + round(self.crossings_per_10km * extra)


# Les seuils dépendent du **sport**, et pas d'un coefficient près : ce qui
# constitue une exposition acceptable n'est pas la même chose à pied et à vélo.
#
# Un coureur peut presque toujours éviter une départementale — il y a un
# trottoir, un chemin, une rue parallèle — et s'il n'y en a pas, 900 m à longer
# une voie à 80 km/h est un mauvais itinéraire, quelle que soit la longueur
# totale. Les seuils de la course sont donc absolus, et ils ne bougent pas.
#
# Un cycliste, lui, roule sur la chaussée par définition. Sur une boucle de
# 80 km au départ de Lyon, il n'existe aucun itinéraire qui ne comporte pas
# plusieurs kilomètres de départementale : avec les seuils de la course, le
# mode Sûr rejetait **tout** — onze candidats sur quinze pour ce seul motif —
# et l'app ne proposait rien du tout. Un mode qui ne rend jamais de résultat ne
# protège personne ; il pousse simplement à partir sans rien préparer.
#
# Les seuils vélo restent nettement plus stricts que « n'importe quel
# itinéraire » : ils écartent toujours les longs tronçons de voie rapide nue et
# les traversées en série. Ce qui change, c'est qu'ils admettent ce que la
# pratique du vélo de route implique réellement.
THRESHOLDS: dict[str, dict[str, Threshold]] = {
    "run": {
        "safe": Threshold(
            exposed_share=0.03,
            longest_exposed_m=150.0,
            unprotected_crossings=2,
            crossings_per_10km=4.0,
        ),
        "standard": Threshold(
            exposed_share=0.08,
            longest_exposed_m=400.0,
            unprotected_crossings=5,
            crossings_per_10km=10.0,
        ),
    },
    "bike": {
        "safe": Threshold(
            exposed_share=0.08,
            longest_exposed_m=1000.0,
            unprotected_crossings=3,
            crossings_per_10km=5.0,
        ),
        "standard": Threshold(
            exposed_share=0.20,
            longest_exposed_m=2500.0,
            unprotected_crossings=6,
            crossings_per_10km=10.0,
        ),
    },
}


def thresholds_for(mode: str, sport: str = "run") -> Threshold:
    by_sport = THRESHOLDS.get(sport, THRESHOLDS["run"])
    return by_sport.get(mode, by_sport["safe"])


@dataclass
class Failure:
    code: str
    label: str


@dataclass
class GateResult:
    passed: bool
    failures: list[Failure] = field(default_factory=list)

    @property
    def first_label(self) -> str:
        return self.failures[0].label if self.failures else ""


def run_gate(stats: RouteStats, mode: str, sport: str = "run") -> GateResult:
    """Applique les seuils. Chaque règle est binaire : ça passe ou ça saute."""
    th = thresholds_for(mode, sport)
    failures: list[Failure] = []

    if stats.exposed_share > th.exposed_share:
        failures.append(
            Failure(
                "exposed_share",
                f"{stats.exposed_share * 100:.0f} % du parcours exposé au trafic "
                f"(maximum {th.exposed_share * 100:.0f} %)",
            )
        )

    if stats.longest_exposed_m > th.longest_exposed_m:
        failures.append(
            Failure(
                "longest_exposed",
                f"{stats.longest_exposed_m:.0f} m d'affilée sans trottoir "
                f"(maximum {th.longest_exposed_m:.0f} m)",
            )
        )

    budget = th.crossings_budget(stats.distance_m)
    if stats.unprotected_crossings > budget:
        failures.append(
            Failure(
                "crossings",
                f"{stats.unprotected_crossings} traversées non protégées "
                f"(maximum {budget})",
            )
        )

    if stats.tunnel_unlit_m > th.tunnel_unlit_m:
        failures.append(
            Failure("tunnel", f"{stats.tunnel_unlit_m:.0f} m de tunnel sans trottoir")
        )

    if stats.closure_m > th.closure_m:
        failures.append(
            Failure(
                "closure",
                f"la boucle ne se referme pas ({stats.closure_m:.0f} m d'écart)",
            )
        )

    if stats.overlap_share > th.overlap_share:
        failures.append(
            Failure(
                "overlap",
                f"{stats.overlap_share * 100:.0f} % du tracé parcouru deux fois",
            )
        )

    return GateResult(passed=not failures, failures=failures)


# Traversées non protégées que la note A tolère encore — voir `grade_route`.
MAX_CROSSINGS_FOR_A = 1


def grade_route(stats: RouteStats) -> tuple[str, list[str]]:
    """Note affichée. Découle des mêmes mesures que le portail.

    A : exposition <= 1 % et au plus une traversée non protégée
    B : exposition <= 3 %, ou plusieurs traversées non protégées
    C : au-delà — n'apparaît qu'en mode Standard
    """
    notes: list[str] = []

    if stats.protected_share >= 0.95:
        notes.append("Presque intégralement sur trottoir ou voie propre.")
    elif stats.protected_share >= 0.80:
        notes.append(f"{stats.protected_share * 100:.0f} % sur trottoir ou voie propre.")

    if stats.exposed_m > 0:
        notes.append(
            f"{stats.exposed_m:.0f} m au contact du trafic, "
            f"dont {stats.longest_exposed_m:.0f} m d'un seul tenant."
        )
    else:
        notes.append("Aucune portion au contact direct du trafic.")

    if stats.unprotected_crossings:
        notes.append(
            f"{stats.unprotected_crossings} traversée(s) sans passage protégé — "
            "l'app te préviendra 120 m avant."
        )
    if stats.protected_crossings:
        notes.append(f"{stats.protected_crossings} traversée(s) protégée(s).")

    if stats.inferred_share > 0.35:
        notes.append(
            f"Attention : sur {stats.inferred_share * 100:.0f} % du tracé, la présence "
            "d'un trottoir est estimée et non confirmée par OpenStreetMap."
        )

    # Une traversée isolée ne fait plus tomber la note. Mesuré en mode Sûr à pied
    # autour de Guebwiller (8 départs, 5 à 21 km, 159 boucles) : 54 des 58 B ne
    # l'étaient que pour leurs traversées, dont 36 pour une seule. Le B ne
    # distinguait plus une départementale coupée une fois d'une boucle qui en
    # enchaîne plusieurs. Le score compte toujours chaque traversée : à note
    # égale, la boucle qui n'en a aucune passe devant.
    if stats.exposed_share <= 0.01 and stats.unprotected_crossings <= MAX_CROSSINGS_FOR_A:
        return "A", notes
    if stats.exposed_share <= 0.03:
        return "B", notes
    return "C", notes
