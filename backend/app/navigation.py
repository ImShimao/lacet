"""Instructions de navigation : transformer un tracé en phrases à dire.

Un tracé est une suite de points ; une consigne est une décision. Tout le
travail consiste à ne garder que les endroits où il y a réellement quelque chose
à décider, et à les nommer comme un humain le ferait.

Trois précautions, toutes tirées de la nature des données OpenStreetMap :

**On ne mesure pas l'angle sur les deux points qui encadrent l'intersection.**
OSM dessine les courbes avec un point tous les quelques mètres ; deux points
consécutifs donnent une direction bruitée, et un virage à 90° peut y ressembler
à trois virages à 30°. On prend donc la direction moyenne sur une vingtaine de
mètres de part et d'autre.

**Continuer tout droit n'est pas une consigne**, sauf quand la rue change de nom
et qu'on veut confirmer. Sinon le guidage parle en permanence et on cesse de
l'écouter — c'est le défaut le plus courant des guidages piétons.

**Deux manœuvres proches se disent ensemble.** « Tourne à droite puis tout de
suite à gauche » est une phrase ; deux consignes séparées de huit mètres sont
inutilisables à pied comme à vélo.
"""

from __future__ import annotations

from dataclasses import dataclass

from .geo import Coord, bearing_deg, haversine_m
from .osm.graph import Graph
from .routing.loops import Candidate

# Longueur sur laquelle on moyenne la direction avant et après une intersection.
# Assez pour lisser le dessin des courbes, assez peu pour ne pas déborder sur la
# manœuvre suivante dans un centre-ville aux îlots courts.
BEARING_SPAN_M = 20.0

# Seuils de classement d'un changement de direction, en degrés.
SLIGHT_DEG = 30.0
TURN_DEG = 55.0
SHARP_DEG = 115.0
UTURN_DEG = 155.0

# Deux manœuvres plus proches que ça sont fusionnées en une seule phrase.
MERGE_DISTANCE_M = 25.0

# On ne signale un changement de nom de rue que si la nouvelle voie est assez
# longue pour que l'information serve.
NAME_CHANGE_MIN_M = 120.0

# Distance en deçà de laquelle on ne réannonce pas une rue déjà annoncée. Une
# rue est découpée en autant d'arêtes qu'elle a d'intersections, et certaines
# liaisons — passages, débuts de pont, ronds-points — n'ont pas de nom du tout.
# Sans cette mémoire, revenir sur une voie nommée après un tronçon anonyme
# passait pour un changement de rue, et le guidage répétait « continue tout
# droit sur la Côte Perrière » trois fois en cent mètres.
NAME_REPEAT_M = 400.0

CARDINALS = [
    "le nord", "le nord-est", "l'est", "le sud-est",
    "le sud", "le sud-ouest", "l'ouest", "le nord-ouest",
]

_PHRASES = {
    "slight_left": "Serre à gauche",
    "left": "Tourne à gauche",
    "sharp_left": "Tourne franchement à gauche",
    "slight_right": "Serre à droite",
    "right": "Tourne à droite",
    "sharp_right": "Tourne franchement à droite",
    "uturn": "Fais demi-tour",
    "straight": "Continue tout droit",
}


@dataclass
class Instruction:
    dist_m: float  # distance cumulée depuis le départ, au point de manœuvre
    turn: str  # start | left | right | slight_* | sharp_* | uturn | straight | finish
    angle: float  # positif à droite, négatif à gauche
    road: str | None  # voie que l'on emprunte après la manœuvre
    text: str  # phrase prête à être dite
    lon: float
    lat: float
    caution: bool  # traversée non protégée au même endroit


