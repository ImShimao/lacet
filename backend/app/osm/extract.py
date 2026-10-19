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


@dataclass(slots=True)
class GreenArea:
    """Un parc, un bois, une forêt, un plan d'eau ou une rivière.

    `rings` porte les lignes telles qu'OpenStreetMap les donne : l'anneau fermé
    d'une voie, ou les morceaux de contour d'un multipolygone, extérieurs et
    trous mêlés. `fill` dit s'il faut aussi peindre l'intérieur — pas pour une
    rivière, qui n'est qu'un trait. Voir `osm.green`.
    """

    id: int
    fill: bool
    rings: list[list[Coord]]


@dataclass
class Extract:
    ways: list[Way] = field(default_factory=list)
    landuse: list[list[Coord]] = field(default_factory=list)
    crossings: list[CrossingNode] = field(default_factory=list)
    green: list[GreenArea] = field(default_factory=list)
    # Les voies qui font partie d'un sentier balisé (relation `route`).
    marked: set[int] = field(default_factory=set)

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
        green=[area for area in extract.green if any(ring and reaches(ring) for ring in area.rings)],
        marked=extract.marked,
    )


# Ce qu'on compte comme verdure ou eau — mêmes valeurs que la requête Overpass.
GREEN_TAGS = {
    "leisure": {"park"},
    "landuse": {"forest"},
    "natural": {"wood", "water"},
    "waterway": {"river", "canal"},
}
BUILTUP_LANDUSE = {"residential", "retail", "commercial", "industrial", "education"}


def is_green(tags: dict[str, str]) -> bool:
    return any(tags.get(key) in values for key, values in GREEN_TAGS.items())


def from_overpass(payload: dict[str, Any]) -> Extract:
    """Range une réponse Overpass brute. C'est le seul endroit qui la connaît."""
    extract = Extract()
    routes: set[int] = set()

    for el in payload.get("elements", ()):
        etype = el.get("type")
        tags = el.get("tags") or {}

        if etype == "relation":
            members = el.get("members") or ()
            if tags.get("route"):
                routes.update(m["ref"] for m in members if m.get("type") == "way")
            elif is_green(tags):
                # Un identifiant négatif : une relation et une voie peuvent
                # porter le même numéro, et la fusion des tuiles dédoublonne
                # par identifiant.
                rings = [
                    [(p["lon"], p["lat"]) for p in m["geometry"]]
                    for m in members
                    if m.get("type") == "way" and m.get("geometry")
                ]
                if rings:
                    extract.green.append(GreenArea(id=-int(el["id"]), fill=True, rings=rings))
            continue

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
        elif tags.get("landuse") in BUILTUP_LANDUSE:
            extract.landuse.append(coords)
        elif is_green(tags):
            # Une rivière est un trait ; un bois, un anneau fermé qu'on remplit.
            fill = not tags.get("waterway") and len(coords) > 2 and coords[0] == coords[-1]
            extract.green.append(GreenArea(id=int(el.get("id", 0)), fill=fill, rings=[coords]))

    # Seules les voies présentes comptent : une relation de grande randonnée
    # cite des milliers de voies, d'un bout à l'autre de la région.
    extract.marked = routes & {way.id for way in extract.ways}
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
        "green": [[a.id, a.fill, [_flatten(r) for r in a.rings]] for a in extract.green],
        "marked": sorted(extract.marked),
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
        # Absents des extraits écrits avant l'indice vert : ils se relisent sans.
        green=[
            GreenArea(id=gid, fill=fill, rings=[_unflatten(r) for r in rings])
            for gid, fill, rings in data.get("green", ())
        ],
        marked=set(data.get("marked", ())),
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
