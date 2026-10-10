"""Génération de boucles.

Le principe tient en une idée : **une boucle est un polygone dont le départ est
un sommet.** Le décrire demande trois nombres — une forme (le nombre de côtés),
une taille et une orientation — et la géométrie fait le reste.

1. **Un seul** Dijkstra depuis le départ donne d'un coup, pour tous les nœuds
   atteignables, leur distance réseau réelle et leur coût pondéré — donc leur
   sûreté au mètre.
2. On en tire un index : pour chaque direction (par tranche de 5°) et chaque
   bande de distance, le nœud le moins cher au mètre. C'est le vivier de sommets.
3. On demande alors des polygones : *un triangle orienté à 40°*, *un carré
   orienté à 15°*, *un hexagone orienté à 0°*… Pour chacun, on prend dans
   l'index le nœud le plus proche de chaque position idéale, et on relie ces
   points par A*.
4. On mesure, on passe le portail L3, on dédoublonne.

**Où sont les points de passage.** C'est le point qu'il ne faut pas se tromper :
le départ étant un sommet du polygone, les autres ne l'entourent pas — ils sont
tous du même côté. Dans un polygone régulier à *m* côtés vu depuis l'un de ses
sommets, les *m−1* autres se répartissent sur (m−2)·180/m degrés seulement, par
pas réguliers de 180/m, à des distances **inégales** :

    m=3 : 2 points à 60° d'écart,  à L/3 et L/3
    m=4 : 3 points à 45° d'écart,  à L/4, 0,354 L, L/4
    m=6 : 5 points à 30° d'écart,  à L/6 … 0,333 L … L/6

La formule générale, démontrée par le théorème de l'angle inscrit : le k-ième
point est à `L·sin(kπ/m) / (m·sin(π/m))` et à `(k−1)·180/m` degrés du premier.

Répartir au contraire les points sur 360° place le départ **au centre** de la
figure au lieu d'être dessus. La boucle doit alors retraverser le milieu à
chaque côté, les aires s'annulent, et la rondeur s'effondre à 0,03 — c'est
exactement ce que faisait la version précédente, sans que le symptôme désigne
la cause.

**Pourquoi la distance visée se mesure sur le réseau.** Le réseau impose des
détours : la distance réseau vaut environ 1,3 fois la distance à vol d'oiseau.
Mais ce facteur joue autant sur les distances aux points de passage que sur le
périmètre, et les deux se compensent — viser les distances théoriques en
distance **réseau** donne directement le bon périmètre, sans avoir à estimer le
détour. La boucle d'ajustement ne corrige plus qu'un résidu.

**Pourquoi plusieurs formes.** Un triangle est ce qui se referme le plus
facilement sur un réseau pauvre ; un hexagone est bien plus rond mais exige un
maillage. Les proposer toutes, c'est laisser le terrain trancher — et c'est
aussi ce qui donne à l'utilisateur des tracés visiblement différents plutôt que
plusieurs variantes du même.
"""

from __future__ import annotations

import logging
import math
from collections import Counter
from collections.abc import Callable
from dataclasses import dataclass, field

from ..elevation import Terrain
from ..geo import Coord, backtrack_share, bearing_deg, haversine_m, roundness
from ..osm.graph import Graph
from ..safety.gate import RouteStats
from ..safety.night import unlit_length
from ..safety.risk import EXPOSED_RISK
from .dijkstra import INF, SearchResult, astar, dijkstra, node_sequence, reconstruct
from .weights import Profile

log = logging.getLogger(__name__)

# Multiplicateur appliqué aux arêtes déjà parcourues, sur les tronçons suivants.
RETURN_PENALTY = 6.0

# Formes proposées : nombre de côtés du polygone visé. Un triangle se referme
# partout, un hexagone est bien plus rond mais demande du maillage. Leur rondeur
# théorique va de 0,605 (triangle) à 0,907 (hexagone).
SHAPES = (3, 4, 5, 6)

# Orientations essayées par forme. Le départ étant un sommet, faire tourner le
# polygone autour de lui donne à chaque fois une boucle réellement différente :
# l'intervalle à balayer est le tour complet, pas une fraction.
ORIENTATIONS = 8

# Quand le relief est connu, on essaie trois fois plus d'orientations, et l'on
# trace d'abord celles dont les points de passage vont au terrain demandé. Le
# nombre de boucles tracées, lui, ne change pas : c'est le choix qui s'affine.
# Mesuré à Guebwiller, en plat : 7 boucles plates sur 60 sans relief, 22 ainsi
# (30 avec la pénalité de pente, voir `weights.CLIMB_WEIGHT`).
TERRAIN_DENSITY = 3

# Passes d'ajustement du rayon — voir `generate_loops`.
MAX_ATTEMPTS = 3

# Nombre de candidats dans la fourchette à partir duquel on cesse d'ajuster.
ENOUGH_IN_RANGE = 8