def build_instructions(graph: Graph, start: int, cand: Candidate) -> list[Instruction]:
    """Suite de consignes pour parcourir `cand` depuis `start`."""
    if not cand.edges:
        return []

    steps = _raw_steps(graph, start, cand)
    steps = _merge_close(steps)

    total = cand.stats.distance_m if cand.stats else 0.0
    lon, lat = graph.nodes[start]
    first_road = graph.edges[cand.edges[0]].name
    heading = _initial_heading(graph, start, cand)

    out = [
        Instruction(
            dist_m=0.0,
            turn="start",
            angle=0.0,
            road=first_road,
            text=_start_text(heading, first_road),
            lon=lon,
            lat=lat,
            caution=False,
        )
    ]
    markers = _lap_markers(cand, total, lon, lat, heading)
    # Une manœuvre qui tombe sur un passage au départ est absorbée par le repère
    # de tour. Sans ça, le guidage annonçait « fais demi-tour » à l'endroit même
    # où l'on repart pour un tour de plus : géométriquement l'angle est bien de
    # 180°, mais ce n'est pas un demi-tour, c'est un nouveau départ — et le dire
    # ainsi trompe précisément au moment où l'on hésite.
    if markers:
        bounds = [m.dist_m for m in markers]
        steps = [
            step
            for step in steps
            if all(abs(step.dist_m - b) > LAP_ABSORB_M for b in bounds)
        ]

    out.extend(steps)
    out.extend(markers)
    out.append(
        Instruction(
            dist_m=round(total, 1),
            turn="finish",
            angle=0.0,
            road=None,
            text=_finish_text(cand.laps),
            lon=lon,
            lat=lat,
            caution=False,
        )
    )
    # Les repères de tour s'insèrent au milieu des manœuvres : on remet tout
    # dans l'ordre des distances, sinon le guidage annoncerait la fin du
    # premier tour après les virages du deuxième.
    out.sort(key=lambda step: step.dist_m)
    return out


# Jusqu'à combien on nomme les tours en toutes lettres. Au-delà, « fin du
# 6ᵉ tour » se dit mal et ne s'entend pas mieux : on compte simplement.
ORDINALS = ("premier", "deuxième", "troisième", "quatrième", "cinquième")

# Rayon autour d'un passage au départ dans lequel une manœuvre est absorbée par
# le repère de tour.
LAP_ABSORB_M = 25.0


def _lap_markers(
    cand: Candidate, total: float, lon: float, lat: float, heading: float
) -> list[Instruction]:
    """Un repère à chaque passage au départ, sur un parcours à tours.

    Sur trois tours, la question qu'on se pose n'est pas « où tourner » mais
    « où j'en suis ». Sans ces repères, les trois tours sont indiscernables :
    on entend les mêmes consignes dans le même ordre, sans savoir si c'est la
    première ou la dernière fois.
    """
    if cand.laps < 2:
        return []

    lap = total / cand.laps
    out: list[Instruction] = []
    for k in range(1, cand.laps):
        restants = cand.laps - k
        fait = ORDINALS[k - 1] if k <= len(ORDINALS) else f"{k}ᵉ"
        reste = (
            "Dernier tour."
            if restants == 1
            else f"Encore {restants} tours."
        )
        out.append(
            Instruction(
                dist_m=round(lap * k, 1),
                turn="lap",
                angle=0.0,
                road=None,
                # La direction est reprise : on revient au point de départ, et
                # c'est le seul endroit du parcours où l'on peut repartir dans
                # le mauvais sens sans s'en apercevoir.
                text=f"Fin du {fait} tour. {reste} Repars vers {_heading_words(heading)}.",
                lon=lon,
                lat=lat,
                caution=False,
            )
        )
    return out


