"""Plus courts chemins pondérés : Dijkstra et A*.

Le graphe est non orienté, sauf les sens uniques à vélo (`Edge.oneway`, voir
`safety.exclusion.oneway_for`) : un sens unique ne s'impose pas au piéton, mais
une boucle à vélo qui remonte une rue en sens interdit n'est pas un itinéraire.
(`oneway:foot=yes` existe mais reste marginal ; il serait à ajouter là-bas.)

Deux choix structurent ce module, et ils viennent du même constat : la boucle
interne s'exécute des dizaines de millions de fois par requête sur un
centre-ville, donc tout ce qu'on peut en sortir doit en sortir.

1. **Les poids sont précalculés**, sous forme de liste indexée par numéro
   d'arête (`Profile.precompute`). Rappeler la fonction de coût à chaque visite
   — une demi-douzaine d'accès attributs et de recherches dans des
   dictionnaires — coûtait à elle seule la moitié du temps de calcul.
2. **Les états sont des tableaux, pas des dictionnaires.** Les nœuds portent des
   indices contigus (voir `osm.graph.Graph`) : `dist[v]` remplace `dist.get(v)`,
   sans hachage ni redimensionnement. Le tableau couvre tout le graphe même
   quand la recherche n'en explore qu'un dixième, mais l'allouer est une
   opération mémoire unique, sans commune mesure avec le prix des dictionnaires
   qu'il remplace.
"""

from __future__ import annotations

import heapq
from dataclasses import dataclass

from ..geo import haversine_m
from ..osm.graph import Graph

INF = float("inf")


@dataclass(slots=True)
class SearchResult:
    """État final d'une recherche, en tableaux indexés par numéro de nœud.

    `reached` liste les nœuds effectivement atteints. C'est lui qu'il faut
    parcourir pour balayer le résultat : les tableaux, eux, couvrent tout le
    graphe et sont majoritairement vides.
    """

    dist: list[float]  # distance réelle en mètres, INF si non atteint
    cost: list[float]  # coût pondéré, INF si non atteint
    prev_node: list[int]  # parent dans l'arbre des plus courts chemins, -1 sinon
    prev_edge: list[int]  # arête menant au parent, -1 sinon
    reached: list[int]


def _blank(n: int) -> tuple[list[float], list[float], list[int], list[int]]:
    return [INF] * n, [INF] * n, [-1] * n, [-1] * n


def dijkstra(
    graph: Graph,
    source: int,
    weights: list[float],
    *,
    max_dist: float | None = None,
    target: int | None = None,
    penalties: dict[int, float] | None = None,
    slack: float = 1.15,
) -> SearchResult:
    """Plus courts chemins pondérés depuis `source`.

    `max_dist` borne l'exploration en distance **réelle** (pas en coût), ce qui
    évite de balayer toute la ville pour une boucle de 5 km.

    `slack` élargit cette borne pour les arêtes franchies : un nœud légèrement
    au-delà peut être le seul passage vers une zone qui, elle, est dans la borne.
    Le mettre à 1.0 quand on ne s'intéresse qu'aux nœuds strictement sous la
    borne — l'exploration est alors nettement plus courte.
    """
    edges = graph.edges
    adj = graph.adj
    n = len(graph.nodes)

    dist, cost, prev_node, prev_edge = _blank(n)
    settled = bytearray(n)
    reached: list[int] = []

    dist[source] = 0.0
    cost[source] = 0.0
    heap: list[tuple[float, int]] = [(0.0, source)]
    limit = max_dist * slack if max_dist is not None else INF
    bound = max_dist if max_dist is not None else INF

    while heap:
        c, u = heapq.heappop(heap)
        if settled[u]:
            continue
        settled[u] = 1
        reached.append(u)

        if target is not None and u == target:
            break

        du = dist[u]
        if du > bound:
            continue

        for eidx in adj[u]:
            edge = edges[eidx]
            v = edge.b if edge.a == u else edge.a
            if settled[v]:
                continue
            if edge.oneway and (edge.a == u) != (edge.oneway > 0):
                continue

            nd = du + edge.length_m
            if nd > limit:
                continue

            w = weights[eidx]
            if penalties is not None:
                w *= penalties.get(eidx, 1.0)
            nc = c + w

            if nc < cost[v]:
                cost[v] = nc
                dist[v] = nd
                prev_node[v] = u
                prev_edge[v] = eidx
                heapq.heappush(heap, (nc, v))

    return SearchResult(dist, cost, prev_node, prev_edge, reached)


