"""L0 — exclusion dure.

Ces arêtes ne reçoivent pas une pénalité : elles n'entrent pas dans le graphe.
Aucune pondération, aussi forte soit-elle, ne doit pouvoir les faire revenir.
"""

from __future__ import annotations

EXCLUDED_HIGHWAY = {
    "motorway",
    "motorway_link",
    "trunk",
    "trunk_link",
    "construction",
    "proposed",
    "raceway",
    "bus_guideway",
    "escape",
    "corridor",
    "elevator",
}

# Valeurs de `foot` (ou `bicycle`, à vélo) qui rouvrent explicitement un passage
# fermé par `access`.
_ALLOWED = {"yes", "designated", "permissive", "destination", "official"}

# Difficulté de sentier au-delà de laquelle on sort du domaine « course à pied ».
_SAC_FORBIDDEN = {
    "demanding_mountain_hiking",
    "alpine_hiking",
    "demanding_alpine_hiking",
    "difficult_alpine_hiking",
}

# Voies qui ne sont pas des chemins praticables même si `highway` est présent.
_NON_ROUTABLE = {"platform", "rest_area", "services", "emergency_bay"}


def is_excluded(
    tags: dict[str, str], *, allow_trail: bool = False, sport: str = "run"
) -> str | None:
    """Rend le motif d'exclusion, ou None si l'arête est admissible.

    `allow_trail` détend la contrainte `sac_scale` pour le mode sentier.
    """
    highway = tags.get("highway", "")

    if sport == "bike":
        # Un vélo ne descend pas des escaliers, et une interdiction explicite
        # reste une interdiction. Les voies piétonnes ne sont pas exclues :
        # elles seront simplement très pénalisées, car on peut y marcher à côté.
        if highway == "steps":
            return "escaliers"
        if tags.get("bicycle") in {"no", "private"}:
            return f"bicycle={tags['bicycle']}"

    if highway in EXCLUDED_HIGHWAY:
        return f"highway={highway}"
    if highway in _NON_ROUTABLE:
        return f"highway={highway}"

    # Chacun ses droits. Un vélo n'a que faire de `foot=no` — c'est même le
    # marquage d'une piste cyclable interdite aux piétons —, et un `access=no`
    # se rouvre pour lui par `bicycle`, pas par `foot`. Mesuré dans le centre de
    # Lyon : neuf kilomètres de pistes manquaient au graphe vélo, et les boucles
    # les contournaient par la chaussée.
    own = tags.get("bicycle") if sport == "bike" else tags.get("foot")
    if sport != "bike" and own in {"no", "private"}:
        return f"foot={own}"

    access = tags.get("access")
    if access in {"no", "private"} and own not in _ALLOWED:
        return f"access={access}"

    if tags.get("route") == "ferry":
        return "route=ferry"

    # Tunnel non aménagé pour les piétons : jamais.
    if tunnel_is_unprotected(tags):
        return "tunnel sans trottoir"

    if not allow_trail and tags.get("sac_scale") in _SAC_FORBIDDEN:
        return f"sac_scale={tags['sac_scale']}"

    # Voie en construction déclarée autrement.
    if tags.get("highway") == "road" and tags.get("area") == "yes":
        return "surface indéfinie"

    return None


# --- sens unique ---------------------------------------------------------------

_ONEWAY_FORWARD = {"yes", "1", "true"}
_ONEWAY_BACKWARD = {"-1", "reverse"}
# Le contresens cyclable, sous ses différentes écritures.
_CONTRAFLOW = {"opposite", "opposite_lane", "opposite_track", "opposite_share_busway"}
_CYCLEWAY_KEYS = ("cycleway", "cycleway:left", "cycleway:right", "cycleway:both")
_CYCLEWAY_ONEWAY_KEYS = ("cycleway:left:oneway", "cycleway:right:oneway", "cycleway:both:oneway")


def oneway_for(tags: dict[str, str], sport: str = "run") -> int:
    """Le sens permis : 1 dans le sens de la voie, -1 à rebours, 0 les deux.

    À pied, aucun : un sens unique ne s'impose pas au piéton. À vélo, si — le
    graphe l'ignorait, et une boucle pouvait remonter une rue en sens interdit.
    Sauf contresens cyclable : `oneway:bicycle=no`, une bande ou une piste
    `opposite`, ou une bande dont le propre sens dit qu'elle remonte la rue.
    """
    if sport != "bike":
        return 0
    own = tags.get("oneway:bicycle")
    if own is None:
        if any(tags.get(key) in _CONTRAFLOW for key in _CYCLEWAY_KEYS):
            return 0
        if any(tags.get(key) in {"no", "-1"} for key in _CYCLEWAY_ONEWAY_KEYS):
            return 0
    value = own if own is not None else tags.get("oneway")
    if value in _ONEWAY_FORWARD:
        return 1
    if value in _ONEWAY_BACKWARD:
        return -1
    if value is None and tags.get("junction") in {"roundabout", "circular"}:
        return 1
    return 0


_PEDESTRIAN_HIGHWAY = {"footway", "path", "pedestrian", "steps", "cycleway", "living_street"}


def tunnel_is_unprotected(tags: dict[str, str]) -> bool:
    """Un tunnel routier sans aménagement piéton — le cas à bannir.

    Un passage souterrain piéton ou un tunnel avec trottoir n'en fait pas partie :
    ce sont même souvent les endroits les plus sûrs pour traverser. C'est cette
    fonction, et elle seule, qui fait foi — L0 l'utilise pour exclure, et le
    portail L3 pour compter. Deux définitions divergentes feraient rejeter des
    itinéraires parfaitement corrects.
    """
    if tags.get("tunnel") not in {"yes", "building_passage"}:
        return False
    if tags.get("highway") in _PEDESTRIAN_HIGHWAY:
        return False
    return not _has_sidewalk_tag(tags)


def _has_sidewalk_tag(tags: dict[str, str]) -> bool:
    if tags.get("sidewalk") not in {None, "no", "none"}:
        return True
    for side in ("left", "right", "both"):
        if tags.get(f"sidewalk:{side}") not in {None, "no", "none", "separate"}:
            return True
    return tags.get("footway") == "sidewalk"
