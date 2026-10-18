"""Orchestration : de la requête utilisateur aux itinéraires notés.

Enchaînement complet :

    Overpass → graphe (L0/L1/L2) → relief de la zone → génération →
    filtre distance → portail L3 → dédoublonnage → altitude → notation → réponse

Le relief de la zone est une grille grossière, en une requête : il oriente la
génération. L'altitude fine, tous les 50 m, n'est demandée qu'aux candidats
survivants : c'est un appel réseau externe, on ne le paie pas pour des tracés
qu'on va jeter.
"""

from __future__ import annotations

import logging
import math
import time
from collections import Counter
from datetime import datetime, timezone

import asyncio

from .config import settings
from .elevation import Terrain, ascent_descent, fetch_many, shape_relief
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
from .routing.loops import Candidate, figure_eight, generate_loops, repeat_loop, similarity
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
#
# Le retrait grandit avec l'écart : `OUT_OF_BAND_STEP` de plus par tranche de
# `ELEVATION_TOLERANCE_PER_KM` au-delà de la fourchette. Fixe, il frappait
# pareil 120 et 380 m de D+ sur 9 km, et la variété les départageait : à
# Guebwiller, une demande de plat proposait 290 m en tête, devant 120 m, au seul
# motif d'une autre direction.
#
# Face à la note de sécurité, la fourchette passe d'abord, **de deux crans** :
# une C plate passe devant une A de montagne. Le retrait valait 0,8, moins qu'un
# seul cran (0,9) : une B plate doublait tout juste une A vallonnée, une C
# jamais, et qui demandait du plat en mode Standard recevait des boucles de
# coteau mieux notées. « Je veux du plat » est un réglage, et la C a passé le
# portail du mode choisi — le mode Sûr, lui, ne la laisse jamais entrer. Dans
# la fourchette, la note reprend la main (0,9 par cran). Hors fourchette aussi,
# à peu de chose près : une tranche d'écart (0,8) pèse un peu moins qu'un cran.
OUT_OF_BAND_PENALTY = 2.0
OUT_OF_BAND_STEP = 0.8

# La même règle pour le terrain : la part du tracé hors bitume — chemins
# stabilisés et sentiers. Le réglage Route / Mixte / Sentier ne jouait que sur
# le coût des rues au tracé, et pas du tout au classement : une demande de
# sentier sortait des boucles toutes goudronnées dès qu'elles étaient mieux
# notées, et « Mixte » réglé par défaut ne se distinguait en rien de « Route ».
#
# « Mixte » veut un mélange : une boucle entièrement goudronnée n'en est pas
# un. En ville, où aucune n'a de chemin, toutes paient le même retrait, et la
# note décide comme avant.
SURFACE_BAND = {
    SurfacePref.road: (0.0, 0.10),
    SurfacePref.mixed: (0.15, 0.85),
    SurfacePref.trail: (0.50, 1.0),
}
# Une tranche d'écart à la fourchette de terrain : quinze points de part.
SURFACE_STEP = 0.15
UNPAVED = ("gravel", "trail")


def _climb_fit(pref: ElevationPref):
    """Ce que vaut un polygone selon ce qu'il montera au moins, en m/km —
    plus bas, mieux c'est. Voir `generate_loops`.

    En plat, le moins possible. Sinon, l'écart à la cible, par tranches de
    `ELEVATION_TOLERANCE_PER_KM` : en terrain plat tous les polygones tombent
    dans la même tranche, et la génération reste celle d'avant — vérifié à
    Colmar, où la recherche par défaut rend exactement les mêmes boucles.
    """
    if pref is ElevationPref.flat:
        return lambda per_km: per_km
    target = ELEVATION_TARGET_PER_KM[pref]
    return lambda per_km: float(math.floor(abs(per_km - target) / ELEVATION_TOLERANCE_PER_KM))

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

# Écart de cap minimal entre les deux boucles d'un « 8 » (`figure_eight`) : de
# deux côtés vraiment différents du départ, le nord puis le sud, pas deux
# variantes du même quartier. Mesuré sur 96 recherches autour de Soultz et de
# Guebwiller : 22 des 59 « 2 × la même boucle » trouvaient ainsi leur
# partenaire, sans une note de moins.
EIGHT_MIN_GAP_DEG = 90.0

