"""Le vent, et pourquoi il décide de l'orientation d'une boucle.

Finir une sortie de dix kilomètres face au vent est la façon la plus sûre de
gâcher les deux derniers. C'est un désagrément que tout le monde connaît, que
personne ne peut anticiper sans carte, et qu'une boucle — contrairement à un
aller-retour — permet d'éviter **gratuitement** : le tracé passe de toute façon
par tous les points cardinaux, il suffit de choisir dans quel ordre.

D'où ce module. Il ne cherche pas à modéliser quoi que ce soit : il demande la
direction du vent au point de départ, et la notation finale préfère, à qualité
égale, la boucle dont le **dernier tiers** se court vent dans le dos.

Trois précautions :

**Il échoue en silence.** Aucune clé, aucun compte, mais un service de plus qui
peut être lent ou absent. Sans réponse, le terme de vent vaut zéro et le reste
de la notation est inchangé — on ne fait pas dépendre une recherche
d'itinéraire de la météo.

**Il ne fait rien sous 12 km/h.** En dessous, le vent ne se sent pas en courant,
et l'orientation de la boucle doit rester décidée par la sécurité et le terrain.

**Il est mis en cache par heure et par zone.** Le vent ne change pas d'une
minute à l'autre, et deux recherches successives au même endroit ne doivent pas
interroger deux fois un service public gratuit.
"""

from __future__ import annotations

import logging
import math
import time
from dataclasses import dataclass

import httpx

from .config import settings

log = logging.getLogger(__name__)

OPEN_METEO_URL = "https://api.open-meteo.com/v1/forecast"

# En dessous, le vent ne se sent pas assez pour valoir un détour.
MIN_SPEED_KMH = 12.0

# Vitesse à laquelle le terme de vent est au maximum. Au-delà de 35 km/h, un
# vent est un vent : inutile de continuer à graduer.
FULL_SPEED_KMH = 35.0

# Durée de vie du cache, et finesse de la zone. Un dixième de degré fait onze
# kilomètres : à cette échelle, le vent est le même.
CACHE_TTL_S = 3600.0
CACHE_CELL_DEG = 0.1


@dataclass(frozen=True)
class Wind:
    """`bearing` est la direction vers laquelle le vent **souffle**."""

    bearing: float
    speed_kmh: float

    @property
    def matters(self) -> bool:
        return self.speed_kmh >= MIN_SPEED_KMH

    @property
    def strength(self) -> float:
        """0 sous le seuil, 1 à pleine force — le poids donné au terme de vent."""
        if not self.matters:
            return 0.0
        span = FULL_SPEED_KMH - MIN_SPEED_KMH
        return min(1.0, (self.speed_kmh - MIN_SPEED_KMH) / span)


_cache: dict[tuple[int, int], tuple[float, Wind | None]] = {}


async def current_wind(lat: float, lon: float) -> Wind | None:
    """Vent au point donné, ou None si le service ne répond pas."""
    cell = (round(lat / CACHE_CELL_DEG), round(lon / CACHE_CELL_DEG))
    hit = _cache.get(cell)
    if hit is not None and time.monotonic() - hit[0] < CACHE_TTL_S:
        return hit[1]

    wind = await _fetch(lat, lon)
    _cache[cell] = (time.monotonic(), wind)
    # Le cache ne peut pas grandir indéfiniment dans un serveur qui tourne des
    # semaines : au-delà de quelques centaines de zones, on repart à zéro.
    if len(_cache) > 400:
        _cache.clear()
    return wind


async def _fetch(lat: float, lon: float) -> Wind | None:
    params = {
        "latitude": f"{lat:.4f}",
        "longitude": f"{lon:.4f}",
        "current": "wind_speed_10m,wind_direction_10m",
        "wind_speed_unit": "kmh",
    }
    try:
        async with httpx.AsyncClient(
            timeout=httpx.Timeout(6.0, connect=4.0),
            headers={"User-Agent": settings.user_agent},
        ) as client:
            response = await client.get(OPEN_METEO_URL, params=params)
            response.raise_for_status()
            current = response.json().get("current") or {}
        speed = float(current["wind_speed_10m"])
        # Le service donne la direction d'où vient le vent ; ce qui nous
        # intéresse est celle vers laquelle il pousse.
        blowing_towards = (float(current["wind_direction_10m"]) + 180.0) % 360.0
    except Exception as exc:  # noqa: BLE001 — la météo est un bonus, jamais un socle
        log.info("vent indisponible : %s", exc)
        return None

    return Wind(bearing=blowing_towards, speed_kmh=speed)


def tailwind_finish(geometry: list[tuple[float, float]], wind: Wind | None) -> float:
    """Part de la fin de boucle courue vent dans le dos, entre 0 et 1.

    On ne regarde que le **dernier tiers** : c'est là que le vent de face se
    paie, et c'est la seule portion qu'on cherche à orienter. Le reste de la
    boucle traversera le vent de toute façon — une boucle fermée y est
    contrainte par géométrie.

    Rend 0,5 — donc neutre — quand le vent est absent, faible ou inconnu, pour
    que le terme ne pousse ni ne pénalise personne.
    """
    if wind is None or not wind.matters or len(geometry) < 8:
        return 0.5

    start = int(len(geometry) * 2 / 3)
    aligned = 0.0
    total = 0.0

    for i in range(start, len(geometry) - 1):
        a, b = geometry[i], geometry[i + 1]
        # Projection locale : à cette échelle, un degré de longitude est plus
        # court qu'un degré de latitude, et l'ignorer fausserait chaque cap.
        dx = (b[0] - a[0]) * math.cos(math.radians(a[1]))
        dy = b[1] - a[1]
        length = math.hypot(dx, dy)
        if length == 0:
            continue
        heading = math.degrees(math.atan2(dx, dy)) % 360.0
        delta = abs((heading - wind.bearing + 180.0) % 360.0 - 180.0)
        # 1 vent dans le dos, 0 vent de face, 0,5 vent de travers.
        aligned += length * (1.0 - delta / 180.0)
        total += length

    return aligned / total if total else 0.5
