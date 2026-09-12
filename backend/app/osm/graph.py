"""Construction du graphe routable à partir de la réponse Overpass.

Trois choses se passent ici :

1. **L0** — les voies exclues ne sont jamais insérées.
2. **Contraction** — les chaînes de nœuds de degré 2 à l'intérieur d'une même
   voie sont fusionnées en une seule arête. OSM place un nœud tous les quelques
   mètres pour dessiner les courbes ; sans contraction on se retrouve avec
   200 000 nœuds pour une ville moyenne et Dijkstra devient inutilisable en Python.
   Après contraction, on tombe typiquement d'un facteur 6 à 10.
3. **L1/L2** — chaque arête porte son évaluation de sécurité, calculée une fois.
"""

from __future__ import annotations

import logging
import math
from collections import Counter, defaultdict
from dataclasses import dataclass
from typing import Any

from ..geo import Coord, haversine_m, planar_distance, point_in_ring, ring_bbox
from .extract import Extract, Way, read as read_extract
from ..safety.exclusion import is_excluded, tunnel_is_unprotected
from ..safety.risk import EdgeSafety, evaluate_edge

log = logging.getLogger(__name__)

# Densité de voirie au-delà de laquelle on considère être en zone bâtie, quand
# aucun polygone `landuse` ne couvre le point. Volontairement haut : en cas de
# doute, la règle L2 doit pencher vers « pas de trottoir ».
BUILTUP_DENSITY_M = 15_000.0  # mètres de voirie dans un voisinage de ~1,44 km²
DENSITY_CELL_M = 400.0


# `slots=True` : le graphe compte des centaines de milliers d'arêtes, gardées en
# mémoire d'une requête à l'autre. Supprimer le dictionnaire d'instance de
# chacune divise leur empreinte par deux environ, et accélère l'accès aux
# attributs — ce que la boucle interne de Dijkstra fait des millions de fois.
@dataclass(slots=True)
class Edge:
    a: int
    b: int
    length_m: float
    coords: list[Coord]  # de a vers b, extrémités incluses
    safety: EdgeSafety
    way_id: int
    name: str | None
    tunnel: bool

    def other(self, node: int) -> int:
        return self.b if self.a == node else self.a

    def coords_from(self, node: int) -> list[Coord]:
        """Géométrie orientée dans le sens du parcours."""
        return self.coords if node == self.a else list(reversed(self.coords))


@dataclass(slots=True)
class Crossing:
    node: int
    lon: float
    lat: float
    kind: str  # traffic_signals | marked | unmarked | untagged
    protected: bool