# Retrait par tour supplémentaire : deux tours valent mieux que quatre. Il ne
# départage plus que les tours entre eux. Une boucle entière passe toujours
# devant (`select_varied`) : petit devant un cran de note (0,9) et devant le
# retrait des réglages, il laissait un « 2 × 4,5 km » noté A doubler des
# boucles entières notées B ou à peine trop vallonnées — depuis la rue des
# Primevères, à Soultz, douze propositions de 9 km en mettaient cinq en tours
# en tête de liste. Les tours ne se proposent que faute de mieux.
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

# Poids du crochet en U dans le classement — voir `preliminary_score` et
# `geo.backtrack_share`.
BACKTRACK_WEIGHT = 1.6

# Plafond de points d'altitude par itinéraire, quelle que soit sa longueur :
# le pas de 50 m tient jusqu'à 30 km, puis s'allonge.
MAX_ELEVATION_SAMPLES = 600

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

    # Le relief de la zone, pour tracer vers le terrain demandé — voir
    # `elevation.Terrain`. Sans réponse, on trace comme avant, sans lui.
    terrain: Terrain | None = None
    if req.with_elevation:
        grid = Terrain(req.lat, req.lon, radius_m)
        relief = (await fetch_many([grid.points()]))[0]
        if relief is not None:
            grid.values = relief.values
            terrain = grid
    climb_fit = _climb_fit(req.elevation)

    profile = build_profile(
        req.surface, req.safety, night, req.sport,
        terrain=terrain if req.elevation is ElevationPref.flat else None,
    )

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
        terrain=terrain,
        climb_fit=climb_fit,
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
    unique, rejected, off_target, spurned = _collect(
        raw, lo, hi, req.safety.value, req, graph, start, profile, target_m, terrain
    )

    relaxed = False
    salvaged: str | None = None
    if not unique and req.safety is SafetyMode.safe:
        # Ni boucle entière ni tour répété : là, et seulement là, on montre ce
        # qui existe en le disant.
        unique, _rejected, _off, _spurned = _collect(
            raw, lo, hi, SafetyMode.standard.value, req, graph, start, profile, target_m, terrain
        )
        relaxed = bool(unique)
        if relaxed:
            log.info("mode Sûr sans solution : repli annoncé sur les seuils Standard")

    # Rien ne passe les seuils, mais des trajets existent : c'est le cas d'un
    # village, dont les seules routes longent le trafic ou ne se referment pas.
    # Mesuré à Bligny-lès-Beaune, 200 habitants : six candidats, tous écartés, et
    # un écran vide devant quelqu'un en tenue. On propose donc les meilleurs en
    # disant franchement ce qui cloche — c'est à la personne de juger.
    if not unique and spurned:
        spurned.sort(key=lambda c: -preliminary_score(c, target_m, req.tolerance))
        gardes: list[Candidate] = []
        for cand in spurned:
            if any(similarity(cand, kept) > DUPLICATE_THRESHOLD for kept in gardes):
                continue
            gardes.append(cand)
            if len(gardes) >= req.limit:
                break
        if gardes:
            unique = gardes
            salvaged = Counter(r.reason for r in rejected).most_common(1)[0][0]
            log.info("aucun itinéraire aux seuils : %s repêchés (%s)", len(gardes), salvaged)

    # On garde une réserve au-delà du nombre demandé : la note finale intègre le
    # dénivelé, inconnu à ce stade, et le choix diversifié a besoin de matière
    # pour écarter les quasi-doublons sans finir à court de propositions.
    #
    # La réserve se choisit d'abord sur les réglages : seule elle reçoit son
    # altitude, et une boucle plate écartée ici ne pouvait plus jamais sortir,
    # quel que soit son dénivelé réel. Le relief de la zone en donne une
    # estimation — voir `_shortlist_key`.
    unique.sort(key=lambda c: -_shortlist_key(c, target_m, req, terrain))
    shortlist = unique[: shortlist_size(req.limit)]

    # --- altitude ---------------------------------------------------------
    profiles: dict[int, tuple[list[float], list[ElevationPoint]]] = {}
    # Un point tous les 50 m convient jusqu'à 30 km ; à 200 km, ça ferait
    # 4 000 points par boucle. On plafonne l'effort.
    sample_m = max(settings.elevation_sample_m, target_m / MAX_ELEVATION_SAMPLES)

    if req.with_elevation and shortlist:
        sampled = [
            [c for _idx, c in resample(cand.geometry, sample_m)] for cand in shortlist
        ]
        # Tous les tracés en un seul jeu de requêtes : voir `elevation.fetch_many`.
        fetched = await fetch_many(sampled)
        for i, (points, relief) in enumerate(zip(sampled, fetched)):
            if relief and relief.values:
                # Lissage et seuil voyagent avec le profil : c'est la source qui
                # les fixe — voir `elevation.shape_relief`.
                elevations, threshold = shape_relief(relief, sample_m)
                profiles[i] = (
                    elevations,
                    _profile_points(shortlist[i], elevations, sample_m),
                    threshold,
                )
    lap("elevation")

    # --- notation finale --------------------------------------------------
    wind = await wind_task
    scored: list[tuple[float, Candidate, int]] = []
    for i, cand in enumerate(shortlist):
        elev = profiles.get(i)
        gain = ascent_descent(elev[0], elev[2])[0] if elev else None
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
            build_instructions(graph, start, cand), names[rank], graph,
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
    if salvaged:
        meta["relaxed"] = True
        meta["salvaged"] = salvaged
        meta["message"] = _SALVAGED_MESSAGE.get(salvaged, _SALVAGED_MESSAGE["default"])
    elif relaxed:
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
    terrain: Terrain | None = None,
) -> tuple[list[Candidate], list[Rejected], int, list[Candidate]]:
    """Tout ce qu'on peut proposer sous un mode de sécurité donné.

    D'abord les boucles entières, dédoublonnées. Puis, s'il en manque, des
    boucles plus courtes à parcourir plusieurs fois — à seuils **identiques**,
    jamais relâchés.
    """
    passed, rejected, off_target, spurned = _apply_gate(raw, lo, hi, mode, req.sport.value)
    passed.sort(key=lambda c: -preliminary_score(c, target_m, req.tolerance))

    unique: list[Candidate] = []
    for cand in passed:
        if any(similarity(cand, kept) > DUPLICATE_THRESHOLD for kept in unique):
            continue
        unique.append(cand)

    if len(unique) < req.limit:
        looped = _lap_options(
            graph, start, req, profile, target_m, mode, req.limit - len(unique), terrain
        )
        if looped:
            log.info("boucles répétées proposées : %s tours", sorted({c.laps for c in looped}))
        unique.extend(looped)

    return unique, rejected, off_target, spurned


