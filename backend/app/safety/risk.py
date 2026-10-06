"""L1 + L2 — le calcul du risque.

Le danger réel pour un coureur n'est ni la vitesse seule ni l'absence de trottoir
seule : c'est le produit des deux.

    risque = (v / 50)² × (1 − sep / 2)

Le carré est délibéré. Une rue à 30 km/h sans trottoir est confortable ; une
départementale à 80 sans accotement ne l'est pas « 2,7 fois plus », elle est
d'un autre ordre. Le modèle doit refléter ça.

L2 (règle du doute) traite l'absence de tag `sidewalk`, qui est le cas majoritaire
dans OSM en France. L'inférence est volontairement **asymétrique** : optimiste
en ville où l'erreur est bénigne, pessimiste hors agglomération où elle ne l'est pas.
"""

from __future__ import annotations

from dataclasses import dataclass

# Vitesses par défaut (km/h) quand `maxspeed` n'est pas tagué — barème français.
# Note : depuis 2018 le hors-agglomération est à 80, mais une trentaine de
# départements sont repassés à 90 sur une partie de leur réseau. On reste à 80 :
# c'est la valeur qui produit le moins de faux négatifs de sécurité.
#
# Sauf pour les voies communales (`unclassified`) : la limite y est de 80, mais
# on ne roule pas à 80 sur une route étroite, sans marquage, qui dessert trois
# hameaux et les vignes. À 80, elles comptaient toutes comme « exposées », comme
# une départementale : autour de Meursault, où elles sont presque les seules
# routes goudronnées hors du bourg, la recherche à pied ne rendait que des tours
# de 2 km répétés quatre fois, et à vélo de route des boucles à 30 % de terre.
# À 60, leur risque (0,44) les laisse pénalisées sans les classer exposées :
# cinq vraies boucles à pied, notées A ou B, et des boucles vélo goudronnées à
# 95 %. Les départementales (`tertiary` et au-dessus) restent à 80.
DEFAULT_SPEED_KMH: dict[str, float] = {
    "primary": 80.0,
    "primary_link": 60.0,
    "secondary": 80.0,
    "secondary_link": 60.0,
    "tertiary": 80.0,
    "tertiary_link": 50.0,
    "unclassified": 60.0,
    "residential": 50.0,
    "living_street": 20.0,
    "service": 30.0,
    "track": 30.0,
    "pedestrian": 10.0,
    "footway": 10.0,
    "path": 10.0,
    "cycleway": 20.0,
    "steps": 5.0,
    "bridleway": 10.0,
    "road": 50.0,
}

# Limite par défaut en agglomération (article R413-3 du code de la route).
URBAN_DEFAULT_KMH = 50.0

# Voies où le coureur est physiquement séparé du trafic motorisé.
DEDICATED_HIGHWAY = {
    "footway",
    "path",
    "pedestrian",
    "steps",
    "bridleway",
    "living_street",
    "track",
}

_SIDEWALK_PRESENT = {"both", "left", "right", "yes", "separate"}
_SIDEWALK_ABSENT = {"no", "none"}

# Les clés par côté sont écrites une fois pour toutes. Les composer à la volée
# — `f"sidewalk:{side}"` — fabriquait trois chaînes à chaque voie examinée, soit
# près d'un million de constructions inutiles sur un extrait de grande ville,
# pour un résultat toujours identique.
_SIDEWALK_SIDES = ("sidewalk:left", "sidewalk:right", "sidewalk:both")
_CYCLEWAY_SIDES = ("cycleway:left", "cycleway:right", "cycleway:both")
_SHOULDER_PRESENT = {"yes", "both", "left", "right"}

# --- vélo -----------------------------------------------------------------
# Ce qui protège un cycliste n'est pas ce qui protège un coureur. Un trottoir
# ne lui sert à rien : il roule sur la chaussée. Ce qui compte, c'est la
# présence d'un aménagement cyclable.
_CYCLEWAY_PRESENT = {"track", "lane", "opposite_track", "opposite_lane", "share_busway", "yes"}
_BIKE_DESIGNATED = {"designated", "yes"}

PAVED_SURFACES = {
    "asphalt", "paved", "concrete", "concrete:plates", "concrete:lanes",
    "paving_stones", "sett", "cobblestone", "chipseal", "metal", "wood",
}
GRAVEL_SURFACES = {
    "compacted", "gravel", "fine_gravel", "pebblestone", "unpaved", "rock",
}
TRAIL_SURFACES = {
    "ground", "dirt", "earth", "grass", "mud", "sand", "woodchips", "snow", "ice",
}

# Vitesse en dessous de laquelle courir ou rouler sur la chaussée ne pose pas
# de problème particulier. Sert d'origine à la courbe de risque.
FREE_SPEED_KMH = 40.0

# Échelle de montée du risque au-dessus de ce seuil : à +30 km/h, le risque
# vaut 1 sur une chaussée nue.
RISK_SCALE_KMH = 30.0

# Seuil au-delà duquel un tronçon est compté comme « exposé » par le portail L3.
# Calé à 1,5 : une voie à 70 sans trottoir (risque 1,00) reste acceptable, une
# voie à 80 (1,78) ne l'est plus.
EXPOSED_RISK = 1.5

