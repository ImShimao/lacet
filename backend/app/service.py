"""Orchestration : de la requête utilisateur aux itinéraires notés.

Enchaînement complet :

    Overpass → graphe (L0/L1/L2) → génération → filtre distance →
    portail L3 → dédoublonnage → altitude → notation → réponse

L'altitude n'est demandée qu'aux candidats survivants : c'est un appel réseau
externe, on ne le paie pas pour des tracés qu'on va jeter.
"""

from __future__ import annotations

import logging
import math
import time
from collections import Counter
from datetime import datetime, timezone

import asyncio

from .config import settings
from .elevation import ascent_descent, fetch_many, smooth
from .geo import haversine_m, resample
from .navigation import build_instructions
from .models import (
    Crossing,
    ElevationPoint,
    ElevationPref,
    Instruction,
    LoopRequest,
    LoopResponse,
    Rejected,
    RouteCandidate,
    SafetyMode,
    SafetyReport,
    Segment,
    SurfacePref,
    SurfaceReport,
    TimeOfDay,
)
from .osm.cache import graph_cache
from .osm.graph import build_graph
from .osm.overpass import area_key, fetch_area
from .routing.loops import Candidate, generate_loops, repeat_loop, similarity
from .routing.weights import build_profile
from .safety.gate import grade_route, run_gate
from .solar import is_night
from .wind import Wind, current_wind, tailwind_finish

log = logging.getLogger(__name__)

# D+ visé par kilomètre, selon la préférence de profil.
ELEVATION_TARGET_PER_KM = {
    ElevationPref.flat: 3.0,
    ElevationPref.rolling: 10.0,
    ElevationPref.hilly: 22.0,
}

# Écart de D+ par kilomètre au-delà duquel la note de dénivelé est divisée par
# deux. Il valait 9, soit près de la moitié de l'écart entre « plat » (3 m/km)
# et « côtes » (22 m/km) : la courbe était si plate que 1,7 et 5,3 m/km ne se
# distinguaient plus.
ELEVATION_TOLERANCE_PER_KM = 5.0

# Fourchette de D+ par kilomètre acceptable pour chaque préférence.
ELEVATION_BAND_PER_KM = {
    ElevationPref.flat: (0.0, 10.0),
    ElevationPref.rolling: (3.0, 20.0),
    ElevationPref.hilly: (12.0, float("inf")),
}

# Retrait appliqué à une boucle hors de cette fourchette. Il doit dépasser tout
# ce que le tri diversifié peut accorder (0,45 + 0,30), sans quoi une boucle à
# 300 m de D+ était **repêchée en mode Plat** au seul motif qu'elle partait dans
# une direction encore inutilisée. La variété est un agrément ; « je veux du
# plat » est une demande. Ce n'est pas un rejet pour autant : s'il ne reste que
# des boucles hors fourchette, elles sont proposées — dans l'ordre, et sans
# qu'aucune boucle conforme ne leur passe derrière.
OUT_OF_BAND_PENALTY = 0.8

# Au-delà de ce taux d'arêtes communes, deux candidats sont le même itinéraire.
DUPLICATE_THRESHOLD = 0.55

# Poids de la variété dans le choix final. Trier sur le seul score revient à
# proposer trois fois la meilleure boucle vue sous un angle légèrement différent
# — c'est ce que faisait la version précédente, qui sortait régulièrement deux
# « sud-ouest » sur trois. On retranche donc à chaque candidat ce qu'il partage
# avec ceux déjà retenus : les arêtes communes, et la proximité de direction.
# Un candidat un peu moins bon mais qui part à l'opposé vaut mieux qu'un clone.
VARIETY_OVERLAP_WEIGHT = 0.45
VARIETY_BEARING_WEIGHT = 0.30

# En dessous de cet écart de cap avec un itinéraire déjà retenu, deux boucles
# « partent dans la même direction » du point de vue de l'utilisateur.
BEARING_SPREAD_DEG = 90.0

# Poids du vent dans la note finale. Volontairement faible : c'est un
# départage, pas un critère. Une boucle plus sûre, mieux calibrée ou plus ronde
# doit gagner malgré un retour vent de face — le vent ne décide qu'à qualité
# comparable. Il est en outre pondéré par la force du vent, donc nul par temps
# calme.
WIND_WEIGHT = 0.10