def _lap_options(
    graph,
    start: int,
    req: LoopRequest,
    profile,
    target_m: float,
    mode: str,
    needed: int,
    terrain: Terrain | None = None,
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
            terrain=terrain,
            climb_fit=_climb_fit(req.elevation),
        )
        lo = lap_target * (1 - req.tolerance)
        hi = lap_target * (1 + req.tolerance)
        passed, _rejected, _off, _spurned = _apply_gate(raw, lo, hi, mode, req.sport.value)
        passed.sort(key=lambda c: -preliminary_score(c, lap_target, req.tolerance))

        if laps == 2:
            out.extend(_figure_eights(graph, start, passed, mode, req, needed - len(out)))

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


def _figure_eights(
    graph, start: int, passed: list[Candidate], mode: str, req: LoopRequest, needed: int
) -> list[Candidate]:
    """Des « 8 » plutôt que deux fois la même boucle — voir `figure_eight`.

    Chaque boucle, dans l'ordre de la note, cherche sa partenaire parmi les
    autres : assez différente pour ne pas être un quasi-doublon, partie d'un
    autre côté (`EIGHT_MIN_GAP_DEG`). Une boucle ne sert qu'à un seul 8, ni
    elle ni ses quasi-doublons : deux 8 qui partagent une boucle partageraient
    la moitié de la sortie. Sur le damier de la parité, trois 8 sortaient à
    l'identique — même longueur, même direction — faute de cette règle. Et le
    8 passe le portail en entier, comme une boucle répétée.
    """
    out: list[Candidate] = []
    lobes: list[Candidate] = []

    def fresh(cand: Candidate) -> bool:
        return all(similarity(cand, lobe) <= DUPLICATE_THRESHOLD for lobe in lobes)

    for first in passed:
        if len(out) >= needed:
            break
        if not fresh(first):
            continue
        for second in passed:
            if second is first or not fresh(second):
                continue
            gap = abs((first.bearing - second.bearing + 180.0) % 360.0 - 180.0)
            if gap < EIGHT_MIN_GAP_DEG or similarity(first, second) > DUPLICATE_THRESHOLD:
                continue
            eight = figure_eight(graph, start, first, second)
            if not run_gate(eight.stats, mode, req.sport.value).passed:
                continue
            lobes.extend((first, second))
            out.append(eight)
            break
    return out


