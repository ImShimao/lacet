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
# **Sur quelle longueur on lit la direction d'une voie.**
#
# Vingt mètres, c'était la longueur du carrefour lui-même : le rayon d'un
# trottoir, le décalage d'un îlot, les deux points de forme que le cadastre a
# posés en biais. On mesurait donc la géométrie de l'intersection au lieu de la
# direction de la rue, et une rue qui continue tout droit sortait à trente-cinq
# degrés — assez pour qu'une consigne s'invente, puis une autre en sens inverse
# vingt mètres plus loin : « serre à gauche puis tout de suite à droite », là où
# il n'y a qu'à continuer.
#
# Trente-cinq mètres portent au-delà du carrefour, sur la rue elle-même. Mesuré
# sur cinq boucles de Lyon : cent quatre-vingt-dix-huit consignes avant,
# beaucoup moins après, sans qu'aucun vrai virage disparaisse.
BEARING_SPAN_M = 35.0

# Seuils de classement d'un changement de direction, en degrés.
SLIGHT_DEG = 30.0
TURN_DEG = 55.0
SHARP_DEG = 115.0
UTURN_DEG = 155.0

# **Une fourche se dit, même douce.** Sous le seuil d'un virage, rien n'était
# dit — y compris quand une autre voie partait tout droit à côté : la rue
# s'infléchissait de trente-cinq degrés, la ruelle d'en face continuait, et
# l'on prenait la ruelle. Une autre voie qui part vers l'avant (à moins de
# `FORK_DEG`) et se distingue de la nôtre (d'au moins `DISTINCT_DEG`) demande
# qu'on dise laquelle prendre — sauf quand on reste sur la même voie et qu'elle
# est la plus droite : là, on continue sans y penser.
FORK_DEG = 45.0
DISTINCT_DEG = 20.0
# En deçà, la voie prise à une fourche se dit « tout droit » : l'écart ne se
# voit pas sur le terrain.
STRAIGHT_DEG = 12.0

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
    # Les caps d'arrivée et de départ : de quoi mesurer l'angle net d'une
    # fusion (voir `_merge_close`). Ils ne sortent pas du moteur.
    before: float = 0.0
    after: float = 0.0


def build_instructions(graph: Graph, start: int, cand: Candidate) -> list[Instruction]:
    """Suite de consignes pour parcourir `cand` depuis `start`."""
    if not cand.edges:
        return []

    steps = _raw_steps(graph, start, cand)
    steps = _merge_all(steps)

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
    came: int | None = None

    for eidx in cand.edges:
        edge = graph.edges[eidx]
        coords = edge.coords_from(cursor)

        if out_bearing is not None and came is not None:
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

            # **Y avait-il un choix ?**
            #
            # C'est la question qui manquait. Un nœud de degré deux n'est pas un
            # carrefour : c'est une couture entre deux tronçons de la même voie,
            # là où OpenStreetMap a coupé — un changement de revêtement, une
            # limite de commune, le début d'un pont. On ne peut aller nulle part
            # ailleurs, et pourtant l'app y annonçait des virages, parfois deux
            # de suite en sens contraire.
            #
            # Une consigne ne sert qu'à choisir. Là où il n'y a rien à choisir,
            # il n'y a rien à dire : la rue emmène.
            choix = len(graph.adj[cursor]) > 2
            fork = (
                _fork_turn(graph, cursor, eidx, came, out_bearing, angle, edge.name == graph.edges[came].name)
                if choix and magnitude < TURN_DEG
                else None
            )
            if fork:
                turn = fork

            if (
                choix
                and (magnitude >= TURN_DEG or (magnitude >= SLIGHT_DEG and road_changed))
            ) or named_change or fork:
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
                        before=out_bearing,
                        after=in_bearing,
                    )
                )

        travelled += edge.length_m
        out_bearing = _bearing_to_end(coords)
        if edge.name:
            last_named = edge.name
        came = eidx
        cursor = edge.other(cursor)

    return steps