# Sans contrainte, dès que la liaison directe entre deux sommets est mauvaise —
# un fleuve, une voie ferrée, un relief — le routeur repasse par le milieu. Le
# tracé devient un huit dont l'aire s'annule : ce n'est plus une boucle, et la
# rondeur s'effondre. Les tronçons entre sommets se voient donc **interdire**
# une zone centrale autour du départ.
#
# Elle n'est interdite qu'aux tronçons **intermédiaires** : le premier et le
# dernier côté touchent le départ par construction.
CORE_CLEARANCE = 0.75

# Gonflement de l'heuristique A* — voir `astar`. 1,25 divise le temps de calcul
# par deux à trois en ville dense, pour des tronçons marginalement moins directs.
# La sécurité, elle, reste garantie par le portail L3.
RETURN_EPSILON = 1.25

# Longueur maximale d'un tronçon, en fraction de la distance visée. Un côté de
# polygone vaut au plus L/3 (triangle) ; on laisse le double pour absorber les
# détours du réseau et le contournement de la zone centrale.
LEG_MAX_SHARE = 0.70

# --- index des sommets ----------------------------------------------------

# Finesse angulaire de l'index : 72 tranches, soit 5°.
FINE_SECTORS = 72
_FINE_WIDTH = 360.0 / FINE_SECTORS

# Largeur des bandes de distance, en fraction du rayon visé. Deux nœuds de la
# même direction et de la même bande sont interchangeables pour la géométrie :
# on ne garde que le plus sûr des deux.
BAND_RATIO = 0.06

# Poids de la sélection d'un sommet. L'erreur de rayon pèse le plus — c'est
# elle qui décide si la boucle tombera dans la fourchette de distance ; l'erreur
# d'angle décide de la forme ; la qualité, de la sûreté du chemin qui y mène.
W_RADIUS = 3.0
W_ANGLE = 1.4
W_QUALITY = 1.2

# Écart angulaire maximal toléré pour un sommet, en fraction du pas entre deux
# sommets. Au-delà, le polygone est trop déformé pour rester une boucle ronde —
# et surtout, le couloir de progression (voir `SWEEP_MARGIN_DEG`) devrait être
# ouvert si large qu'il ne contraindrait plus rien.
ANGLE_TOLERANCE = 0.25

# Écart maximal, en fraction du pas idéal, entre deux sommets consécutifs.
# Un polygone dont un côté couvre 1,4 fois sa part d'angle et le suivant 0,6
# n'est plus une boucle régulière : c'est une goutte. On préfère renoncer à
# cette orientation — il en reste cinq autres, et deux autres formes.
SPAN_MIN = 0.55
SPAN_MAX = 1.30

# Marge angulaire ouverte de part et d'autre du couloir de progression, en
# degrés. Assez large pour laisser le réseau contourner un obstacle, assez
# étroite pour que le tour à l'envers — toujours plus long d'au moins deux fois
# — reste hors du couloir.
SWEEP_MARGIN_DEG = 30.0

# Écart maximal toléré entre la distance réelle d'un point de passage et sa
# distance théorique, en fraction de celle-ci. C'est le réglage qui décide de la
# précision de la longueur obtenue : trop serré, aucun nœud ne convient sur un
# réseau lâche ; trop lâche, la boucle sort de la fourchette demandée.
RADIUS_TOLERANCE = 0.35


def node_sectors(graph: Graph, start: int) -> list[int]:
    """Tranche de direction de chaque nœud, vue depuis le départ.

    Calculé une fois par requête, puis lu des millions de fois par le garde-fou
    angulaire d'A*. On projette en équirectangulaire local plutôt que d'appeler
    `bearing_deg` : à cette échelle les deux donnent la même tranche de 5°, et
    l'un coûte un `atan2` là où l'autre en coûte une demi-douzaine.
    """
    slon, slat = graph.nodes[start]
    kx = math.cos(math.radians(slat))
    inv = FINE_SECTORS / 360.0
    out = [0] * len(graph.nodes)
    for i, (lon, lat) in enumerate(graph.nodes):
        angle = math.degrees(math.atan2((lon - slon) * kx, lat - slat))
        out[i] = int((angle % 360.0) * inv) % FINE_SECTORS
    return out


