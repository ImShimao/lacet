"""Construction du graphe : exclusion, contraction, indexation."""

from __future__ import annotations

from app.osm.graph import build_graph
from tests.conftest import grid_payload


class TestConstruction:
    def test_damier_produit_un_graphe_connexe(self, grid, grid_center):
        graph = build_graph(grid)
        assert graph.edges
        assert len(graph.largest_component()) == len(graph.nodes)

    def test_contraction_ne_garde_que_les_jonctions(self, grid):
        """Un damier 9 × 9 a 81 intersections : ce sont les seuls nœuds attendus."""
        graph = build_graph(grid)
        assert len(graph.nodes) == 81

    def test_nombre_d_aretes(self, grid):
        """9 lignes × 8 segments + 9 colonnes × 8 segments = 144."""
        graph = build_graph(grid)
        assert len(graph.edges) == 144

    def test_voies_exclues_absentes(self):
        payload = grid_payload(dangerous_row=4, dangerous_tags={"highway": "motorway"})
        graph = build_graph(payload)
        assert all(e.safety.highway != "motorway" for e in graph.edges)

        # 144 − 8 arêtes d'autoroute = 136. Mais les 9 nœuds de cette rangée
        # n'appartiennent plus qu'à une seule voie : ils cessent d'être des
        # jonctions, et chaque colonne fusionne ses deux segments de part et
        # d'autre. D'où 136 − 9 = 127 arêtes, et 81 − 9 = 72 nœuds.
        assert len(graph.edges) == 127
        assert len(graph.nodes) == 72

    def test_snapping(self, grid, grid_center):
        graph = build_graph(grid)
        node = graph.nearest_node(*grid_center)
        assert node is not None
        lon, lat = graph.nodes[node]
        assert abs(lon - grid_center[0]) < 1e-6
        assert abs(lat - grid_center[1]) < 1e-6

    def test_snapping_hors_zone(self, grid):
        graph = build_graph(grid)
        assert graph.nearest_node(10.0, 55.0, max_radius_m=2000) is None


class TestSecuriteDesAretes:
    def test_zone_batie_detectee_par_polygone(self, grid):
        graph = build_graph(grid)
        assert all(e.safety.in_builtup for e in graph.edges)

    def test_ligne_dangereuse_bien_notee(self):
        payload = grid_payload(dangerous_row=4)
        graph = build_graph(payload)
        risky = [e for e in graph.edges if e.safety.risk >= 1.5]
        assert len(risky) == 8
        assert all(e.safety.speed_kmh == 80.0 for e in risky)

    def test_rues_avec_trottoir_sans_risque(self, grid):
        graph = build_graph(grid)
        assert all(e.safety.risk == 0.0 for e in graph.edges)

    def test_repli_sans_identifiants_de_noeuds(self):
        """Si Overpass ne renvoie pas `nodes`, les coordonnées font office de clé."""
        payload = grid_payload()
        for el in payload["elements"]:
            el.pop("nodes", None)
        graph = build_graph(payload)
        assert len(graph.nodes) == 81
        assert len(graph.largest_component()) == 81


class TestRegleDeJonction:
    """Ce qui décide où une voie est coupée en arêtes.

    La contraction fusionne les nœuds de dessin — OSM en place un tous les
    quelques mètres pour tracer les courbes — et ne garde que les jonctions.
    C'est la règle la plus structurante du graphe : s'y tromper change le
    nombre d'arêtes, donc les distances, donc les itinéraires. Elle tient en
    trois cas.
    """

    def test_un_noeud_partage_par_deux_voies_est_une_jonction(self, grid):
        """Le damier ne garde que ses 81 intersections."""
        graph = build_graph(grid)
        assert len(graph.nodes) == 81

    def test_les_extremites_sont_des_jonctions(self):
        """Une voie isolée garde ses deux bouts, et rien entre les deux."""
        payload = {
            "elements": [
                {
                    "type": "way",
                    "id": 1,
                    "tags": {"highway": "residential", "sidewalk": "both"},
                    "nodes": [10, 11, 12, 13, 14],
                    "geometry": [{"lon": 2.30 + i * 0.001, "lat": 48.80} for i in range(5)],
                }
            ]
        }
        graph = build_graph(payload)
        assert len(graph.nodes) == 2
        assert len(graph.edges) == 1

    def test_une_traversee_coupe_la_voie(self):
        """Sans ça, le nœud de traversée disparaîtrait dans la contraction et
        le comptage L3 ne pourrait plus le voir."""
        geometry = [{"lon": 2.30 + i * 0.001, "lat": 48.80} for i in range(5)]
        payload = {
            "elements": [
                {
                    "type": "way",
                    "id": 1,
                    "tags": {"highway": "residential", "sidewalk": "both"},
                    "nodes": [10, 11, 12, 13, 14],
                    "geometry": geometry,
                },
                {
                    "type": "node",
                    "id": 12,
                    "lon": geometry[2]["lon"],
                    "lat": geometry[2]["lat"],
                    "tags": {"highway": "crossing", "crossing": "traffic_signals"},
                },
            ]
        }
        graph = build_graph(payload)
        assert len(graph.nodes) == 3, "le nœud de traversée doit survivre"
        assert len(graph.edges) == 2
        assert any(c.kind == "traffic_signals" for c in graph.crossings.values())

    def test_les_noeuds_de_dessin_disparaissent(self, grid):
        """Aucun nœud du graphe ne doit avoir exactement deux arêtes alignées.

        C'est la contrepartie de la contraction : s'il en restait, le graphe
        pèserait dix fois son poids utile et Dijkstra deviendrait inutilisable.
        """
        graph = build_graph(grid)
        for node in range(len(graph.nodes)):
            degre = len(graph.adj[node])
            assert degre != 2 or _est_un_coin(graph, node), (
                f"le nœud {node} est un simple point de dessin"
            )


def _est_un_coin(graph, node) -> bool:
    """Un nœud de degré 2 légitime : deux voies distinctes qui se rejoignent."""
    ways = {graph.edges[e].way_id for e in graph.adj[node]}
    return len(ways) > 1