def _fork_turn(
    graph: Graph,
    node: int,
    chosen: int,
    came: int,
    out_bearing: float,
    angle: float,
    same_road: bool,
) -> str | None:
    """La manœuvre à dire à une fourche, ou None quand le chemin va de soi.

    Voir `FORK_DEG`. Sous le seuil d'une inflexion, la voie prise se situe par
    rapport aux autres : la plus à gauche d'une fourche « serre à gauche », celle
    du milieu continue « tout droit ».
    """
    forward: list[float] = []
    for alt in graph.adj[node]:
        if alt == chosen or alt == came:
            continue
        bearing = _bearing_from_start(graph.edges[alt].coords_from(node))
        a = (bearing - out_bearing + 180.0) % 360.0 - 180.0
        if abs(a) < FORK_DEG and abs(a - angle) >= DISTINCT_DEG:
            forward.append(a)
    if not forward:
        return None
    if same_road and all(abs(angle) <= abs(a) for a in forward):
        return None
    if abs(angle) >= SLIGHT_DEG:
        return _classify(angle)
    if abs(angle) < STRAIGHT_DEG:
        return "straight"
    if angle < 0 and all(a > angle for a in forward):
        return "slight_left"
    if angle > 0 and all(a < angle for a in forward):
        return "slight_right"
    return "straight"


def _merge_all(steps: list[Instruction]) -> list[Instruction]:
    """Répète le rassemblement jusqu'à ce que plus rien ne bouge.

    Une passe ne suffit pas : trois manœuvres rapprochées se traitent deux par
    deux, et la troisième restait seule ; un virage recollé pouvait ensuite se
    compenser avec le suivant. Chaque passe qui change quelque chose raccourcit
    la liste, donc la boucle s'arrête.
    """
    out = steps
    while True:
        suivant = _merge_close(out)
        if len(suivant) == len(out):
            return suivant
        out = suivant