def astar(
    graph: Graph,
    source: int,
    target: int,
    weights: list[float],
    *,
    min_factor: float,
    max_dist: float | None = None,
    penalties: dict[int, float] | None = None,
    blocked: set[int] | None = None,
    sector: list[int] | None = None,
    allowed: bytearray | None = None,
    epsilon: float = 1.0,
) -> SearchResult:
    """Comme `dijkstra`, mais guidé vers une destination connue.

    Le retour au point de départ a une cible : ne pas s'en servir revient à
    explorer la ville dans toutes les directions pour retrouver un point qu'on
    sait déjà situer.

    `min_factor` est le multiplicateur de poids **minimum** que la fonction de
    coût puisse produire sur une arête. L'heuristique `distance × min_factor`
    ne peut alors jamais surestimer le coût restant : elle est admissible, et
    A* rend le même chemin optimal que Dijkstra.

    `epsilon > 1` gonfle cette heuristique. Elle cesse d'être admissible : le
    chemin trouvé peut coûter jusqu'à ε fois l'optimum, mais la recherche
    explore beaucoup moins de nœuds. C'est un compromis acceptable ici — on
    génère des *candidats*, dont la sécurité est ensuite vérifiée pour de bon
    par le portail L3. Un retour 10 % moins direct qu'il aurait pu l'être ne se
    voit pas ; un retour dangereux serait de toute façon rejeté.

    `blocked` retire des nœuds de la recherche. C'est ce qui empêche un tronçon
    entre deux sommets de repasser par le départ (voir `loops`). Une interdiction
    plutôt qu'une pénalité, parce qu'une pénalité assez forte pour être efficace
    rend la recherche exorbitante : elle continue d'explorer la zone chère au
    lieu de l'ignorer, et finit par buter sur la borne de distance. Interdire,
    au contraire, **accélère** la recherche.

    `sector` et `allowed` forment le second garde-fou, angulaire celui-là :
    `sector[v]` donne la tranche de direction du nœud v vue depuis le départ, et
    `allowed` dit quelles tranches sont ouvertes. Sans lui, rien n'oblige un
    tronçon à contourner la boucle du bon côté — et faire le tour à l'envers,
    en rasant la zone interdite, est souvent *moins cher* que la corde directe.
    Le tracé repassait alors deux fois dans le même quartier, en sens inverse,
    et son aire s'annulait. Le test coûte une lecture de tableau par arête
    relâchée, et il réduit l'espace exploré au lieu de l'agrandir.
    """
    edges = graph.edges
    adj = graph.adj
    nodes = graph.nodes
    n = len(nodes)
    goal = nodes[target]
    h_factor = min_factor * epsilon

    dist, cost, prev_node, prev_edge = _blank(n)
    settled = bytearray(n)
    reached: list[int] = []

    if blocked:
        for node in blocked:
            settled[node] = 1
    # La source et la cible priment sur toute interdiction : elles peuvent
    # tomber dans la zone interdite quand celle-ci est mal proportionnée, et il
    # vaut mieux un tronçon imparfait que pas de tronçon du tout.
    settled[source] = 0
    settled[target] = 0

    gate = None
    if allowed is not None and sector is not None:
        # Copie locale : la tranche de la cible doit rester ouverte, sinon elle
        # serait inatteignable et le tronçon échouerait toujours. Le filtrage se
        # fait ensuite arête par arête, dans la relaxation — le faire d'avance
        # sur tout le graphe coûterait un balayage complet par tronçon.
        gate = bytearray(allowed)
        gate[sector[target]] = 1
        gate[sector[source]] = 1

    dist[source] = 0.0
    cost[source] = 0.0
    heap: list[tuple[float, int]] = [(haversine_m(nodes[source], goal) * h_factor, source)]
    limit = max_dist if max_dist is not None else INF

    while heap:
        _f, u = heapq.heappop(heap)
        if settled[u]:
            continue
        settled[u] = 1
        reached.append(u)

        if u == target:
            break

        du = dist[u]
        if du > limit:
            continue
        gu = cost[u]

        for eidx in adj[u]:
            edge = edges[eidx]
            v = edge.b if edge.a == u else edge.a
            if settled[v]:
                continue
            if gate is not None and not gate[sector[v]]:
                continue
            if edge.oneway and (edge.a == u) != (edge.oneway > 0):
                continue

            nd = du + edge.length_m
            if nd > limit:
                continue

            w = weights[eidx]
            if penalties is not None:
                w *= penalties.get(eidx, 1.0)
            ng = gu + w

            if ng < cost[v]:
                cost[v] = ng
                dist[v] = nd
                prev_node[v] = u
                prev_edge[v] = eidx
                heapq.heappush(heap, (ng + haversine_m(nodes[v], goal) * h_factor, v))

    return SearchResult(dist, cost, prev_node, prev_edge, reached)


def reconstruct(result: SearchResult, target: int) -> list[int] | None:
    """Suite d'indices d'arêtes de la source jusqu'à `target`, ou None."""
    if result.dist[target] == INF:
        return None
    edges: list[int] = []
    prev_edge = result.prev_edge
    prev_node = result.prev_node
    cur = target
    guard = 0
    while prev_edge[cur] >= 0:
        edges.append(prev_edge[cur])
        cur = prev_node[cur]
        guard += 1
        if guard > 1_000_000:  # garde-fou contre un cycle de prédécesseurs
            return None
    edges.reverse()
    return edges


def node_sequence(graph: Graph, source: int, edges: list[int]) -> list[int]:
    """Suite de nœuds traversés, en partant de `source`."""
    nodes = [source]
    cur = source
    for eidx in edges:
        cur = graph.edges[eidx].other(cur)
        nodes.append(cur)
    return nodes