# Ce qu'on dit quand on repêche : la vérité, et ce qu'elle laisse comme choix.
# Rangé sous les codes de refus de `run_gate`, pas sous les noms des mesures :
# rangés sous `longest_exposed_m` et `unprotected_crossings`, deux de ces
# messages n'étaient jamais trouvés, et l'on retombait sur le message général.
_SALVAGED_MESSAGE = {
    "shape": (
        "Il n'y a pas de vraie boucle d'ici à cette distance — le réseau n'en offre pas. "
        "Voici les meilleurs trajets possibles : ils reviennent en partie par le même chemin."
    ),
    "exposed_share": (
        "Tout ce qui part d'ici longe la route plus que les seuils ne l'autorisent. Voici les "
        "moins exposés, avec le détail des portions concernées — à toi de juger."
    ),
    "longest_exposed": (
        "Chaque trajet d'ici comporte une longue portion au contact du trafic. Voici les plus "
        "courtes, avec le détail — à toi de juger."
    ),
    "crossings": (
        "Les trajets d'ici traversent des routes sans passage protégé. Voici ceux qui en "
        "comptent le moins, avec le détail — à toi de juger."
    ),
    "default": (
        "Aucun itinéraire d'ici ne tient les seuils. Voici ce qui existe malgré tout, avec le "
        "détail de ce qui cloche — à toi de juger."
    ),
}


def _apply_gate(
    raw: list[Candidate], lo: float, hi: float, mode: str, sport: str
) -> tuple[list[Candidate], list[Rejected], int, list[Candidate]]:
    """Filtre distance, forme et sécurité.

    Deux natures de rejet, à ne pas mélanger. Les tracés hors fourchette sont du
    déchet de génération : l'algorithme tâtonne sur la longueur, c'est son
    travail, et l'utilisateur n'a pas à le voir. Les tracés écartés pour leur
    forme ou leur sécurité, eux, sont la promesse du produit — ceux-là, on les
    montre, avec le motif.
    """
    passed: list[Candidate] = []
    rejected: list[Rejected] = []
    # Les candidats écartés, gardés à part : dans un village, ce sont parfois les
    # seuls trajets qui existent, et `plan_loops` les repêche plutôt que de
    # rendre un écran vide.
    spurned: list[Candidate] = []
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
            spurned.append(cand)
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
            spurned.append(cand)
            continue

        passed.append(cand)

    return passed, rejected, off_target, spurned


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
    # Le crochet en U coûte ce que coûterait d'être loin de la distance visée :
    # un dixième du tracé en crochet pèse comme 5 % d'écart sur la distance.
    # Assez pour qu'une boucle sans détour passe devant ; trop peu pour qu'elle
    # passe devant une boucle plus sûre — la note pèse 0,9 par cran.
    return (
        0.32 * distance + 0.40 * safety + 0.10 * variety + 0.18 * shape
        - BACKTRACK_WEIGHT * cand.backtrack
    )


def grade_penalty(cand: Candidate) -> float:
    """Retrait dû à la note de sécurité — voir `GRADE_PENALTY`."""
    assert cand.stats is not None
    return GRADE_PENALTY * GRADE_RANK[grade_route(cand.stats)[0]]


def unpaved_share(cand: Candidate) -> float | None:
    """Part du tracé hors bitume, ou `None` pour un tracé sans segments."""
    total = sum(seg.length_m for seg in cand.segments)
    if total <= 0.0:
        return None
    return sum(seg.length_m for seg in cand.segments if seg.surface in UNPAVED) / total


def _band_penalty(value: float, band: tuple[float, float], step: float) -> float:
    """Le retrait d'une mesure hors de sa fourchette — voir `OUT_OF_BAND_PENALTY`."""
    low, high = band
    gap = max(low - value, value - high, 0.0)
    if gap <= 0.0:
        return 0.0
    return OUT_OF_BAND_PENALTY + OUT_OF_BAND_STEP * gap / step