def _heading_words(heading: float) -> str:
    return CARDINALS[int((heading + 22.5) % 360 // 45)]


def _finish_text(laps: int) -> str:
    if laps < 2:
        return "Tu es revenu au point de départ. Boucle terminée."
    return f"Dernier tour bouclé. Les {laps} tours sont terminés."


def _raw_steps(graph: Graph, start: int, cand: Candidate) -> list[Instruction]:
    """Une consigne par intersection où il se passe quelque chose."""
    unprotected = {
        (round(c.lon, 6), round(c.lat, 6)) for c in cand.crossings if not c.protected
    }

    steps: list[Instruction] = []
    cursor = start
    travelled = 0.0
    out_bearing: float | None = None
    # Dernière voie **nommée** empruntée, et distance à laquelle on l'a annoncée.
    last_named: str | None = None
    announced: dict[str, float] = {}

    for eidx in cand.edges:
        edge = graph.edges[eidx]
        coords = edge.coords_from(cursor)

        if out_bearing is not None:
            in_bearing = _bearing_from_start(coords)
            angle = (in_bearing - out_bearing + 180.0) % 360.0 - 180.0
            turn = _classify(angle)

            # Ce qui mérite d'être dit, et rien d'autre. Un vrai virage se dit
            # toujours. Une inflexion se dit seulement si elle fait changer de
            # rue — sinon c'est le dessin de la voie, pas une décision. Et un
            # « tout droit » ne se dit que pour confirmer un changement de nom
            # sur une voie assez longue pour que l'information serve.
            road_changed = edge.name != last_named
            fresh = (
                edge.name is not None
                and travelled - announced.get(edge.name, -1e9) > NAME_REPEAT_M
            )
            named_change = fresh and road_changed and edge.length_m >= NAME_CHANGE_MIN_M
            magnitude = abs(angle)

            if magnitude >= TURN_DEG or (magnitude >= SLIGHT_DEG and road_changed) or named_change:
                if edge.name:
                    announced[edge.name] = travelled
                lon, lat = coords[0]
                steps.append(
                    Instruction(
                        dist_m=round(travelled, 1),
                        turn=turn,
                        angle=round(angle, 1),
                        road=edge.name,
                        text=_phrase(turn, edge.name),
                        lon=round(lon, 6),
                        lat=round(lat, 6),
                        caution=(round(lon, 6), round(lat, 6)) in unprotected,
                    )
                )

        travelled += edge.length_m
        out_bearing = _bearing_to_end(coords)
        if edge.name:
            last_named = edge.name
        cursor = edge.other(cursor)

    return steps


def _merge_close(steps: list[Instruction]) -> list[Instruction]:
    """Fusionne deux manœuvres trop rapprochées en une seule phrase."""
    if len(steps) < 2:
        return steps

    out: list[Instruction] = []
    i = 0
    while i < len(steps):
        current = steps[i]
        following = steps[i + 1] if i + 1 < len(steps) else None
        if (
            following is not None
            and following.dist_m - current.dist_m <= MERGE_DISTANCE_M
            and current.turn not in {"straight"}
            and following.turn not in {"straight"}
        ):
            current = Instruction(
                dist_m=current.dist_m,
                turn=current.turn,
                angle=current.angle,
                road=following.road,
                text=f"{_PHRASES.get(current.turn, 'Continue')} puis tout de suite "
                f"{_short(following.turn)}{_on(following.road)}",
                lon=current.lon,
                lat=current.lat,
                caution=current.caution or following.caution,
            )
            i += 2
        else:
            i += 1
        out.append(current)
    return out


def _classify(angle: float) -> str:
    magnitude = abs(angle)
    side = "right" if angle > 0 else "left"
    if magnitude >= UTURN_DEG:
        return "uturn"
    if magnitude >= SHARP_DEG:
        return f"sharp_{side}"
    if magnitude >= TURN_DEG:
        return side
    if magnitude >= SLIGHT_DEG:
        return f"slight_{side}"
    return "straight"


def _phrase(turn: str, road: str | None) -> str:
    return f"{_PHRASES.get(turn, 'Continue')}{_on(road)}"


def _on(road: str | None) -> str:
    if not road:
        return ""
    # « sur la rue X », « sur le boulevard X », « sur l'avenue X » : le nom OSM
    # porte déjà son article dans l'immense majorité des cas français.
    return f" sur {road}"


def _short(turn: str) -> str:
    return {
        "left": "à gauche",
        "right": "à droite",
        "slight_left": "à gauche",
        "slight_right": "à droite",
        "sharp_left": "franchement à gauche",
        "sharp_right": "franchement à droite",
        "uturn": "demi-tour",
    }.get(turn, "tout droit")


def _start_text(heading: float, road: str | None) -> str:
    return f"Départ — pars vers {_heading_words(heading)}{_on(road)}."


def _initial_heading(graph: Graph, start: int, cand: Candidate) -> float:
    coords = graph.edges[cand.edges[0]].coords_from(start)
    return _bearing_from_start(coords)


def _bearing_from_start(coords: list[Coord]) -> float:
    """Direction moyenne sur les premiers `BEARING_SPAN_M` du tronçon."""
    return bearing_deg(coords[0], _advance(coords, BEARING_SPAN_M))


def _bearing_to_end(coords: list[Coord]) -> float:
    """Direction moyenne sur les derniers `BEARING_SPAN_M` du tronçon."""
    reversed_coords = coords[::-1]
    return bearing_deg(_advance(reversed_coords, BEARING_SPAN_M), coords[-1])


def _advance(coords: list[Coord], distance_m: float) -> Coord:
    """Point situé à `distance_m` le long de `coords`, ou le dernier point."""
    travelled = 0.0
    for i in range(len(coords) - 1):
        step = haversine_m(coords[i], coords[i + 1])
        if travelled + step >= distance_m:
            if step <= 0:
                continue
            t = (distance_m - travelled) / step
            a, b = coords[i], coords[i + 1]
            return (a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t)
        travelled += step
    return coords[-1]


def summarize(instructions: list[Instruction]) -> dict[str, int]:
    """Compte les manœuvres par nature — pour l'affichage, et pour les tests."""
    counts: dict[str, int] = {}
    for step in instructions:
        counts[step.turn] = counts.get(step.turn, 0) + 1
    return counts