MAX_RISK = 8.0

# Le motif de séparation d'une voie ouverte aux vélos : c'est lui que le profil
# vélo lit pour savoir qu'une voie piétonne se roule (voir `weights.py`).
CYCLE_FACILITY = "aménagement cyclable"


@dataclass(frozen=True)
class EdgeSafety:
    """Résultat de l'évaluation d'un tronçon."""

    risk: float
    separation: float
    speed_kmh: float
    surface: str  # paved | gravel | trail | unknown
    lit: bool | None
    inferred: bool  # la séparation vient-elle de la règle du doute ?
    reason: str  # d'où vient la valeur de séparation
    highway: str  # classe OSM, utile au modèle de nuit
    in_builtup: bool  # en zone bâtie ? (idem)

    @property
    def level(self) -> str:
        if self.risk >= EXPOSED_RISK:
            return "risk"
        if self.risk >= 0.4:  # à partir de ~60 km/h sur chaussée nue
            return "caution"
        return "safe"


def speed_of(tags: dict[str, str], *, in_builtup: bool = False) -> float:
    """Vitesse de référence du trafic sur ce tronçon, en km/h.

    `in_builtup` compte autant que la classe de voie : en France, la limite par
    défaut **en agglomération est 50 km/h**, quelle que soit l'importance de la
    route. Une départementale qui traverse un bourg n'y roule pas à 80. Ignorer
    ça faisait ressortir chaque boulevard de petite ville au même niveau de
    risque qu'une deux-voies de rase campagne — et le portail rejetait alors
    tous les itinéraires possibles.
    """
    raw = tags.get("maxspeed")
    if raw:
        parsed = _parse_maxspeed(raw)
        if parsed is not None:
            return parsed

    # Une zone 30 / zone de rencontre écrase la classe de voie.
    if tags.get("zone:maxspeed", "").endswith(":30"):
        return 30.0

    default = DEFAULT_SPEED_KMH.get(tags.get("highway", ""), 50.0)
    return min(default, URBAN_DEFAULT_KMH) if in_builtup else default


def _parse_maxspeed(raw: str) -> float | None:
    raw = raw.strip().lower()
    if raw in {"none", "signals", "variable"}:
        return None
    if raw == "walk":
        return 10.0
    if raw.endswith("mph"):
        try:
            return float(raw.replace("mph", "").strip()) * 1.60934
        except ValueError:
            return None
    # "50", "50 km/h", "FR:urban"
    if raw.startswith("fr:"):
        return {"fr:urban": 50.0, "fr:rural": 80.0, "fr:motorway": 130.0}.get(raw)
    try:
        return float(raw.replace("km/h", "").strip())
    except ValueError:
        return None


def has_sidewalk(tags: dict[str, str]) -> bool | None:
    """True = trottoir tagué, False = absence taguée, None = pas d'information."""
    main = tags.get("sidewalk")
    if main in _SIDEWALK_PRESENT:
        return True
    if main in _SIDEWALK_ABSENT:
        return False
    for key in _SIDEWALK_SIDES:
        if tags.get(key) in _SIDEWALK_PRESENT:
            return True
    if tags.get("footway") == "sidewalk":
        return True
    return None


def has_cycleway(tags: dict[str, str]) -> bool:
    """Aménagement cyclable présent sur ce tronçon ?

    Une zone piétonne ouverte aux vélos en est un, comme un chemin : sans elle
    dans la liste, la rue piétonne `bicycle=yes` restait une voie piétonne, et
    le profil vélo la pénalisait comme un trottoir (voir `weights.py`).
    """
    if tags.get("highway") == "cycleway":
        return True
    if tags.get("bicycle") in _BIKE_DESIGNATED and tags.get("highway") in {
        "path",
        "footway",
        "track",
        "pedestrian",
    }:
        return True
    if tags.get("cycleway") in _CYCLEWAY_PRESENT:
        return True
    for key in _CYCLEWAY_SIDES:
        if tags.get(key) in _CYCLEWAY_PRESENT:
            return True
    return False


def separation_bike(tags: dict[str, str], *, in_builtup: bool) -> tuple[float, bool, str]:
    """Séparation du point de vue d'un cycliste.

    Le trottoir n'entre pas en compte : un vélo roule sur la chaussée. Et la
    règle du doute s'inverse — en ville, l'absence d'aménagement cyclable est
    la norme, pas une lacune de la donnée. On ne peut donc pas lui accorder le
    bénéfice du doute comme on le fait pour un trottoir.
    """
    highway = tags.get("highway", "")

    if has_cycleway(tags):
        return 2.0, False, CYCLE_FACILITY

    if highway in {"path", "track", "bridleway", "living_street", "pedestrian"}:
        return 2.0, False, "voie sans trafic motorisé"

    if tags.get("shoulder") in _SHOULDER_PRESENT:
        return 1.0, False, "accotement"

    # Une rue apaisée protège de fait le cycliste : la vitesse fait le reste.
    if speed_of(tags, in_builtup=in_builtup) <= 30:
        return 1.0, False, "rue apaisée"

    return 0.0, False, "chaussée partagée"


