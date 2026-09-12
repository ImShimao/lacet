"""Cache mémoire des graphes construits.

Reconstruire le graphe est, de loin, l'étape la plus coûteuse : environ cinq
secondes sur Paris intra-muros, contre une seconde pour la génération elle-même.
Or l'utilisateur enchaîne presque toujours plusieurs recherches au même endroit —
il change la distance, le terrain, il regénère. Refaire ce travail à chaque fois
est pure perte.

Le cache est volontairement petit : un graphe parisien pèse plusieurs centaines
de mégaoctets en mémoire. Mieux vaut en garder deux ou trois et reconstruire le
reste que de saturer la machine.
"""

from __future__ import annotations

import logging
import threading
from collections import OrderedDict
from typing import Any, Callable

from ..config import settings
from .graph import Graph

log = logging.getLogger(__name__)

class GraphCache:
    def __init__(self, max_entries: int | None = None, max_nodes: int | None = None) -> None:
        max_entries = settings.graph_cache_entries if max_entries is None else max_entries
        max_nodes = settings.graph_cache_nodes if max_nodes is None else max_nodes
        self._entries: OrderedDict[tuple, Graph] = OrderedDict()
        self._max = max_entries
        self._max_nodes = max_nodes
        # Le serveur traite plusieurs requêtes en parallèle : sans verrou, deux
        # recherches simultanées au même endroit construiraient le même graphe
        # deux fois, et se marcheraient dessus sur l'éviction.
        self._lock = threading.Lock()
        self.hits = 0
        self.misses = 0

    def peek(self, key: tuple) -> Graph | None:
        """Graphe déjà construit pour cette clé, sans en déclencher la construction.

        Permet d'éviter jusqu'au téléchargement des données : si le graphe est
        là, l'extrait OSM n'a plus besoin d'être relu.
        """
        with self._lock:
            cached = self._entries.get(key)
            if cached is None:
                return None
            self._entries.move_to_end(key)
            self.hits += 1
            log.info("graphe servi depuis le cache mémoire")
            return cached

    def get_or_build(self, key: tuple, build: Callable[[], Graph]) -> Graph:
        cached = self.peek(key)
        if cached is not None:
            return cached

        # Construction hors verrou : elle dure plusieurs secondes et ne doit pas
        # bloquer les autres requêtes. Deux constructions concurrentes de la même
        # zone restent possibles — c'est du travail en double, pas une erreur.
        graph = build()

        with self._lock:
            self._entries[key] = graph
            self._entries.move_to_end(key)
            self.misses += 1
            # On évince les plus anciens tant que le cache dépasse l'un des deux
            # plafonds — mais jamais la dernière entrée, sinon celle qu'on vient
            # de construire disparaîtrait avant d'avoir servi.
            while len(self._entries) > 1 and (
                len(self._entries) > self._max or self._total_nodes() > self._max_nodes
            ):
                evicted, _ = self._entries.popitem(last=False)
                log.info("graphe évincé du cache : %s", evicted)

        return graph

    def _total_nodes(self) -> int:
        return sum(len(g.nodes) for g in self._entries.values())

    def clear(self) -> None:
        with self._lock:
            self._entries.clear()

    @property
    def stats(self) -> dict[str, Any]:
        return {
            "entries": len(self._entries),
            "nodes": self._total_nodes(),
            "hits": self.hits,
            "misses": self.misses,
        }


graph_cache = GraphCache()