# --- boucles répétées -----------------------------------------------------
# Quand la distance demandée ne donne rien — ou trop peu — on cherche une boucle
# plus courte à parcourir plusieurs fois. Divisions essayées, dans l'ordre :
# deux tours avant trois, trois avant quatre.
LAP_DIVISORS = (2, 3, 4)

# Longueur minimale d'un tour. En dessous, « cinq tours de 800 m » n'est plus
# une sortie mais une séance de piste, et personne n'est venu chercher ça.
MIN_LAP_M = 1500.0

# Retrait par tour supplémentaire. Une boucle entière reste préférable : on ne
# propose la répétition que faute de mieux, et deux tours valent mieux que
# quatre. Le retrait reste petit devant celui d'un cran de note (0,9), pour ne
# jamais faire passer un tracé moins sûr devant.
LAP_PENALTY = 0.12

# Candidats gardés en réserve au-delà du nombre demandé. Proportionnelle : à
# douze propositions, six de réserve ne laissent presque aucun choix au tri
# diversifié, et les directions se répètent.
def shortlist_size(limit: int) -> int:
    return limit + max(6, limit)

# En dessous de ce quotient isopérimétrique, le tracé n'est plus une boucle mais
# un aller-retour. Repère : triangle équilatéral 0,61 · carré 0,79 · une boucle
# urbaine réaliste tourne désormais entre 0,30 et 0,55 · une « sucette » sous 0,10.
MIN_ROUNDNESS = 0.12

# Retrait par cran de note perdu. Il doit dépasser tout ce que le tri diversifié
# peut accorder (0,45 + 0,30), sinon une boucle notée B remonte devant une A au
# seul motif qu'elle part dans une autre direction — et l'app se contredit sous
# les yeux de l'utilisateur, qui voit un B en tête et des A derrière.
#
# La note résume la sécurité, et la sécurité est la promesse du produit : elle
# passe donc avant l'agrément. À note égale, le score fait le reste du travail —
# distance, forme, variété, dénivelé.
GRADE_PENALTY = 0.9
GRADE_RANK = {"A": 0, "B": 1, "C": 2}

# Nombre de traversées non protégées à partir duquel la composante de sécurité
# correspondante s'annule. Le portail en tolère deux en mode Sûr : au-delà de
# trois, le classement n'a plus de raison de faire la différence.
CROSSINGS_REFERENCE = 3.0

# Rondeur à partir de laquelle la note de forme est au maximum. Les boucles
# obtenues tournant maintenant autour de 0,45, plafonner plus bas reviendrait à
# ne plus distinguer une belle boucle d'une boucle correcte.
GOOD_ROUNDNESS = 0.55

# Plafond de points d'altitude par itinéraire, quelle que soit sa longueur.
MAX_ELEVATION_SAMPLES = 300

CARDINALS = ["nord", "nord-est", "est", "sud-est", "sud", "sud-ouest", "ouest", "nord-ouest"]


class PlanningError(RuntimeError):
    """Erreur métier, à remonter en 4xx plutôt qu'en 500."""