def separation(tags: dict[str, str], *, in_builtup: bool) -> tuple[float, bool, str]:
    """Rend (séparation ∈ [0, 2], valeur inférée ?, motif).

    2 = voie dédiée ou trottoir · 1 = accotement · 0 = chaussée nue.
    """
    highway = tags.get("highway", "")

    if highway in DEDICATED_HIGHWAY:
        return 2.0, False, "voie dédiée"

    # Une piste cyclable n'a pas de voitures, et elle n'est dans le graphe que si
    # `foot` ne l'interdit pas. Seules celles marquées `foot=yes` comptaient
    # comme protégées ; les autres tombaient dans la règle du doute, comme une
    # rue : « trottoir probable » en ville, « aucun trottoir supposé » ailleurs —
    # et la piste qui longe la zone commerciale de Guebwiller comptait comme non
    # protégée.
    if highway == "cycleway":
        return 2.0, False, "piste cyclable, sans voitures"

    sidewalk = has_sidewalk(tags)
    if sidewalk is True:
        return 2.0, False, "trottoir tagué"

    if tags.get("shoulder") in _SHOULDER_PRESENT:
        return 1.0, False, "accotement"

    if sidewalk is False:
        return 0.0, False, "absence de trottoir taguée"

    # --- L2 : aucune information. Règle du doute. -------------------------
    speed = speed_of(tags, in_builtup=in_builtup)
    if in_builtup and speed <= 50:
        # En ville, l'absence de tag signifie presque toujours « personne n'a
        # encore renseigné », pas « il n'y a pas de trottoir ».
        return 1.5, True, "trottoir probable (bâti dense)"

    # Hors agglomération ou sur voie rapide, on suppose le pire.
    return 0.0, True, "aucun trottoir supposé"


def risk_score(speed_kmh: float, sep: float) -> float:
    """risque = ((v − 40) / 30)² × (1 − sep / 2), borné à [0, MAX_RISK].

    Le seuil de 40 km/h est le cœur du calibrage. En dessous, courir sur la
    chaussée est simplement normal : personne ne fait un détour pour éviter une
    rue à 30, et une app qui l'imposerait serait inutilisable. Le risque ne
    commence à compter qu'au-delà, et il grimpe au carré :

        50 km/h → 0,11     rue ordinaire, aucun problème
        70 km/h → 1,00     acceptable, on court sur le bas-côté
        80 km/h → 1,78     au-delà du seuil d'exposition : à éviter
        90 km/h → 2,78     franchement mauvais

    Les voies rapides et autoroutes ne passent pas par ici : elles sont
    supprimées du graphe en L0 et n'ont donc pas de score.
    """
    exposure = max(0.0, 1.0 - sep / 2.0)
    over = max(0.0, speed_kmh - FREE_SPEED_KMH) / RISK_SCALE_KMH
    return min(MAX_RISK, over * over * exposure)


def classify_surface(tags: dict[str, str]) -> str:
    surface = tags.get("surface", "").lower()
    if surface in PAVED_SURFACES:
        return "paved"
    if surface in GRAVEL_SURFACES:
        return "gravel"
    if surface in TRAIL_SURFACES:
        return "trail"

    # Pas de tag `surface` : on déduit de la classe de voie.
    highway = tags.get("highway", "")
    if highway == "path" and tags.get("bicycle") == "designated":
        # Un chemin réservé aux vélos — voie verte, piste mixte — se déduit
        # comme une `cycleway` : revêtu. Pris pour un sentier, il coûtait 1,6
        # fois sa longueur à vélo et 2,3 fois à pied en « Route », et les boucles
        # le contournaient par la chaussée.
        return "paved"
    if highway in {"path", "bridleway"}:
        return "trail"
    if highway == "track":
        # `tracktype` est un bon indicateur secondaire.
        return "gravel" if tags.get("tracktype") in {"grade1", "grade2"} else "trail"
    if highway in {"footway", "pedestrian", "steps", "cycleway"}:
        return "paved"
    if highway in DEFAULT_SPEED_KMH:
        return "paved"
    return "unknown"


def is_lit(tags: dict[str, str]) -> bool | None:
    lit = tags.get("lit")
    if lit is None:
        return None
    if lit in {"no", "disused"}:
        return False
    return True  # yes, 24/7, sunset-sunrise, automatic...


def evaluate_edge(
    tags: dict[str, str], *, in_builtup: bool, sport: str = "run"
) -> EdgeSafety:
    """Évaluation complète d'un tronçon : L1 + L2, selon le sport pratiqué."""
    speed = speed_of(tags, in_builtup=in_builtup)
    if sport == "bike":
        sep, inferred, reason = separation_bike(tags, in_builtup=in_builtup)
    else:
        sep, inferred, reason = separation(tags, in_builtup=in_builtup)
    return EdgeSafety(
        risk=risk_score(speed, sep),
        separation=sep,
        speed_kmh=speed,
        surface=classify_surface(tags),
        lit=is_lit(tags),
        inferred=inferred,
        reason=reason,
        highway=tags.get("highway", ""),
        in_builtup=in_builtup,
    )