def preference_penalty(cand: Candidate, req: LoopRequest, per_km: float | None) -> float:
    """Ce que coûte de ne pas tenir les réglages : dénivelé, puis terrain.

    `per_km` : le D+ par kilomètre, mesuré ou estimé ; `None` quand on ne le
    connaît pas, et le dénivelé ne pénalise alors rien.
    """
    off = 0.0
    if per_km is not None:
        off += _band_penalty(per_km, ELEVATION_BAND_PER_KM[req.elevation], ELEVATION_TOLERANCE_PER_KM)
    share = unpaved_share(cand)
    if share is not None:
        off += _band_penalty(share, SURFACE_BAND[req.surface], SURFACE_STEP)
    return off


def _shortlist_key(cand: Candidate, target_m: float, req: LoopRequest, terrain: Terrain | None) -> float:
    """Le score d'avant l'altitude, réglages compris.

    Le D+ s'estime sur le relief de la zone, la moitié de ce que la boucle
    monte et descend. La grille d'environ 220 m arrondit les côtes courtes :
    l'estimation sous-évalue, mais elle range les boucles dans le bon ordre, et
    c'est tout ce qu'on lui demande — la note finale se fait sur l'altitude fine.
    """
    assert cand.stats is not None
    per_km = None
    if terrain is not None:
        per_km = terrain.climb(cand.geometry) / 2.0 / max(cand.stats.distance_m / 1000.0, 0.1)
    return preliminary_score(cand, target_m, req.tolerance) - preference_penalty(cand, req, per_km)


def final_score(
    cand: Candidate,
    target_m: float,
    req: LoopRequest,
    ascent_m: float | None,
    wind: Wind | None = None,
) -> float:
    """Note définitive : agrément d'abord, puis les retraits qui priment.

    L'agrément — distance, sécurité fine, variété, forme, dénivelé — vit entre 0
    et 1. Les retraits, eux, sont dimensionnés pour dépasser tout ce que le tri
    diversifié peut accorder : ils ne se négocient pas contre une jolie
    direction. Les réglages passent d'abord — une boucle de montagne ne ressort
    pas d'une demande de plat, ni une boucle goudronnée d'une demande de
    sentier —, puis la note : à réglages tenus, une A passe devant une B.
    """
    quality = preliminary_score(cand, target_m, req.tolerance)
    per_km: float | None = None

    if ascent_m is not None:
        s = cand.stats
        assert s is not None
        per_km = ascent_m / max(s.distance_m / 1000.0, 0.1)
        target = ELEVATION_TARGET_PER_KM[req.elevation]
        elevation = 1.0 / (1.0 + abs(per_km - target) / ELEVATION_TOLERANCE_PER_KM)
        quality = 0.72 * quality + 0.28 * elevation

    if wind is not None and wind.matters:
        # Centré sur 0,5 : un retour vent de dos ajoute, un retour vent de face
        # retranche, et un vent de travers ne change rien.
        tail = tailwind_finish(cand.geometry, wind)
        quality += WIND_WEIGHT * wind.strength * (tail - 0.5) * 2.0

    return (
        quality - grade_penalty(cand) - preference_penalty(cand, req, per_km)
        - LAP_PENALTY * (cand.laps - 1)
    )


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
        best_key: tuple[bool, float] = (False, float("-inf"))
        for i, (score, cand, _idx) in enumerate(remaining):
            # Les boucles entières d'abord, toutes : les tours ne font que
            # compléter la liste — voir `LAP_PENALTY`.
            key = (cand.laps == 1, score - _variety_penalty(cand, chosen))
            if key > best_key:
                best_key, best_index = key, i
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
    graph,
) -> RouteCandidate:
    s = cand.stats
    assert s is not None

    grade, notes = grade_route(s)
    ascent = descent = None
    profile_points = None
    if elev:
        ascent, descent = ascent_descent(elev[0], elev[2])
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
        lap_distances_m=_lap_distances(graph, cand),
        figure_eight=bool(cand.lap_breaks),
        score=round(score, 4),
    )


def _lap_distances(graph, cand: Candidate) -> list[float]:
    """La longueur de chaque tour : égales pour une boucle répétée, chacune la
    sienne pour un « 8 »."""
    if not cand.lap_breaks:
        return [round(cand.stats.distance_m / cand.laps, 1)] * cand.laps
    bounds = [0, *cand.lap_breaks, len(cand.edges)]
    return [
        round(sum(graph.edges[e].length_m for e in cand.edges[a:b]), 1)
        for a, b in zip(bounds, bounds[1:])
    ]


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