def sweep_gate(from_deg: float, to_deg: float, margin: float = SWEEP_MARGIN_DEG) -> bytearray:
    """Tranches ouvertes pour progresser de `from_deg` à `to_deg`, sens horaire.

    C'est ce qui interdit à un tronçon de faire le tour dans l'autre sens. Sans
    lui, contourner la zone centrale « par derrière » est régulièrement moins
    cher que la corde directe : le tracé repasse alors dans un quartier déjà
    parcouru, en sens inverse, et son aire s'annule.
    """
    span = (to_deg - from_deg) % 360.0
    lo = from_deg - margin
    total = span + 2 * margin
    allowed = bytearray(FINE_SECTORS)
    steps = int(total / _FINE_WIDTH) + 2
    base = int(lo // _FINE_WIDTH)
    for k in range(steps):
        allowed[(base + k) % FINE_SECTORS] = 1
    return allowed


def waypoint_plan(m: int, perimeter_m: float) -> list[tuple[float, float]]:
    """Positions idéales des points de passage d'un m-gone dont le départ est un sommet.

    Rend une liste de (écart angulaire par rapport au premier point, distance).
    Démonstration en trois lignes : les m sommets sont sur un cercle de rayon
    R = L / (2m·sin(π/m)) ; la corde entre le sommet 0 et le sommet k vaut
    2R·sin(kπ/m) ; et par le théorème de l'angle inscrit, les directions vers
    les sommets successifs, vues du sommet 0, sont espacées de 180/m degrés.
    """
    step = 180.0 / m
    scale = perimeter_m / (m * math.sin(math.pi / m))
    return [
        ((k - 1) * step, scale * math.sin(k * math.pi / m)) for k in range(1, m)
    ]


@dataclass
class SegmentRun:
    coords: list[Coord]
    length_m: float
    risk: float
    level: str
    separation: float
    speed_kmh: float
    surface: str
    lit: bool | None
    road: str | None
    inferred: bool


@dataclass
class CrossingHit:
    lon: float
    lat: float
    protected: bool
    speed_kmh: float
    kind: str


@dataclass
class Candidate:
    edges: list[int]
    nodes: list[int]
    geometry: list[Coord] = field(default_factory=list)
    segments: list[SegmentRun] = field(default_factory=list)
    crossings: list[CrossingHit] = field(default_factory=list)
    stats: RouteStats | None = None
    bearing: float = 0.0
    roundness: float = 0.0  # 1 = cercle, 0 = aller-retour — voir `geo.roundness`
    backtrack: float = 0.0  # part en crochet en U — voir `geo.backtrack_share`
    shape: int = 0  # nombre de sommets visés — 0 pour un repli aller-retour
    laps: int = 1  # nombre de tours à parcourir — voir `repeat_loop`

    @property
    def distance_m(self) -> float:
        return self.stats.distance_m if self.stats else 0.0

    @property
    def edge_set(self) -> set[int]:
        return set(self.edges)


class VertexIndex:
    """Vivier de sommets, rangé par direction et par distance.

    Le balayage brut du résultat de Dijkstra — deux cent mille nœuds sur un
    centre-ville — serait à refaire pour chacun des sommets de chacune des
    formes de chacune des orientations, soit une centaine de fois. On le fait
    donc une fois, en réduisant chaque case (direction × bande de distance) à
    son meilleur nœud : le moins cher au mètre, donc celui vers lequel le
    chemin est le plus sûr.
    """

    __slots__ = ("cells", "band_m", "best_quality")

    def __init__(
        self,
        graph: Graph,
        start: int,
        outbound: SearchResult,
        band_m: float,
        min_dist_m: float,
        max_dist_m: float,
    ) -> None:
        self.band_m = band_m
        start_coord = graph.nodes[start]
        cells: dict[tuple[int, int], tuple[int, float, float, float]] = {}
        nodes = graph.nodes
        dist = outbound.dist
        cost = outbound.cost
        best_quality = INF

        for node in outbound.reached:
            d = dist[node]
            if d < min_dist_m or d > max_dist_m:
                continue
            quality = cost[node] / d
            if quality < best_quality:
                best_quality = quality
            b = bearing_deg(start_coord, nodes[node])
            key = (int(b // _FINE_WIDTH) % FINE_SECTORS, int(d // band_m))
            current = cells.get(key)
            if current is None or quality < current[3]:
                cells[key] = (node, d, b, quality)

        self.cells = cells
        self.best_quality = best_quality if best_quality < INF else 1.0

    def __bool__(self) -> bool:
        return bool(self.cells)

    def pick(
        self,
        angle: float,
        radius_m: float,
        max_angle_dev: float,
        taken: set[int],
    ) -> tuple[int, float, float] | None:
        """Meilleur nœud pour la position idéale (direction, distance).

        Rend (nœud, distance réseau, cap réel), ou None si rien d'acceptable.
        """
        lo = radius_m * (1.0 - RADIUS_TOLERANCE)
        hi = radius_m * (1.0 + RADIUS_TOLERANCE)
        band_lo = int(lo // self.band_m)
        band_hi = int(hi // self.band_m)
        fine_span = int(max_angle_dev // _FINE_WIDTH) + 1
        centre = int(angle // _FINE_WIDTH) % FINE_SECTORS

        best: tuple[int, float, float] | None = None
        best_penalty = INF

        for df in range(-fine_span, fine_span + 1):
            fine = (centre + df) % FINE_SECTORS
            for band in range(band_lo, band_hi + 1):
                entry = self.cells.get((fine, band))
                if entry is None:
                    continue
                node, d, bearing, quality = entry
                if node in taken:
                    continue

                ang_err = abs((bearing - angle + 180.0) % 360.0 - 180.0)
                if ang_err > max_angle_dev:
                    continue
                rad_err = (d - radius_m) / radius_m

                penalty = (
                    W_RADIUS * rad_err * rad_err
                    + W_ANGLE * (ang_err / max_angle_dev) ** 2
                    + W_QUALITY * max(0.0, quality / self.best_quality - 1.0)
                )
                if penalty < best_penalty:
                    best_penalty = penalty
                    best = (node, d, bearing)

        return best


def generate_loops(
    graph: Graph,
    start: int,
    target_m: float,
    profile: Profile,
    *,
    sectors: int = 12,
    max_candidates: int = 24,
    tolerance: float = 0.10,
    terrain: Terrain | None = None,
    climb_fit: Callable[[float], float] | None = None,
) -> list[Candidate]:
    """Rend des boucles brutes, non filtrées. Le tri se fait ailleurs.

    Viser le rayon en distance réseau suffit à tomber près de la bonne longueur
    (voir l'en-tête du module), mais pas à tomber dedans : un réseau très
    contraint — presqu'île, vallée, lotissement en raquettes — allonge les
    liaisons entre sommets plus que le rayon. D'où la boucle d'ajustement : on
    génère, on mesure l'écart médian, on corrige le rayon, on recommence.

    `terrain` et `climb_fit` : le relief de la zone, et ce que vaut un polygone
    selon ce qu'il monte au moins, en m/km — plus bas, mieux c'est. Sans eux, la
    génération est celle d'avant, à l'identique.
    """
    collected: list[Candidate] = []
    scale = 1.0
    lo, hi = target_m * (1 - tolerance), target_m * (1 + tolerance)

    # Le profil ne change pas d'une passe à l'autre : ses poids non plus. Les
    # recalculer à chaque passe, sur des centaines de milliers d'arêtes, était
    # du travail pur perdu.
    weights = profile.precompute(graph)

    orientations = max(3, min(ORIENTATIONS, sectors // 2))
    tree = _OutboundTree(graph, start, weights, target_m)

    for attempt in range(MAX_ATTEMPTS):
        batch = _generate_once(
            graph, start, target_m, profile, weights, tree, scale,
            orientations, max_candidates, terrain, climb_fit,
        )
        collected.extend(batch)

        # Le critère d'arrêt porte sur le nombre de candidats **réellement
        # utilisables**, pas sur la médiane : une médiane dans la cible avec des
        # candidats étalés de 5 à 7 km ne donne rien à proposer.
        usable = sum(1 for c in collected if c.stats and lo <= c.stats.distance_m <= hi)
        if usable >= ENOUGH_IN_RANGE:
            break

        if not batch:
            scale *= 1.3  # réseau trop pauvre à ce rayon : on élargit
            continue

        distances = sorted(c.stats.distance_m for c in batch if c.stats)
        median = distances[len(distances) // 2]
        if median <= 0:
            break

        # Correction bornée : au-delà, on oscille d'une passe à l'autre au lieu
        # de converger.
        scale *= max(0.6, min(1.7, target_m / median))
        log.info(
            "passe %d : %d candidats dans la cible, médiane %.0f m pour %.0f m "
            "visés — rayon × %.2f",
            attempt + 1, usable, median, target_m, scale,
        )

    return collected


class _OutboundTree:
    """L'arbre des plus courts chemins depuis le départ, calculé au plus juste.

    Les passes d'ajustement changent le rayon visé, donc la portée utile. Mais
    une passe qui rétrécit le rayon n'a besoin de rien de nouveau : l'arbre déjà
    calculé la contient. On ne recalcule que si une passe demande plus loin, ce
    qui n'arrive que sur les réseaux pauvres.
    """

    def __init__(self, graph: Graph, start: int, weights: list[float], target_m: float) -> None:
        self._graph = graph
        self._start = start
        self._weights = weights
        self._target = target_m
        self._reach = 0.0
        self._sectors: list[int] | None = None
        self.result: SearchResult | None = None

    def sectors(self) -> list[int]:
        """Table des directions par nœud, calculée à la première demande.

        Elle ne dépend que du départ, donc pas des passes d'ajustement : la
        recalculer à chaque passe serait un balayage complet du graphe pour rien.
        """
        if self._sectors is None:
            self._sectors = node_sectors(self._graph, self._start)
        return self._sectors

    def for_radius(self, radius_m: float) -> SearchResult:
        needed = radius_m * (1.0 + RADIUS_TOLERANCE) + 50.0
        if self.result is None or needed > self._reach:
            # Marge de 15 % : la prochaine passe demandera souvent un peu plus,
            # et une deuxième exploration coûte bien plus cher que la marge.
            self._reach = needed * 1.15
            self.result = dijkstra(
                self._graph, self._start, self._weights, max_dist=self._reach, slack=1.0
            )
            log.info("aller : %d nœuds atteints (portée %.0f m)", len(self.result.reached), self._reach)
        return self.result


def _generate_once(
    graph: Graph,
    start: int,
    target_m: float,
    profile: Profile,
    weights: list[float],
    tree: _OutboundTree,
    scale: float,
    orientations: int,
    max_candidates: int,
    terrain: Terrain | None = None,
    climb_fit: Callable[[float], float] | None = None,
) -> list[Candidate]:
    plans = {m: waypoint_plan(m, target_m * scale) for m in SHAPES}

    # La portée du parcours aller est dictée par le point de passage le plus
    # éloigné, toutes formes confondues — soit le sommet opposé au départ.
    farthest = max(d for plan in plans.values() for _a, d in plan)
    outbound = tree.for_radius(farthest)

    # Un index unique couvre toutes les formes : ses bornes englobent la plus
    # petite et la plus grande distance visée. Le construire par forme, sur des
    # centaines de milliers de nœuds, était trois balayages pour un.
    closest = min(d for plan in plans.values() for _a, d in plan)
    index = VertexIndex(
        graph, start, outbound,
        band_m=max(25.0, closest * BAND_RATIO),
        min_dist_m=closest * (1.0 - RADIUS_TOLERANCE),
        max_dist_m=farthest * (1.0 + RADIUS_TOLERANCE),
    )
    if not index:
        log.warning("aucun point de passage dans la fenêtre visée")
        return _fallback_out_and_back(
            graph, start, outbound, weights, profile, target_m, scale, max_candidates
        )

    candidates: list[Candidate] = []
    core_memo: dict[int, set[int]] = {}
    signatures: set[tuple[int, ...]] = set()
    node_sector = tree.sectors()

    # Tous les polygones d'abord, rangés ; on ne trace qu'ensuite. Sans relief,
    # l'ordre est celui des formes puis des orientations — celui d'avant. Avec,
    # les orientations intermédiaires s'ajoutent, et chaque polygone passe selon
    # ce que ses points de passage imposent de monter.
    density = TERRAIN_DENSITY if terrain is not None and climb_fit is not None else 1
    z_start = terrain.at(*graph.nodes[start]) if density > 1 else 0.0
    polygons: list[tuple[float, bool, int, int, list[tuple[int, float, float]]]] = []
    for shape_rank, m in enumerate(SHAPES):
        plan = plans[m]
        max_dev = (180.0 / m) * ANGLE_TOLERANCE
        for k in range(orientations * density):
            theta = (k / density) * 360.0 / orientations
            vertices = _pick_vertices(index, plan, theta, max_dev)
            if vertices is None:
                continue
            fit = 0.0
            if density > 1:
                fit = climb_fit(_least_climb(graph, terrain, z_start, vertices) / (target_m / 1000.0))
            polygons.append((fit, k % density != 0, shape_rank, k, vertices))
    polygons.sort(key=lambda p: p[:4])

    for _fit, _extra, shape_rank, _k, vertices in polygons:
        if len(candidates) >= max_candidates:
            break

        # Deux orientations voisines retombent parfois sur les mêmes points :
        # inutile de router deux fois la même boucle.
        signature = tuple(v[0] for v in vertices)
        if signature in signatures:
            continue
        signatures.add(signature)

        cand = _build_polygon(
            graph, start, vertices, outbound, weights, profile,
            target_m, node_sector, core_memo,
        )
        if cand is not None:
            cand.shape = SHAPES[shape_rank]
            candidates.append(cand)

    # Repli : sur un réseau pauvre (village, littoral, impasse), aucun polygone
    # ne se referme. Un aller-retour reste préférable à ne rien proposer — le
    # score de rondeur le placera de toute façon derrière une vraie boucle.
    if not candidates:
        log.info("aucun polygone possible, repli sur l'aller-retour")
        candidates = _fallback_out_and_back(
            graph, start, outbound, weights, profile, target_m, scale, max_candidates
        )

    return candidates


def _least_climb(
    graph: Graph,
    terrain: Terrain,
    z_start: float,
    vertices: list[tuple[int, float, float]],
) -> float:
    """Ce qu'un polygone fera monter au moins : du départ à chaque point de
    passage, et retour. Le chemin réel montera davantage — mais un polygone
    dont les sommets sont dans les vignes ne fera jamais une boucle plate."""
    total = 0.0
    prev = z_start
    for node, _d, _b in vertices:
        z = terrain.at(*graph.nodes[node])
        total += max(0.0, z - prev)
        prev = z
    return total + max(0.0, z_start - prev)


def _pick_vertices(
    index: VertexIndex,
    plan: list[tuple[float, float]],
    theta: float,
    max_dev: float,
) -> list[tuple[int, float, float]] | None:
    """Les points de passage d'un polygone orienté à `theta`, ou None.

    Le plan donne les positions idéales ; l'index rend le nœud réel le plus
    proche de chacune. Un point manquant fait échouer toute la forme : sauter
    un sommet d'un polygone régulier ne donne pas un polygone plus simple, il
    donne une figure dont un côté fait le double des autres — précisément le
    genre de boucle déséquilibrée qu'on cherche à ne pas proposer. Il reste
    sept autres orientations et trois autres formes.
    """
    vertices: list[tuple[int, float, float]] = []
    taken: set[int] = set()

    for offset, distance in plan:
        angle = (theta + offset) % 360.0
        found = index.pick(angle, distance, max_dev, taken)
        if found is None:
            return None
        taken.add(found[0])
        vertices.append(found)

    # Les caps réels doivent rester ordonnés et régulièrement espacés : c'est
    # ce qui rend le couloir de progression utile, et ce qui garantit que la
    # figure obtenue ressemble encore au polygone demandé.
    ideal = plan[1][0] - plan[0][0] if len(plan) > 1 else 0.0
    for i in range(len(vertices) - 1):
        span = (vertices[i + 1][2] - vertices[i][2]) % 360.0
        if not (ideal * SPAN_MIN <= span <= ideal * SPAN_MAX):
            return None

    return vertices


def _build_polygon(
    graph: Graph,
    start: int,
    vertices: list[tuple[int, float, float]],
    outbound: SearchResult,
    weights: list[float],
    profile: Profile,
    target_m: float,
    node_sector: list[int],
    core_memo: dict,
) -> Candidate | None:
    """Relie le départ et les points de passage, dans l'ordre, et referme la boucle.

    Si un tronçon ne passe pas avec la zone centrale interdite, on réessaie avec
    une zone deux fois plus petite, puis sans. C'est ce qui sauve les réseaux
    contraints — presqu'île, vallée, ville coupée par un fleuve — où le seul
    itinéraire possible frôle réellement le départ. La rondeur en pâtit, mais
    elle est mesurée ensuite : un tracé médiocre sera classé comme tel, alors
    qu'un tracé absent ne peut pas l'être.
    """
    for clearance in (CORE_CLEARANCE, CORE_CLEARANCE * 0.5, 0.0):
        edges = _chain_legs(
            graph, start, vertices, outbound, weights, profile,
            target_m, clearance, node_sector, core_memo,
        )
        if edges:
            cand = Candidate(edges=edges, nodes=node_sequence(graph, start, edges))
            measure(graph, start, cand, night=profile.night)
            return cand
    return None


def _chain_legs(
    graph: Graph,
    start: int,
    vertices: list[tuple[int, float, float]],
    outbound: SearchResult,
    weights: list[float],
    profile: Profile,
    target_m: float,
    clearance: float,
    node_sector: list[int],
    core_memo: dict,
) -> list[int] | None:
    first = vertices[0][0]
    leg = reconstruct(outbound, first)
    if not leg:
        return None

    edges = list(leg)
    used = {eidx: RETURN_PENALTY for eidx in leg}

    # Zone interdite aux tronçons intermédiaires — voir `CORE_CLEARANCE`.
    core = (
        _core_nodes(outbound, vertices[0][1] * clearance, core_memo)
        if clearance > 0
        else None
    )
    leg_limit = target_m * LEG_MAX_SHARE

    cursor, cursor_bearing = first, vertices[0][2]
    for node, _d, bearing in vertices[1:]:
        gate = sweep_gate(cursor_bearing, bearing) if clearance > 0 else None
        piece = _leg(
            graph, cursor, node, weights, profile, leg_limit, used, core,
            node_sector, gate,
        )
        if not piece:
            return None
        edges.extend(piece)
        used.update({eidx: RETURN_PENALTY for eidx in piece})
        cursor, cursor_bearing = node, bearing

    # Le dernier côté ramène au départ : ni zone interdite ni couloir, il vise
    # précisément le point où toutes les directions se rejoignent.
    closing = _leg(
        graph, cursor, start, weights, profile, leg_limit, used, None, None, None
    )
    if not closing:
        return None
    edges.extend(closing)

    return _trim_spurs(edges) or None


def _trim_spurs(edges: list[int]) -> list[int]:
    """Supprime les allers-retours immédiats : une arête prise puis reprise.

    Ils apparaissent à la jonction de deux tronçons quand le sommet visé se
    trouve au bout d'une impasse courte. Géométriquement c'est un pic sur le
    tracé, et il compte deux fois dans la distance sans rien apporter.
    """
    out: list[int] = []
    for eidx in edges:
        if out and out[-1] == eidx:
            out.pop()
        else:
            out.append(eidx)
    return out


# Les rayons de la zone centrale sont regroupés par paliers de 50 m avant d'être
# mémoïsés : les trois formes donnent des rayons voisins, et deux valeurs
# distantes de quelques mètres désignent la même zone au nœud près.
CORE_RADIUS_BUCKET_M = 50.0


def _core_nodes(outbound: SearchResult, radius_m: float, memo: dict) -> set[int]:
    """Nœuds à moins de `radius_m` du départ, en distance réseau.

    Le calcul balaie tous les nœuds atteignables : sur un centre-ville, plus de
    cent mille lectures. Le refaire pour chacune des formes de chacune des
    orientations serait du travail identique répété, d'où la mémoïsation par
    palier de rayon.
    """
    if radius_m <= 0:
        return set()

    key = round(radius_m / CORE_RADIUS_BUCKET_M)
    cached = memo.get(key)
    if cached is not None:
        return cached

    bucket = key * CORE_RADIUS_BUCKET_M
    dist = outbound.dist
    inside = {node for node in outbound.reached if dist[node] <= bucket}
    memo[key] = inside
    return inside


def _leg(
    graph: Graph,
    source: int,
    target: int,
    weights: list[float],
    profile: Profile,
    limit_m: float,
    penalties: dict[int, float],
    blocked: set[int] | None,
    node_sector: list[int] | None,
    gate: bytearray | None,
) -> list[int] | None:
    result = astar(
        graph,
        source,
        target,
        weights,
        min_factor=profile.min_factor,
        max_dist=limit_m,
        penalties=penalties,
        blocked=blocked,
        sector=node_sector,
        allowed=gate,
        epsilon=RETURN_EPSILON,
    )
    return reconstruct(result, target)


def _fallback_out_and_back(
    graph: Graph,
    start: int,
    outbound: SearchResult,
    weights: list[float],
    profile: Profile,
    target_m: float,
    scale: float,
    limit: int,
) -> list[Candidate]:
    """Dernier recours : un demi-tour, dans autant de directions que possible."""
    radius = target_m * 0.5 * scale
    index = VertexIndex(
        graph, start, outbound,
        band_m=max(25.0, radius * BAND_RATIO),
        min_dist_m=radius * 0.6,
        max_dist_m=radius * 1.4,
    )
    if not index:
        return []

    candidates: list[Candidate] = []
    taken: set[int] = set()
    for k in range(max(4, limit)):
        angle = k * 360.0 / max(4, limit)
        found = index.pick(angle, radius, 45.0, taken)
        if found is None:
            continue
        node = found[0]
        taken.add(node)

        out_edges = reconstruct(outbound, node)
        if not out_edges:
            continue
        penalties = {eidx: RETURN_PENALTY for eidx in out_edges}
        back_edges = _leg(
            graph, node, start, weights, profile, target_m * 0.8, penalties,
            None, None, None,
        )
        if not back_edges:
            continue
        edges = _trim_spurs(out_edges + back_edges)
        if not edges:
            continue
        cand = Candidate(edges=edges, nodes=node_sequence(graph, start, edges))
        measure(graph, start, cand, night=profile.night)
        candidates.append(cand)

    return candidates


def measure(graph: Graph, start: int, cand: Candidate, *, night: bool) -> None:
    """Calcule géométrie, tronçons homogènes, traversées et statistiques L3."""
    geometry: list[Coord] = []
    segments: list[SegmentRun] = []

    total = 0.0
    exposed = 0.0
    protected = 0.0
    inferred = 0.0
    unlit = 0.0
    tunnel_unlit = 0.0
    longest_exposed = 0.0
    current_exposed = 0.0

    cursor = start
    for eidx in cand.edges:
        edge = graph.edges[eidx]
        coords = edge.coords_from(cursor)
        cursor = edge.other(cursor)

        s = edge.safety
        length = edge.length_m
        total += length

        if s.risk >= EXPOSED_RISK:
            exposed += length
            current_exposed += length
            longest_exposed = max(longest_exposed, current_exposed)
        else:
            current_exposed = 0.0

        if s.separation >= 2.0:
            protected += length
        if s.inferred:
            inferred += length
        unlit += unlit_length(s, length)
        if edge.tunnel:
            tunnel_unlit += length

        # géométrie continue (on ne répète pas le point de jonction)
        geometry.extend(coords if not geometry else coords[1:])

        # tronçons homogènes pour l'affichage
        level = s.level
        if (
            segments
            and segments[-1].level == level
            and segments[-1].surface == s.surface
            and segments[-1].road == edge.name
        ):
            run = segments[-1]
            run.coords.extend(coords[1:])
            run.length_m += length
        else:
            segments.append(
                SegmentRun(
                    coords=list(coords),
                    length_m=length,
                    risk=s.risk,
                    level=level,
                    separation=s.separation,
                    speed_kmh=s.speed_kmh,
                    surface=s.surface,
                    lit=s.lit,
                    road=edge.name,
                    inferred=s.inferred,
                )
            )

    crossings = detect_crossings(graph, cand)
    unprotected = sum(1 for c in crossings if not c.protected)

    # Recouvrement : longueur des passages en double, rapportée au total.
    counts = Counter(cand.edges)
    repeated = sum(
        graph.edges[eidx].length_m * (n - 1) for eidx, n in counts.items() if n > 1
    )

    closure = haversine_m(geometry[0], geometry[-1]) if geometry else 0.0

    cand.geometry = geometry
    cand.segments = segments
    cand.crossings = crossings
    cand.roundness = roundness(geometry)
    cand.backtrack = backtrack_share(geometry)
    cand.bearing = _loop_bearing(graph.nodes[start], geometry)
    cand.stats = RouteStats(
        distance_m=total,
        exposed_m=exposed,
        longest_exposed_m=longest_exposed,
        unprotected_crossings=unprotected,
        protected_crossings=len(crossings) - unprotected,
        tunnel_unlit_m=tunnel_unlit,
        closure_m=closure,
        overlap_share=repeated / total if total else 0.0,
        protected_m=protected,
        inferred_m=inferred,
        unlit_m=unlit if night else None,
    )


def _loop_bearing(start: Coord, geometry: list[Coord]) -> float:
    """Direction générale de la boucle : le cap vers son centre de gravité.

    On prenait auparavant le cap vers le premier point de passage. C'est le cap
    des cent premiers mètres, pas celui de la sortie : deux boucles qui partent
    par la même rue puis divergent complètement s'annonçaient identiquement, et
    le choix diversifié les traitait comme des jumelles. Le centre de gravité,
    lui, dit vraiment de quel côté on va courir.
    """
    if not geometry:
        return 0.0
    n = len(geometry)
    centroid = (sum(c[0] for c in geometry) / n, sum(c[1] for c in geometry) / n)
    return bearing_deg(start, centroid)


def detect_crossings(graph: Graph, cand: Candidate) -> list[CrossingHit]:
    """Repère les nœuds où le parcours coupe une voie rapide.

    Un nœud compte comme traversée si une voie **non empruntée** par l'itinéraire
    y débouche avec une vitesse de référence >= 70 km/h. Longer une telle voie
    n'est pas une traversée : c'est de l'exposition, mesurée séparément.
    """
    used = set(cand.edges)
    hits: list[CrossingHit] = []

    for node in cand.nodes[1:-1]:
        fastest = 0.0
        for eidx in graph.adj[node]:
            if eidx in used:
                continue
            speed = graph.edges[eidx].safety.speed_kmh
            fastest = max(fastest, speed)

        if fastest < 70.0:
            continue

        crossing = graph.crossings.get(node)
        lon, lat = graph.nodes[node]
        hits.append(
            CrossingHit(
                lon=lon,
                lat=lat,
                protected=crossing.protected if crossing else False,
                speed_kmh=fastest,
                kind=crossing.kind if crossing else "untagged",
            )
        )

    return hits


def repeat_loop(graph: Graph, start: int, cand: Candidate, laps: int) -> Candidate:
    """Matérialise une boucle parcourue plusieurs fois.

    Quand aucune boucle de la longueur demandée ne tient — un village dont
    toutes les sorties sont des départementales, une presqu'île, un réseau trop
    pauvre — il reste une réponse évidente que l'app ne donnait pas : *une
    boucle deux fois plus courte, parcourue deux fois*. C'est ce que fait tout
    coureur qui connaît son quartier, et ça ne demande aucune concession sur la
    sécurité : le tour est validé comme n'importe quelle boucle, il est
    simplement répété.

    On construit le parcours réel plutôt que de laisser l'interface additionner
    des chiffres : le suivi GPS, le profil, les consignes et le fichier GPX
    décrivent alors la sortie telle qu'elle sera courue, sans cas particulier
    nulle part.

    Deux mesures ne se répètent pas et sont reprises du tour unique :

    * la **rondeur**, parce que l'aire d'un tracé parcouru deux fois double
      quand son périmètre double aussi — la formule isopérimétrique la ferait
      donc chuter de moitié alors que la forme est rigoureusement la même ;
    * le **recouvrement**, qui vaudrait mécaniquement (n−1)/n et ne dirait plus
      rien de la qualité du tour.

    Le reste, en revanche, se répète pour de bon : les traversées sont franchies
    à chaque tour, le dénivelé est encaissé à chaque tour, et si le départ tombe
    au milieu d'une portion exposée, les deux tours la mettent bout à bout — ce
    que la mesure doit voir, et voit.
    """
    repeated = Candidate(edges=cand.edges * laps, nodes=[])
    repeated.nodes = node_sequence(graph, start, repeated.edges)
    measure(graph, start, repeated, night=cand.stats.unlit_m is not None)

    repeated.roundness = cand.roundness
    repeated.backtrack = cand.backtrack
    repeated.stats.overlap_share = cand.stats.overlap_share
    repeated.bearing = cand.bearing
    repeated.shape = cand.shape
    repeated.laps = laps
    return repeated


def similarity(a: Candidate, b: Candidate) -> float:
    """Part d'arêtes communes, rapportée au plus petit des deux tracés."""
    sa, sb = a.edge_set, b.edge_set
    if not sa or not sb:
        return 0.0
    return len(sa & sb) / min(len(sa), len(sb))
