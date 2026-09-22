"""L'extrait OpenStreetMap, sous la forme dont le graphe a besoin.

Overpass rend un tableau d'« éléments » hétérogènes, chaque point de géométrie
étant un petit dictionnaire `{"lat": …, "lon": …}`. Sur un extrait parisien
cela fait **2,9 millions de dictionnaires** à construire — et à reconstruire à
chaque lecture du cache, puisque c'est cette forme brute qui y était rangée.
C'est, de loin, le poste le plus cher d'une recherche dont les données sont
déjà en cache : trois secondes de pur analyse syntaxique avant que le moindre
calcul d'itinéraire ne commence.

Ce module range donc l'extrait sous la forme réellement utile — des voies, des
polygones de zone bâtie, des nœuds de traversée — et le cache l'écrit **à plat** :
une géométrie devient `[lon, lat, lon, lat, …]` au lieu d'une liste d'objets.
Le fichier perd 40 % de son poids et la lecture deux secondes, pour exactement
les mêmes données.

Le format porte un numéro de version. Un cache écrit par une version
précédente est reconnu à son champ `elements`, relu par le chemin d'origine, et
réécrit au nouveau format lors du prochain téléchargement : rien à supprimer à
la main.
"""

from __future__ import annotations

import math
from dataclasses import dataclass, field
from typing import Any

from ..geo import Coord

# Numéro du format compact. À incrémenter si la disposition change, pour que les
# extraits déjà sur disque soient ignorés plutôt que mal relus.
FORMAT_VERSION = 2


@dataclass(slots=True)
class Way:
    """Une voie : ses tags, ses nœuds, et sa géométrie déjà en (lon, lat)."""

    id: int
    tags: dict[str, str]
    nodes: list[int]
    coords: list[Coord]


@dataclass(slots=True)
class CrossingNode:
    """Un nœud tagué `highway=crossing`, avec de quoi le classer."""

    id: int
    lon: float
    lat: float
    tags: dict[str, str]


@dataclass
class Extract:
    ways: list[Way] = field(default_factory=list)
    landuse: list[list[Coord]] = field(default_factory=list)
    crossings: list[CrossingNode] = field(default_factory=list)

    def __bool__(self) -> bool:
        return bool(self.ways)


def clip_to_disk(extract: Extract, lon: float, lat: float, radius_m: float) -> Extract:
    """Ne garde que ce qui touche le disque demandé.

    Overpass rend un rectangle, et une voie entière dès qu'elle l'effleure : un
    quart de la surface reçue est hors d'atteinte d'une boucle qui, par
    construction, ne s'éloigne jamais de plus de la moitié de sa longueur. Tout
    ce débord était construit en graphe puis parcouru par Dijkstra pour rien.

    Une voie qui déborde est gardée **entière** : on ne coupe pas les rues, on
    écarte seulement celles qui sont hors d'atteinte de bout en bout. Même
    découpe que `clipToDisk` dans `frontend/src/engine/extract.js` — les deux
    moteurs doivent partir du même extrait.
    """
    kx = math.cos(math.radians(lat)) * 111_320.0
    ky = 110_540.0

    def reaches(coords: list[Coord]) -> bool:
        west = min(c[0] for c in coords)
        east = max(c[0] for c in coords)
        south = min(c[1] for c in coords)
        north = max(c[1] for c in coords)
        dx = (min(max(lon, west), east) - lon) * kx
        dy = (min(max(lat, south), north) - lat) * ky
        return dx * dx + dy * dy <= radius_m * radius_m

    return Extract(
        ways=[way for way in extract.ways if way.coords and reaches(way.coords)],
        landuse=[ring for ring in extract.landuse if ring and reaches(ring)],
        crossings=[
            node
            for node in extract.crossings
            if ((node.lon - lon) * kx) ** 2 + ((node.lat - lat) * ky) ** 2 <= radius_m * radius_m
        ],
    )


def from_overpass(payload: dict[str, Any]) -> Extract:
    """Range une réponse Overpass brute. C'est le seul endroit qui la connaît."""
    extract = Extract()

    for el in payload.get("elements", ()):
        etype = el.get("type")
        tags = el.get("tags") or {}

        if etype == "node":
            if tags.get("highway") == "crossing":
                extract.crossings.append(
                    CrossingNode(id=el["id"], lon=el["lon"], lat=el["lat"], tags=tags)
                )
            continue

        geometry = el.get("geometry")
        if etype != "way" or not geometry:
            continue

        coords = [(p["lon"], p["lat"]) for p in geometry]
        if tags.get("highway"):
            extract.ways.append(
                Way(
                    id=int(el.get("id", 0)),
                    tags=tags,
                    nodes=el.get("nodes") or [],
                    coords=coords,
                )
            )
        elif tags.get("landuse"):
            extract.landuse.append(coords)

    return extract


def to_cache(extract: Extract) -> dict[str, Any]:
    """Forme compacte, destinée au disque. Les géométries sont mises à plat."""
    return {
        "v": FORMAT_VERSION,
        "ways": [
            [w.id, w.tags, w.nodes, _flatten(w.coords)] for w in extract.ways
        ],
        "landuse": [_flatten(ring) for ring in extract.landuse],
        "crossings": [[c.id, c.lon, c.lat, c.tags] for c in extract.crossings],
    }


def from_cache(data: dict[str, Any]) -> Extract | None:
    """Relit la forme compacte. Rend None si ce n'est pas ce format-là."""
    if data.get("v") != FORMAT_VERSION:
        return None

    return Extract(
        ways=[
            Way(id=wid, tags=tags, nodes=nodes, coords=_unflatten(flat))
            for wid, tags, nodes, flat in data.get("ways", ())
        ],
        landuse=[_unflatten(flat) for flat in data.get("landuse", ())],
        crossings=[
            CrossingNode(id=cid, lon=lon, lat=lat, tags=tags)
            for cid, lon, lat, tags in data.get("crossings", ())
        ],
    )


def read(data: dict[str, Any]) -> Extract:
    """Relit un extrait quel que soit son format — compact ou Overpass brut.

    Les caches écrits par une version précédente restent lisibles ; ils seront
    remplacés par la forme compacte au prochain téléchargement de la zone.
    """
    compact = from_cache(data)
    return compact if compact is not None else from_overpass(data)


def _flatten(coords: list[Coord]) -> list[float]:
    out: list[float] = []
    for lon, lat in coords:
        out.append(lon)
        out.append(lat)
    return out


def _unflatten(flat: list[float]) -> list[Coord]:
    # `zip` sur deux vues décalées : c'est la forme la plus rapide en Python
    # pur, et elle évite de construire une liste intermédiaire par point.
    return list(zip(flat[0::2], flat[1::2]))