class Graph:
    """Graphe routable à **indices contigus**.

    Les nœuds ne sont pas identifiés par leur numéro OpenStreetMap — un entier
    de dix chiffres, épars — mais par leur rang, de 0 à N−1. La boucle interne
    de Dijkstra peut alors lire ses tableaux par indice au lieu de hacher une
    clé : sur un centre-ville, où elle s'exécute des dizaines de millions de
    fois par requête, c'est la différence entre une seconde et cinq.

    `nodes` est donc une liste, `adj` aussi, et `crossings` est indexé par ces
    mêmes rangs. La correspondance avec les identifiants OSM ne sert qu'à la
    construction et n'est pas conservée : plus rien n'en a besoin ensuite.
    """

    __slots__ = (
        "nodes", "edges", "adj", "crossings",
        "_grid", "_origin", "_cell_m", "_kx", "_ky",
    )

    def __init__(self) -> None:
        self.nodes: list[Coord] = []
        self.edges: list[Edge] = []
        self.adj: list[list[int]] = []
        self.crossings: dict[int, Crossing] = {}
        self._grid: dict[tuple[int, int], list[int]] = defaultdict(list)
        self._origin: Coord | None = None
        self._cell_m = 200.0
        self._kx = 111_320.0
        self._ky = 110_540.0

    # --- indexation spatiale ---------------------------------------------

    def _cell(self, c: Coord) -> tuple[int, int]:
        """Projection équirectangulaire locale, suffisante à l'échelle d'une ville."""
        assert self._origin is not None
        x = (c[0] - self._origin[0]) * self._kx
        y = (c[1] - self._origin[1]) * self._ky
        return (int(x // self._cell_m), int(y // self._cell_m))

    def build_index(self) -> None:
        if not self.nodes:
            return
        lons = [c[0] for c in self.nodes]
        lats = [c[1] for c in self.nodes]
        self._origin = (sum(lons) / len(lons), sum(lats) / len(lats))
        self._kx = 111_320.0 * math.cos(math.radians(self._origin[1]))
        self._ky = 110_540.0
        self._grid.clear()
        for node, coord in enumerate(self.nodes):
            self._grid[self._cell(coord)].append(node)

    def nearest_node(
        self,
        lon: float,
        lat: float,
        max_radius_m: float = 2000.0,
        allowed: set[int] | None = None,
    ) -> int | None:
        """Nœud du graphe le plus proche d'un point, ou None si trop loin.

        `allowed` restreint la recherche à un sous-ensemble — typiquement la
        composante connexe principale, pour ne pas raccrocher un départ à un
        îlot du réseau depuis lequel aucune boucle n'existe.
        """
        if self._origin is None:
            self.build_index()
        if not self.nodes:
            return None

        target: Coord = (lon, lat)
        cx, cy = self._cell(target)
        max_rings = int(max_radius_m // self._cell_m) + 2
        best: int | None = None
        best_d = float("inf")

        for r in range(max_rings + 1):
            for dx in range(-r, r + 1):
                for dy in range(-r, r + 1):
                    # On ne balaie que la couronne, pas tout le carré.
                    if r > 0 and max(abs(dx), abs(dy)) != r:
                        continue
                    for node in self._grid.get((cx + dx, cy + dy), ()):
                        if allowed is not None and node not in allowed:
                            continue
                        d = haversine_m(target, self.nodes[node])
                        if d < best_d:
                            best_d, best = d, node

            # Tout nœud non encore examiné est à au moins r × cellule du point
            # visé : si le meilleur candidat est plus proche que ça, il est optimal.
            if best is not None and best_d <= r * self._cell_m:
                break

        return best if best_d <= max_radius_m else None

    # --- composantes connexes --------------------------------------------

    def local_component(self, node: int, limit: int) -> set[int]:
        """Parcours borné depuis `node`. S'arrête dès `limit` nœuds atteints.

        Sert à répondre à « ce départ est-il sur un îlot ? » sans payer un
        parcours complet du graphe, qui coûte plusieurs secondes sur une grande ville.
        """
        seen = {node}
        stack = [node]
        while stack and len(seen) < limit:
            u = stack.pop()
            for eidx in self.adj[u]:
                v = self.edges[eidx].other(u)
                if v not in seen:
                    seen.add(v)
                    stack.append(v)
        return seen

    def largest_component(self) -> set[int]:
        """Plus grande composante connexe — évite les îlots isolés du réseau."""
        seen: set[int] = set()
        best: set[int] = set()
        for start in range(len(self.nodes)):
            if start in seen:
                continue
            stack = [start]
            comp: set[int] = set()
            while stack:
                u = stack.pop()
                if u in comp:
                    continue
                comp.add(u)
                for eidx in self.adj[u]:
                    v = self.edges[eidx].other(u)
                    if v not in comp:
                        stack.append(v)
            seen |= comp
            if len(comp) > len(best):
                best = comp
        return best

    def freeze(self) -> None:
        """Complète l'adjacence pour qu'elle couvre exactement tous les nœuds.

        Un nœud isolé — cas rare mais réel, quand la contraction supprime la
        seule arête qui le portait — n'aurait pas d'entrée. Le graphe étant mis
        en cache et partagé entre les requêtes, une lecture hors bornes doit
        échouer franchement plutôt que de renvoyer un voisinage fantôme.
        """
        while len(self.adj) < len(self.nodes):
            self.adj.append([])

    def __repr__(self) -> str:  # pragma: no cover
        return f"<Graph {len(self.nodes)} nœuds, {len(self.edges)} arêtes>"


# --- zone bâtie -----------------------------------------------------------


class BuiltUpIndex:
    """Détermine si un point est en zone bâtie.

    Deux signaux, dans cet ordre :
      1. les polygones `landuse` de OSM (fiable, bien couvert en France) ;
      2. à défaut, la densité de voirie locale (seuil volontairement élevé).

    Les polygones sont indexés dans une grille. Les parcourir linéairement à
    chaque interrogation coûtait, sur Paris, plusieurs secondes à lui seul :
    des dizaines de milliers de voies multipliées par des milliers de polygones.
    """

    # Au-delà de ce nombre de cellules couvertes, un polygone n'est pas indexé
    # mais testé systématiquement : l'indexer coûterait plus que ça ne rapporte.
    MAX_CELLS_PER_POLYGON = 400

    # Côté de la grille sur laquelle la réponse est mémoïsée. La notion de zone
    # bâtie est déjà une approximation à l'échelle du quartier — la densité de
    # voirie se mesure sur 400 m — donc deux points distants de 80 m ne peuvent
    # pas légitimement recevoir des réponses différentes. Sans cette mémoire, la
    # question était reposée pour chacune des 350 000 voies d'un extrait
    # parisien, dont l'immense majorité tombe dans une poignée de quartiers.
    MEMO_CELL_M = 80.0

    def __init__(self, polygons: list[list[Coord]], origin: Coord) -> None:
        self._origin = origin
        self._memo: dict[tuple[int, int], bool] = {}
        # Facteurs de projection figés une fois : `_cell` est appelée des
        # centaines de milliers de fois, elle ne doit pas refaire de trigonométrie.
        self._kx = 111_320.0 * math.cos(math.radians(origin[1]))
        self._ky = 110_540.0
        self._density: dict[tuple[int, int], float] = defaultdict(float)
        self._buckets: dict[tuple[int, int], list[tuple[tuple, list[Coord]]]] = defaultdict(list)
        self._always: list[tuple[tuple, list[Coord]]] = []

        for ring in polygons:
            if len(ring) < 3:
                continue
            bbox = ring_bbox(ring)
            entry = (bbox, ring)
            min_lon, min_lat, max_lon, max_lat = bbox
            cx0, cy0 = self._cell((min_lon, min_lat))
            cx1, cy1 = self._cell((max_lon, max_lat))
            cells = (cx1 - cx0 + 1) * (cy1 - cy0 + 1)
            if cells > self.MAX_CELLS_PER_POLYGON:
                self._always.append(entry)
                continue
            for cx in range(cx0, cx1 + 1):
                for cy in range(cy0, cy1 + 1):
                    self._buckets[(cx, cy)].append(entry)

    def add_road_length(self, midpoint: Coord, length_m: float) -> None:
        self._density[self._cell(midpoint)] += length_m

    def _cell(self, c: Coord) -> tuple[int, int]:
        x = (c[0] - self._origin[0]) * self._kx
        y = (c[1] - self._origin[1]) * self._ky
        return (int(x // DENSITY_CELL_M), int(y // DENSITY_CELL_M))

    def neighbourhood_density(self, c: Coord) -> float:
        cx, cy = self._cell(c)
        return sum(
            self._density.get((cx + dx, cy + dy), 0.0)
            for dx in (-1, 0, 1)
            for dy in (-1, 0, 1)
        )

    def is_builtup(self, c: Coord) -> bool:
        key = (
            int((c[0] - self._origin[0]) * self._kx // self.MEMO_CELL_M),
            int((c[1] - self._origin[1]) * self._ky // self.MEMO_CELL_M),
        )
        cached = self._memo.get(key)
        if cached is None:
            cached = self._memo[key] = self._compute(c)
        return cached

    def _compute(self, c: Coord) -> bool:
        lon, lat = c
        for bbox, ring in self._buckets.get(self._cell(c), ()):
            min_lon, min_lat, max_lon, max_lat = bbox
            if min_lon <= lon <= max_lon and min_lat <= lat <= max_lat:
                if point_in_ring(c, ring):
                    return True
        for bbox, ring in self._always:
            min_lon, min_lat, max_lon, max_lat = bbox
            if min_lon <= lon <= max_lon and min_lat <= lat <= max_lat:
                if point_in_ring(c, ring):
                    return True
        return self.neighbourhood_density(c) >= BUILTUP_DENSITY_M


# --- construction ---------------------------------------------------------


def build_graph(
    payload: dict[str, Any] | Extract, *, allow_trail: bool = False, sport: str = "run"
) -> Graph:
    """Transforme un extrait OpenStreetMap en graphe routable.

    Accepte aussi bien un extrait déjà rangé (`osm.extract.Extract`) qu'une
    réponse Overpass brute — les tests fabriquent la seconde à la main, et il
    serait absurde de leur imposer la plomberie du cache.
    """
    extract = payload if isinstance(payload, Extract) else read_extract(payload)

    if not extract.ways:
        return Graph()

    crossing_nodes = {c.id: c.tags for c in extract.crossings}

    # Centre approximatif, pour les projections locales.
    origin: Coord = extract.ways[0].coords[0]
    builtup = BuiltUpIndex(extract.landuse, origin)
    # Des centaines de milliers de segments de quelques dizaines de mètres :
    # le haversine complet n'apporte rien ici, la projection locale suffit.
    distance = planar_distance(origin[1])

    # --- passe 1 : filtrage L0 + densité de voirie ------------------------
    # Les longueurs de segment sont mesurées ici et conservées : la contraction
    # en a besoin, et recalculer un million de haversine coûte cher pour rien.
    kept: list[tuple[Way, list[int], list[float]]] = []
    excluded_count = 0

    for way in extract.ways:
        tags = way.tags
        if is_excluded(tags, allow_trail=allow_trail, sport=sport):
            excluded_count += 1
            continue

        coords = way.coords
        if len(coords) < 2:
            continue

        node_ids: list[int] = way.nodes
        if len(node_ids) != len(coords):
            # Overpass n'a pas renvoyé les identifiants de nœuds : on fabrique
            # des clés stables à partir des coordonnées. Deux voies qui partagent
            # un nœud ont exactement les mêmes coordonnées à cet endroit, donc
            # la jonction est correctement détectée.
            node_ids = [_coord_key(c) for c in coords]

        # Longueurs **cumulées** plutôt que segment par segment : la contraction
        # a besoin de la longueur entre deux jonctions quelconques, et la lire
        # comme une différence de deux cumuls évite de redécouper la liste et de
        # la resommer pour chaque arête produite — un million et demi de
        # tranches de liste sur un extrait de grande ville.
        cumulative = [0.0]
        total = 0.0
        for i in range(len(coords) - 1):
            total += distance(coords[i], coords[i + 1])
            cumulative.append(total)

        # La densité de voirie est mesurée sur une grille de 400 m : l'attribuer
        # segment par segment ferait des centaines de milliers d'appels pour une
        # précision que la grille ne restitue pas. Une fois par voie suffit.
        builtup.add_road_length(coords[len(coords) // 2], total)

        kept.append((way, node_ids, cumulative))

    log.info("voies retenues : %d — exclues en L0 : %d", len(kept), excluded_count)

    # --- passe 2 : repérage des jonctions ---------------------------------
    occurrences: Counter[int] = Counter()
    for _way, node_ids, _cumulative in kept:
        occurrences.update(node_ids)

    # Un nœud est une jonction s'il est partagé par deux voies, s'il termine une
    # voie, ou s'il porte une traversée. Tout le reste est un point de dessin,
    # que la contraction absorbe.
    #
    # L'ensemble remplace un dictionnaire qui portait une réponse pour **chaque**
    # nœud vu — un million deux cent mille sur un extrait parisien, dont
    # seulement deux cent quatre-vingt-dix mille étaient des jonctions. Le
    # construire demandait de surcroît une boucle Python sur les deux millions
    # de nœuds de toutes les voies ; ici, le décompte est fait en C par le
    # `Counter` et il ne reste qu'à balayer ses clés distinctes.
    junctions = {nid for nid, count in occurrences.items() if count >= 2}
    junctions |= crossing_nodes.keys() & occurrences.keys()
    for _way, node_ids, _cumulative in kept:
        junctions.add(node_ids[0])
        junctions.add(node_ids[-1])

    # --- passe 3 : contraction + évaluation de sécurité --------------------
    graph = Graph()
    # Correspondance identifiant OSM -> rang dans le graphe. Elle ne sert qu'ici :
    # une fois la construction finie, plus rien ne raisonne en identifiants OSM.
    rank: dict[int, int] = {}

    def node_rank(osm_id: int, coord: Coord) -> int:
        idx = rank.get(osm_id)
        if idx is None:
            idx = len(graph.nodes)
            rank[osm_id] = idx
            graph.nodes.append(coord)
            graph.adj.append([])
        return idx

    for way, node_ids, cumulative in kept:
        tags = way.tags
        coords = way.coords
        mid_idx = len(coords) // 2
        in_builtup = builtup.is_builtup(coords[mid_idx])
        safety = evaluate_edge(tags, in_builtup=in_builtup, sport=sport)
        # Même définition que L0 : un souterrain piéton n'est pas un « tunnel
        # sans trottoir ». Sinon le portail rejette des itinéraires que
        # l'exclusion avait justement jugés acceptables.
        tunnel = tunnel_is_unprotected(tags)
        name = tags.get("name") or tags.get("ref")
        way_id = way.id

        splits = [0]
        splits += [i for i in range(1, len(node_ids) - 1) if node_ids[i] in junctions]
        splits.append(len(node_ids) - 1)

        for k in range(len(splits) - 1):
            i, j = splits[k], splits[k + 1]
            a, b = node_ids[i], node_ids[j]
            if a == b:
                continue  # boucle sur elle-même : inutile pour le routage
            sub = coords[i : j + 1]
            length = cumulative[j] - cumulative[i]
            if length <= 0:
                continue

            ra = node_rank(a, sub[0])
            rb = node_rank(b, sub[-1])
            idx = len(graph.edges)
            graph.edges.append(
                Edge(
                    a=ra,
                    b=rb,
                    length_m=length,
                    coords=sub,
                    safety=safety,
                    way_id=way_id,
                    name=name,
                    tunnel=tunnel,
                )
            )
            graph.adj[ra].append(idx)
            graph.adj[rb].append(idx)

    # --- traversées --------------------------------------------------------
    for node in extract.crossings:
        idx = rank.get(node.id)
        if idx is None:
            continue
        kind, protected = _classify_crossing(node.tags)
        graph.crossings[idx] = Crossing(
            node=idx, lon=node.lon, lat=node.lat, kind=kind, protected=protected
        )

    graph.build_index()
    graph.freeze()
    log.info("graphe construit : %s", graph)
    return graph


def _classify_crossing(tags: dict[str, str]) -> tuple[str, bool]:
    crossing = tags.get("crossing", "")
    if crossing == "traffic_signals" or tags.get("crossing:signals") == "yes":
        return "traffic_signals", True
    if (
        crossing in {"marked", "zebra", "uncontrolled"}
        or tags.get("crossing:markings") not in {None, "no"}
    ):
        return "marked", True
    if crossing == "unmarked":
        return "unmarked", False
    return "untagged", False


def _coord_key(c: Coord) -> int:
    """Identifiant stable dérivé des coordonnées, au centimètre près."""
    return hash((round(c[0], 7), round(c[1], 7)))
