"""Recherche de lieu, via Nominatim (OpenStreetMap).

L'appel passe par le backend plutôt que par le navigateur : la charte d'usage de
Nominatim impose un agent identifiable et une requête par seconde, deux choses
qu'on ne peut pas garantir depuis un client. Le cache évite d'ailleurs de les
solliciter deux fois pour la même saisie.
"""

from __future__ import annotations

import asyncio
import logging
import time
from collections import OrderedDict
from typing import Any

import httpx

from .config import settings

log = logging.getLogger(__name__)

NOMINATIM_URL = "https://nominatim.openstreetmap.org/search"
REVERSE_URL = "https://nominatim.openstreetmap.org/reverse"

_lock = asyncio.Lock()
_last_call = 0.0

# Cache borné : un serveur qui tourne des semaines finirait sinon par garder
# toutes les saisies jamais tapées, y compris les frappes intermédiaires — la
# recherche envoie une requête à chaque lettre. Les plus anciennes sortent.
_CACHE_MAX = 500
_cache: "OrderedDict[str, list[dict[str, Any]]]" = OrderedDict()


async def _throttled_get(url: str, params: dict[str, Any]) -> Any:
    """Une requête par seconde au maximum, tous appelants confondus."""
    global _last_call
    async with _lock:
        wait = 1.05 - (time.monotonic() - _last_call)
        if wait > 0:
            await asyncio.sleep(wait)
        headers = {"User-Agent": settings.user_agent, "Accept-Language": "fr"}
        async with httpx.AsyncClient(timeout=15.0, headers=headers) as client:
            response = await client.get(url, params=params)
            response.raise_for_status()
            _last_call = time.monotonic()
            return response.json()


async def search(query: str, limit: int = 5) -> list[dict[str, Any]]:
    """Adresses correspondant à une saisie libre."""
    key = query.strip().lower()
    if not key:
        return []
    cached = _cache.get(key)
    if cached is not None:
        _cache.move_to_end(key)
        return cached

    try:
        raw = await _throttled_get(
            NOMINATIM_URL,
            {"q": query, "format": "jsonv2", "limit": limit, "addressdetails": 1},
        )
    except Exception as exc:  # noqa: BLE001 — la recherche est un confort, pas un socle
        log.warning("recherche de lieu indisponible : %s", exc)
        return []

    results = [
        {
            "label": item.get("display_name", ""),
            "short": _short_label(item),
            "lat": float(item["lat"]),
            "lon": float(item["lon"]),
        }
        for item in raw
        if item.get("lat") and item.get("lon")
    ]
    _cache[key] = results
    _cache.move_to_end(key)
    while len(_cache) > _CACHE_MAX:
        _cache.popitem(last=False)
    return results


async def reverse(lat: float, lon: float) -> str | None:
    """Nom lisible d'un point — pour afficher « Départ : rue des Lilas »."""
    try:
        raw = await _throttled_get(
            REVERSE_URL, {"lat": lat, "lon": lon, "format": "jsonv2", "zoom": 16}
        )
    except Exception as exc:  # noqa: BLE001
        log.warning("géocodage inverse indisponible : %s", exc)
        return None
    return _short_label(raw) if raw else None


def _short_label(item: dict[str, Any]) -> str:
    """« Rue de Rivoli, Paris » plutôt que l'adresse administrative complète."""
    address = item.get("address") or {}
    street = (
        address.get("road")
        or address.get("pedestrian")
        or address.get("footway")
        or item.get("name")
    )
    city = (
        address.get("city")
        or address.get("town")
        or address.get("village")
        or address.get("municipality")
        or address.get("county")
    )
    # Chercher une ville rend un résultat dont le nom *est* la ville : « Annecy,
    # Annecy » n'apprend rien à personne.
    parts = [p for p in (street, city) if p]
    unique = list(dict.fromkeys(parts))
    if unique:
        return ", ".join(unique)
    return (item.get("display_name") or "").split(",")[0]