def _merge_close(steps: list[Instruction]) -> list[Instruction]:
    """Rassemble deux manœuvres trop rapprochées.

    Trois cas, et ils ne se disent pas de la même façon :

    **La rue ondule.** Deux écarts opposés qui se compensent — trente degrés à
    gauche, trente à droite, vingt mètres plus loin — ne sont pas deux
    manœuvres : c'est une rue qui n'est pas droite. On ne dit rien. C'est le
    défaut que l'on entendait le plus : « va à gauche puis à droite » alors
    qu'il n'y a qu'à continuer.

    **Le virage est en deux temps.** Deux écarts du même côté sont un seul
    virage, coupé en deux par un point de forme. On les additionne, et l'on
    annonce le virage entier, une fois.

    **C'est vraiment une chicane.** Deux manœuvres opposées qui ne se
    compensent pas — un décrochement, une place à traverser — gardent leurs
    deux temps : « tourne à gauche puis tout de suite à droite ».

    Un « tout droit » proche d'un virage n'est pas une seconde manœuvre : il
    nomme la voie où le virage mène. « Tourne à droite », puis vingt mètres plus
    loin « Continue tout droit sur Passerelle du Collège », se dit en une fois.
    """
    if len(steps) < 2:
        return steps

    out: list[Instruction] = []
    i = 0
    while i < len(steps):
        current = steps[i]
        following = steps[i + 1] if i + 1 < len(steps) else None
        proches = (
            following is not None
            and following.dist_m - current.dist_m <= MERGE_DISTANCE_M
        )
        if proches:
            # **L'angle net : du cap d'arrivée au premier point au cap de départ
            # du second.** La somme des deux angles annoncés oubliait les
            # inflexions tues entre les deux — les bouts de trottoir d'un mètre
            # qui encadrent une traversée — et ne repassait pas dans ±180°.
            # Montée du Lieutenant Allouche, à Lyon, un virage à gauche (−93°)
            # sortait en « fais demi-tour » (−173°) ; passage Ménestrier, trois
            # écarts du même côté faisaient −359,5° : un « demi-tour » sur une
            # ligne qui continue (−1°).
            somme = (following.after - current.before + 180.0) % 360.0 - 180.0
            tourne = current.turn != "straight" and following.turn != "straight"
            oppose = (current.angle > 0) != (following.angle > 0)
            caps = {"before": current.before, "after": following.after}
            if tourne and abs(somme) < SLIGHT_DEG:
                # La rue ondule : les deux écarts disparaissent ensemble. La
                # prudence, elle, ne disparaît pas — une traversée non protégée
                # signalée sur l'un des deux points reste dite.
                if current.caution or following.caution:
                    out.append(
                        Instruction(
                            dist_m=current.dist_m,
                            turn="straight",
                            angle=round(somme, 1),
                            road=following.road,
                            text=_phrase("straight", following.road),
                            lon=current.lon,
                            lat=current.lat,
                            caution=True,
                            **caps,
                        )
                    )
                i += 2
                continue
            if not tourne or not oppose:
                # Un seul virage, coupé en deux par un point de forme — ou nommé
                # par le « tout droit » qui le suit.
                turn = _classify(somme)
                current = Instruction(
                    dist_m=current.dist_m,
                    turn=turn,
                    angle=round(somme, 1),
                    road=following.road or current.road,
                    text=_phrase(turn, following.road or current.road),
                    lon=current.lon,
                    lat=current.lat,
                    caution=current.caution or following.caution,
                    **caps,
                )
            else:
                current = Instruction(
                    dist_m=current.dist_m,
                    turn=current.turn,
                    # L'angle net, et non celui du premier temps : la passe
                    # suivante doit pouvoir juger l'effet de l'ensemble.
                    angle=round(somme, 1),
                    road=following.road,
                    text=f"{_PHRASES.get(current.turn, 'Continue')} puis tout de suite "
                    f"{_short(following.turn)}{_on(following.road)}",
                    lon=current.lon,
                    lat=current.lat,
                    caution=current.caution or following.caution,
                    **caps,
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


# Le type de voie, en tête du nom OpenStreetMap, et ce qui se dit devant. OSM
# écrit « Rue de l'Oberharth », sans article : l'app disait « tourne à droite
# sur Rue de l'Oberharth », là où l'on dit « dans la rue de l'Oberharth ».
_VOIES = {
    "rue": "dans la rue",
    "ruelle": "dans la ruelle",
    "venelle": "dans la venelle",
    "impasse": "dans l'impasse",
    "allée": "dans l'allée",
    "avenue": "dans l'avenue",
    "passage": "dans le passage",
    "cour": "dans la cour",
    "square": "dans le square",
    "faubourg": "dans le faubourg",
    "montée": "dans la montée",
    "route": "sur la route",
    "chemin": "sur le chemin",
    "sentier": "sur le sentier",
    "boulevard": "sur le boulevard",
    "quai": "sur le quai",
    "place": "sur la place",
    "pont": "sur le pont",
    "voie": "sur la voie",
    "piste": "sur la piste",
    "promenade": "sur la promenade",
    "esplanade": "sur l'esplanade",
    "cours": "sur le cours",
    "digue": "sur la digue",
    "mail": "sur le mail",
    "parvis": "sur le parvis",
    "rond-point": "sur le rond-point",
}


def _on(road: str | None) -> str:
    if not road:
        return ""
    head, _, rest = road.partition(" ")
    voie = _VOIES.get(head.lower())
    # Un nom sans type reconnu — « Grand'Rue », « Ladhof » — garde « sur ».
    return f" {voie} {rest}" if voie and rest else f" sur {road}"


def _short(turn: str) -> str:
    return {
        "left": "à gauche",
        "right": "à droite",
        # « légèrement », comme la voix le dit déjà (`guidance.js`) : réduit à
        # « à gauche », le second temps d'une chicane passait pour un virage net.
        "slight_left": "légèrement à gauche",
        "slight_right": "légèrement à droite",
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
