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

# Valeurs de `foot`/`access` qui rouvrent explicitement le passage.
_FOOT_ALLOWED = {"yes", "designated", "permissive", "destination", "official"}

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

    foot = tags.get("foot")
    if foot in {"no", "private"}:
        return f"foot={foot}"

    access = tags.get("access")
    if access in {"no", "private"} and foot not in _FOOT_ALLOWED:
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