async def plan_loops(req: LoopRequest) -> LoopResponse:
    started = time.perf_counter()
    timings: dict[str, float] = {}

    def lap(name: str) -> None:
        previous = sum(timings.values())
        timings[name] = round(time.perf_counter() - started - previous, 2)

    target_m = req.distance_km * 1000.0

    # --- données ----------------------------------------------------------
    # Une boucle de longueur L ne s'éloigne jamais de plus de L/2 à vol d'oiseau,
    # et la plus longue acceptée vaut la distance visée plus l'écart toléré.
    # Le rayon est arrondi au kilomètre supérieur : sans ça, faire glisser la
    # distance de 10 à 10,5 km changerait d'extrait et invaliderait le cache
    # alors que la zone est la même. On télécharge un peu plus, une seule fois.
    radius_m = math.ceil(max(1500.0, target_m * (1.0 + req.tolerance) / 2.0) / 1000.0) * 1000.0
    allow_trail = req.surface is SurfacePref.trail
    cache_key = (area_key(req.lat, req.lon, radius_m, target_m), req.sport.value, allow_trail)

    # Le graphe ne dépend que de l'extrait et du sport — ni de la distance visée,
    # ni du profil de sécurité, ni de l'heure. Enchaîner plusieurs recherches au
    # même endroit, ce que tout le monde fait, ne doit le construire qu'une fois.
    graph = graph_cache.peek(cache_key)
    if graph is not None:
        lap("fetch")
        lap("graph")
    else:
        extract = await fetch_area(req.lat, req.lon, radius_m, target_m=target_m)
        lap("fetch")
        graph = graph_cache.get_or_build(
            cache_key,
            lambda: build_graph(extract, allow_trail=allow_trail, sport=req.sport.value),
        )
        lap("graph")

    if not graph.edges:
        raise PlanningError(
            "Aucune voie praticable n'a été trouvée autour de ce point. "
            "Essaie un départ plus proche d'une zone habitée."
        )

    start = graph.nearest_node(req.lon, req.lat)
    if start is None:
        raise PlanningError(
            "Impossible de raccorder ce point de départ au réseau piéton "
            "(aucune voie à moins de 2 km)."
        )

    # Un départ sur un îlot du réseau ne peut produire aucune boucle. On teste
    # d'abord de façon bornée : si le voisinage immédiat est assez riche, il n'y
    # a pas d'îlot et on évite un parcours complet du graphe.
    probe = max(2_000, len(graph.nodes) // 20)
    if len(graph.local_component(start, probe)) < probe:
        component = graph.largest_component()
        if start not in component:
            relocated = graph.nearest_node(req.lon, req.lat, allowed=component)
            if relocated is None:
                raise PlanningError(
                    "Ce point de départ est sur une portion de réseau isolée, sans "
                    "liaison praticable vers le reste. Décale-toi de quelques rues."
                )
            moved = haversine_m(graph.nodes[relocated], graph.nodes[start])
            log.warning("départ isolé, raccroché au réseau principal à %.0f m", moved)
            start = relocated

    # --- profil -----------------------------------------------------------
    if req.time_of_day is TimeOfDay.auto:
        night = is_night(req.lat, req.lon, datetime.now(timezone.utc))
    else:
        night = req.time_of_day is TimeOfDay.night

    profile = build_profile(req.surface, req.safety, night, req.sport)

    # Le vent est demandé maintenant pour que l'appel réseau se déroule pendant
    # la génération, qui ne l'attend pas. Son absence est sans conséquence.
    wind_task = asyncio.ensure_future(current_wind(req.lat, req.lon))

    # --- génération -------------------------------------------------------
    raw = generate_loops(
        graph,
        start,
        target_m,
        profile,
        sectors=settings.sectors,
        max_candidates=settings.max_candidates,
        tolerance=req.tolerance,
    )
    log.info("%d candidats bruts", len(raw))
    lap("routing")

    # Deux natures de rejet, à ne pas mélanger. Les tracés hors fourchette sont
    # du déchet de génération : l'algorithme tâtonne sur la longueur, c'est son
    # travail, et l'utilisateur n'a pas à le voir. Les tracés écartés pour leur
    # forme ou leur sécurité, eux, sont la promesse du produit — ceux-là, on les
    # montre, avec le motif.
    lo = target_m * (1 - req.tolerance)
    hi = target_m * (1 + req.tolerance)

    # L'ordre compte, et il découle de la promesse du produit : **on préfère
    # changer la forme de la sortie plutôt que baisser l'exigence de sécurité.**
    # Une boucle plus courte parcourue deux fois qui tient le mode Sûr vaut
    # mieux qu'une boucle entière qui ne le tient pas — et l'inverse afficherait
    # « rien ne tient les seuils » au-dessus d'un itinéraire noté A.
    unique, rejected, off_target = _collect(
        raw, lo, hi, req.safety.value, req, graph, start, profile, target_m
    )

    relaxed = False
    if not unique and req.safety is SafetyMode.safe:
        # Ni boucle entière ni tour répété : là, et seulement là, on montre ce
        # qui existe en le disant.
        unique, _rejected, _off = _collect(
            raw, lo, hi, SafetyMode.standard.value, req, graph, start, profile, target_m
        )
        relaxed = bool(unique)
        if relaxed:
            log.info("mode Sûr sans solution : repli annoncé sur les seuils Standard")

    # On garde une réserve au-delà du nombre demandé : la note finale intègre le
    # dénivelé, inconnu à ce stade, et le choix diversifié a besoin de matière
    # pour écarter les quasi-doublons sans finir à court de propositions.
    shortlist = unique[: shortlist_size(req.limit)]

    # --- altitude ---------------------------------------------------------
    profiles: dict[int, tuple[list[float], list[ElevationPoint]]] = {}
    # Un point tous les 100 m convient à 10 km ; à 200 km, ça ferait 2 000
    # points et une vingtaine d'allers-retours réseau. On plafonne l'effort.
    sample_m = max(settings.elevation_sample_m, target_m / MAX_ELEVATION_SAMPLES)

    if req.with_elevation and shortlist:
        sampled = [
            [c for _idx, c in resample(cand.geometry, sample_m)] for cand in shortlist
        ]
        # Tous les tracés en un seul jeu de requêtes : voir `elevation.fetch_many`.
        fetched = await fetch_many(sampled)
        for i, (points, elevations) in enumerate(zip(sampled, fetched)):
            if elevations:
                elevations = smooth(elevations)
                profiles[i] = (
                    elevations,
                    _profile_points(shortlist[i], elevations, sample_m),
                )
    lap("elevation")

    # --- notation finale --------------------------------------------------
    wind = await wind_task
    scored: list[tuple[float, Candidate, int]] = []
    for i, cand in enumerate(shortlist):
        elev = profiles.get(i)
        gain = ascent_descent(elev[0])[0] if elev else None
        scored.append((final_score(cand, target_m, req, gain, wind), cand, i))

    scored.sort(key=lambda t: -t[0])
    chosen = select_varied(scored, req.limit)

    # Les consignes de navigation ne sont calculées que pour les itinéraires
    # réellement proposés : c'est un parcours d'arête à arête, inutile de le
    # payer pour des candidats écartés.
    names = name_routes([cand for _s, cand, _i in chosen])
    routes = [
        _to_model(
            cand, score, req, profiles.get(idx), rank,
            build_instructions(graph, start, cand), names[rank],
        )
        for rank, (score, cand, idx) in enumerate(chosen)
    ]

    meta = {
        "night": night,
        "graph_nodes": len(graph.nodes),
        "graph_edges": len(graph.edges),
        "raw_candidates": len(raw),
        "off_target": off_target,
        "graph_cache": graph_cache.stats,
        # Répartition complète des motifs de rejet. La liste détaillée est
        # tronquée pour l'affichage, mais le décompte, lui, dit la vérité sur
        # ce qui bloque — c'est ce qui permet de guider l'utilisateur.
        "rejected_by": dict(Counter(r.reason for r in rejected)),
        "relaxed": relaxed,
        "wind": (
            {"bearing": round(wind.bearing), "speed_kmh": round(wind.speed_kmh, 1)}
            if wind is not None and wind.matters
            else None
        ),
        "elapsed_s": round(time.perf_counter() - started, 2),
        "timings_s": timings,
        "lambda": profile.lam,
    }
    if relaxed:
        meta["message"] = (
            "Aucun itinéraire d'ici ne tient les seuils du mode Sûr : le réseau "
            "impose de longer la route. Voici ce qui existe malgré tout, avec le "
            "détail des portions exposées — à toi de juger."
        )
    elif not routes:
        meta["message"] = _no_result_message(req, rejected, off_target)

    return LoopResponse(routes=routes, rejected=rejected[:6], meta=meta)


def _collect(
    raw: list[Candidate],
    lo: float,
    hi: float,
    mode: str,
    req: LoopRequest,
    graph,
    start: int,
    profile,
    target_m: float,
) -> tuple[list[Candidate], list[Rejected], int]:
    """Tout ce qu'on peut proposer sous un mode de sécurité donné.

    D'abord les boucles entières, dédoublonnées. Puis, s'il en manque, des
    boucles plus courtes à parcourir plusieurs fois — à seuils **identiques**,
    jamais relâchés.
    """
    passed, rejected, off_target = _apply_gate(raw, lo, hi, mode, req.sport.value)
    passed.sort(key=lambda c: -preliminary_score(c, target_m, req.tolerance))

    unique: list[Candidate] = []
    for cand in passed:
        if any(similarity(cand, kept) > DUPLICATE_THRESHOLD for kept in unique):
            continue
        unique.append(cand)

    if len(unique) < req.limit:
        looped = _lap_options(
            graph, start, req, profile, target_m, mode, req.limit - len(unique)
        )
        if looped:
            log.info("boucles répétées proposées : %s tours", sorted({c.laps for c in looped}))
        unique.extend(looped)

    return unique, rejected, off_target


def _lap_options(
    graph,
    start: int,
    req: LoopRequest,
    profile,
    target_m: float,
    mode: str,
    needed: int,
) -> list[Candidate]:
    """Boucles plus courtes, à parcourir plusieurs fois pour faire la distance.

    Chaque tour est généré et validé **comme une boucle ordinaire** de sa propre
    longueur : mêmes seuils, même portail, même exigence de forme. Rien n'est
    relâché — c'est la distance qui est atteinte autrement.

    Le parcours répété est ensuite revalidé dans son ensemble, parce que répéter
    change deux choses réelles : on franchit chaque traversée à chaque tour, et
    si le départ tombe au milieu d'une portion exposée, les tours la mettent
    bout à bout.
    """
    out: list[Candidate] = []

    for laps in LAP_DIVISORS:
        if len(out) >= needed:
            break
        lap_target = target_m / laps
        if lap_target < MIN_LAP_M:
            break  # les divisions suivantes seront plus courtes encore

        raw = generate_loops(
            graph, start, lap_target, profile,
            sectors=settings.sectors,
            max_candidates=settings.max_candidates,
            tolerance=req.tolerance,
        )
        lo = lap_target * (1 - req.tolerance)
        hi = lap_target * (1 + req.tolerance)
        passed, _rejected, _off = _apply_gate(raw, lo, hi, mode, req.sport.value)
        passed.sort(key=lambda c: -preliminary_score(c, lap_target, req.tolerance))

        for cand in passed:
            if len(out) >= needed:
                break
            if any(similarity(cand, kept) > DUPLICATE_THRESHOLD for kept in out):
                continue
            repeated = repeat_loop(graph, start, cand, laps)
            # Le parcours complet doit tenir les mêmes seuils que n'importe quel
            # autre : on ne fait pas passer par la petite porte ce que le
            # portail refuserait à une boucle entière.
            if not run_gate(repeated.stats, mode, req.sport.value).passed:
                continue
            out.append(repeated)

    return out


def _apply_gate(
    raw: list[Candidate], lo: float, hi: float, mode: str, sport: str
) -> tuple[list[Candidate], list[Rejected], int]:
    """Filtre distance, forme et sécurité.

    Deux natures de rejet, à ne pas mélanger. Les tracés hors fourchette sont du
    déchet de génération : l'algorithme tâtonne sur la longueur, c'est son
    travail, et l'utilisateur n'a pas à le voir. Les tracés écartés pour leur
    forme ou leur sécurité, eux, sont la promesse du produit — ceux-là, on les
    montre, avec le motif.
    """
    passed: list[Candidate] = []
    rejected: list[Rejected] = []
    off_target = 0

    for cand in raw:
        stats = cand.stats
        assert stats is not None

        if not (lo <= stats.distance_m <= hi):
            off_target += 1
            continue

        if cand.roundness < MIN_ROUNDNESS:
            rejected.append(
                Rejected(
                    reason="shape",
                    label="aller-retour déguisé plutôt qu'une vraie boucle",
                    distance_m=round(stats.distance_m),
                )
            )
            continue

        gate = run_gate(stats, mode, sport)
        if not gate.passed:
            rejected.append(
                Rejected(
                    reason=gate.failures[0].code,
                    label=gate.first_label,
                    distance_m=round(stats.distance_m),
                )
            )
            continue

        passed.append(cand)

    return passed, rejected, off_target


# --- notation -------------------------------------------------------------


def preliminary_score(cand: Candidate, target_m: float, tolerance: float) -> float:
    s = cand.stats
    assert s is not None
    dist_error = abs(s.distance_m - target_m) / max(target_m * tolerance, 1.0)
    distance = max(0.0, 1.0 - dist_error)
    safety = (
        max(0.0, 1.0 - s.exposed_share / 0.05) * 0.45
        + s.protected_share * 0.30
        # Les traversées non protégées entraient dans la **note affichée** sans
        # entrer dans le classement : deux boucles d'exposition identique
        # obtenaient le même score, qu'elles coupent une départementale à
        # 80 km/h deux fois ou pas du tout. L'app mettait alors en tête une
        # boucle notée B devant des A — elle se contredisait elle-même, et
        # précisément là où ça compte, en périphérie et en zone rurale.
        + max(0.0, 1.0 - s.unprotected_crossings / CROSSINGS_REFERENCE) * 0.25
    )
    variety = 1.0 - min(1.0, s.overlap_share)
    # Une boucle bien ronde vaut mieux qu'un tracé étiré, à sécurité égale.
    shape = min(1.0, cand.roundness / GOOD_ROUNDNESS)
    return 0.32 * distance + 0.40 * safety + 0.10 * variety + 0.18 * shape


def grade_penalty(cand: Candidate) -> float:
    """Retrait dû à la note de sécurité — voir `GRADE_PENALTY`."""
    assert cand.stats is not None
    return GRADE_PENALTY * GRADE_RANK[grade_route(cand.stats)[0]]


def final_score(
    cand: Candidate,
    target_m: float,
    req: LoopRequest,
    ascent_m: float | None,
    wind: Wind | None = None,
) -> float:
    """Note définitive : agrément d'abord, puis les deux retraits qui priment.

    L'agrément — distance, sécurité fine, variété, forme, dénivelé — vit entre 0
    et 1. Les deux retraits, eux, sont dimensionnés pour dépasser tout ce que le
    tri diversifié peut accorder : ils ne se négocient pas contre une jolie
    direction. C'est ce qui garantit qu'une boucle notée A passe toujours devant
    une B, et qu'une boucle de montagne ne ressorte pas d'une demande de plat.
    """
    quality = preliminary_score(cand, target_m, req.tolerance)
    off_band = 0.0

    if ascent_m is not None:
        s = cand.stats
        assert s is not None
        per_km = ascent_m / max(s.distance_m / 1000.0, 0.1)
        target = ELEVATION_TARGET_PER_KM[req.elevation]
        elevation = 1.0 / (1.0 + abs(per_km - target) / ELEVATION_TOLERANCE_PER_KM)
        quality = 0.72 * quality + 0.28 * elevation

        low, high = ELEVATION_BAND_PER_KM[req.elevation]
        if not (low <= per_km <= high):
            off_band = OUT_OF_BAND_PENALTY

    if wind is not None and wind.matters:
        # Centré sur 0,5 : un retour vent de dos ajoute, un retour vent de face
        # retranche, et un vent de travers ne change rien.
        tail = tailwind_finish(cand.geometry, wind)
        quality += WIND_WEIGHT * wind.strength * (tail - 0.5) * 2.0

    return quality - grade_penalty(cand) - off_band - LAP_PENALTY * (cand.laps - 1)


def select_varied(
    scored: list[tuple[float, Candidate, int]], limit: int
) -> list[tuple[float, Candidate, int]]:
    """Choisit `limit` itinéraires en pesant la note **et** la variété.

    Prendre simplement les mieux notés ne marche pas : les meilleurs candidats
    se ressemblent, parce que ce qui fait une bonne note — les rues calmes, les
    parcs, les berges — se trouve toujours au même endroit. On obtenait
    plusieurs boucles partant du même côté, ce qui n'est pas un choix.

    À chaque tour, on retient donc le candidat dont la note **diminuée de ce
    qu'il partage avec les déjà retenus** est la plus haute. Le premier choisi
    est toujours le mieux noté : la variété ne coûte jamais la meilleure boucle,
    elle ne joue que sur les suivantes — et jamais au point de faire remonter
    une boucle moins sûre, dont le retrait de note dépasse ce qu'elle peut
    gagner en originalité.
    """
    remaining = list(scored)
    chosen: list[tuple[float, Candidate, int]] = []

    while remaining and len(chosen) < limit:
        best_index = 0
        best_value = float("-inf")
        for i, (score, cand, _idx) in enumerate(remaining):
            value = score - _variety_penalty(cand, chosen)
            if value > best_value:
                best_value, best_index = value, i
        chosen.append(remaining.pop(best_index))

    return chosen


def _variety_penalty(cand: Candidate, chosen: list[tuple[float, Candidate, int]]) -> float:
    if not chosen:
        return 0.0
    overlap = max(similarity(cand, kept) for _s, kept, _i in chosen)
    closest = min(
        abs((cand.bearing - kept.bearing + 180.0) % 360.0 - 180.0)
        for _s, kept, _i in chosen
    )
    crowding = max(0.0, 1.0 - closest / BEARING_SPREAD_DEG)
    return VARIETY_OVERLAP_WEIGHT * overlap + VARIETY_BEARING_WEIGHT * crowding


# --- conversion vers les modèles de réponse -------------------------------


def _profile_points(
    cand: Candidate, elevations: list[float], step: float
) -> list[ElevationPoint]:
    """Associe à chaque point échantillonné sa distance cumulée et sa surface."""
    spans: list[tuple[float, float, str]] = []
    cursor = 0.0
    for seg in cand.segments:
        spans.append((cursor, cursor + seg.length_m, seg.surface))
        cursor += seg.length_m

    out: list[ElevationPoint] = []
    span_idx = 0
    for i, ele in enumerate(elevations):
        dist = min(i * step, cursor)
        while span_idx < len(spans) - 1 and dist > spans[span_idx][1]:
            span_idx += 1
        surface = spans[span_idx][2] if spans else "unknown"
        out.append(ElevationPoint(dist_m=round(dist, 1), ele_m=round(ele, 1), surface=surface))
    return out


def _to_model(
    cand: Candidate,
    score: float,
    req: LoopRequest,
    elev: tuple[list[float], list[ElevationPoint]] | None,
    rank: int,
    steps: list,
    name: str,
) -> RouteCandidate:
    s = cand.stats
    assert s is not None

    grade, notes = grade_route(s)
    ascent = descent = None
    profile_points = None
    if elev:
        ascent, descent = ascent_descent(elev[0])
        profile_points = elev[1]

    surfaces = SurfaceReport()
    for seg in cand.segments:
        setattr(surfaces, f"{seg.surface}_m", getattr(surfaces, f"{seg.surface}_m") + seg.length_m)

    duration = int(s.distance_m / 1000.0 * req.seconds_per_km)

    return RouteCandidate(
        id=f"r{rank}-{int(s.distance_m)}",
        name=name,
        distance_m=round(s.distance_m, 1),
        duration_s=duration,
        ascent_m=ascent,
        descent_m=descent,
        geometry=[[round(lon, 6), round(lat, 6)] for lon, lat in cand.geometry],
        segments=[
            Segment(
                coords=[[round(lon, 6), round(lat, 6)] for lon, lat in seg.coords],
                length_m=round(seg.length_m, 1),
                risk=round(seg.risk, 3),
                level=seg.level,  # type: ignore[arg-type]
                separation=seg.separation,
                speed_kmh=seg.speed_kmh,
                surface=seg.surface,
                lit=seg.lit,
                road=seg.road,
                inferred=seg.inferred,
            )
            for seg in cand.segments
        ],
        crossings=[
            Crossing(
                lon=round(c.lon, 6),
                lat=round(c.lat, 6),
                protected=c.protected,
                speed_kmh=c.speed_kmh,
                kind=c.kind,
            )
            for c in cand.crossings
        ],
        elevation_profile=profile_points,
        instructions=[
            Instruction(
                dist_m=step.dist_m,
                turn=step.turn,
                angle=step.angle,
                road=step.road,
                text=step.text,
                lon=step.lon,
                lat=step.lat,
                caution=step.caution,
            )
            for step in steps
        ],
        safety=SafetyReport(
            grade=grade,  # type: ignore[arg-type]
            protected_share=round(s.protected_share, 4),
            exposed_m=round(s.exposed_m, 1),
            exposed_share=round(s.exposed_share, 4),
            longest_exposed_m=round(s.longest_exposed_m, 1),
            unprotected_crossings=s.unprotected_crossings,
            protected_crossings=s.protected_crossings,
            unlit_m=round(s.unlit_m, 1) if s.unlit_m is not None else None,
            inferred_share=round(s.inferred_share, 4),
            notes=notes,
        ),
        surfaces=surfaces,
        roundness=round(cand.roundness, 3),
        bearing=round(cand.bearing, 1),
        direction=_direction_of(cand.bearing),
        shape=cand.shape,
        laps=cand.laps,
        lap_distance_m=round(s.distance_m / cand.laps, 1),
        score=round(score, 4),
    )


def _direction_of(bearing: float) -> str:
    return CARDINALS[int((bearing + 22.5) % 360 // 45)]


def name_routes(cands: list[Candidate]) -> list[str]:
    """Nomme les propositions **ensemble**, pour qu'elles se distinguent.

    Nommer chaque boucle par sa voie la plus longue paraît naturel, mais ça
    échoue précisément quand on en propose beaucoup : les boucles d'un même
    quartier partagent leur artère principale, et l'écran affiche « Boucle
    nord-ouest · avenue de la Gare » quatre fois. Le nom cesse alors d'aider à
    choisir, qui est sa seule fonction.

    On choisit donc, pour chaque boucle, la voie qui lui est la plus **propre** :
    longue chez elle, absente ou marginale chez les autres. Une avenue partagée
    par toutes perd contre une petite rue qu'une seule emprunte, parce que c'est
    la seconde qui dit ce qui change d'une proposition à l'autre.

    Le traitement est séquentiel : chaque boucle nommée retire ses voies du
    vivier des suivantes, si bien que deux boucles ne peuvent pas hériter du
    même nom même lorsqu'elles se ressemblent.
    """
    per_route = [_road_lengths(c) for c in cands]
    total: Counter[str] = Counter()
    for lengths in per_route:
        total.update(lengths)

    used: set[str] = set()
    names: list[str] = []

    for cand, lengths in zip(cands, per_route):
        direction = _direction_of(cand.bearing)
        road = _most_distinctive(lengths, total, used)
        if road is None:
            names.append(f"Boucle {direction}")
            continue
        used.add(road)
        names.append(f"Boucle {direction} · {road}")

    return names


def _road_lengths(cand: Candidate) -> Counter[str]:
    lengths: Counter[str] = Counter()
    for seg in cand.segments:
        if seg.road:
            lengths[seg.road] += seg.length_m
    return lengths


def _most_distinctive(
    lengths: Counter[str], total: Counter[str], used: set[str]
) -> str | None:
    """Voie la plus caractéristique d'une boucle, parmi celles encore libres.

    Le critère se lit en une phrase : **ce que j'en ai de plus que tous les
    autres réunis**, soit `2 × chez_moi − partout`. Une voie que je suis seul à
    emprunter vaut toute sa longueur ; une artère partagée à parts égales vaut
    zéro, quelle que soit sa longueur.

    Pondérer simplement la longueur par un taux d'exclusivité ne suffisait pas :
    une avenue de trois kilomètres partagée par deux boucles y battait encore
    une rue de huit cents mètres qu'une seule empruntait — et les deux boucles
    ressortaient sous le même nom, ce que la fonction existe justement pour
    éviter.
    """
    best: str | None = None
    best_score = 0.0
    for road, mine in lengths.items():
        if road in used:
            continue
        score = 2 * mine - total[road]
        if score > best_score:
            best_score, best = score, road

    # Toutes les voies de cette boucle portent déjà le nom d'une autre : on
    # reprend la plus longue, le suffixe de direction fera la différence.
    if best is None and lengths:
        best = lengths.most_common(1)[0][0]
    return best


def _no_result_message(
    req: LoopRequest, rejected: list[Rejected], off_target: int
) -> str:
    reasons = Counter(r.reason for r in rejected)

    if not reasons:
        if off_target:
            return (
                "Aucune boucle ne tombe dans la fourchette de distance depuis ce "
                "point. Vise une distance un peu différente, ou élargis la tolérance."
            )
        return (
            "Aucune boucle n'a pu être tracée depuis ce point. Le réseau piéton y "
            "est peut-être trop peu maillé pour cette distance."
        )

    top = reasons.most_common(1)[0][0]
    if top == "shape":
        return (
            "Les seuls trajets possibles à cette distance sont des allers-retours, "
            "pas des boucles. Essaie une autre distance ou un départ plus central."
        )
    if top == "crossings":
        return (
            "Toutes les boucles à cette distance traversent trop de routes rapides "
            "sans passage protégé. Une distance plus courte reste souvent dans le "
            "bourg ; le mode Standard, lui, te les montrera avec le détail."
        )
    if req.safety is SafetyMode.safe:
        return (
            "Tous les itinéraires possibles depuis ce point passent trop longtemps "
            "au contact du trafic pour le mode Sûr. Le mode Standard te montrera "
            "ce qui existe, avec le détail des zones exposées."
        )
    return (
        "Aucun itinéraire ne satisfait les critères. Essaie une autre distance ou "
        "un autre point de départ."
    )
