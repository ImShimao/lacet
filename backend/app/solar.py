"""Lever et coucher du soleil — pour la bascule automatique en mode nuit.

Algorithme NOAA simplifié. Précision de l'ordre de la minute, largement
suffisante pour décider si l'app doit privilégier les rues éclairées.
"""

from __future__ import annotations

import math
from datetime import datetime, timezone

# Angle zénithal du soleil au lever/coucher officiel (réfraction incluse).
ZENITH_DEG = 90.833


def _solar_times_utc_minutes(lat: float, lon: float, when: datetime) -> tuple[float, float] | None:
    """(lever, coucher) en minutes UTC depuis minuit. None si jour ou nuit polaire."""
    day = when.timetuple().tm_yday
    gamma = 2 * math.pi / 365.0 * (day - 1 + (when.hour - 12) / 24.0)

    eqtime = 229.18 * (
        0.000075
        + 0.001868 * math.cos(gamma)
        - 0.032077 * math.sin(gamma)
        - 0.014615 * math.cos(2 * gamma)
        - 0.040849 * math.sin(2 * gamma)
    )
    decl = (
        0.006918
        - 0.399912 * math.cos(gamma)
        + 0.070257 * math.sin(gamma)
        - 0.006758 * math.cos(2 * gamma)
        + 0.000907 * math.sin(2 * gamma)
        - 0.002697 * math.cos(3 * gamma)
        + 0.001480 * math.sin(3 * gamma)
    )

    lat_rad = math.radians(lat)
    cos_ha = math.cos(math.radians(ZENITH_DEG)) / (
        math.cos(lat_rad) * math.cos(decl)
    ) - math.tan(lat_rad) * math.tan(decl)

    if cos_ha > 1 or cos_ha < -1:
        return None  # nuit polaire ou soleil de minuit

    ha = math.degrees(math.acos(cos_ha))
    sunrise = 720 - 4 * (lon + ha) - eqtime
    sunset = 720 - 4 * (lon - ha) - eqtime
    return sunrise, sunset


def is_night(lat: float, lon: float, when: datetime | None = None) -> bool:
    """Fait-il nuit à cet endroit, à cet instant ?"""
    moment = when or datetime.now(timezone.utc)
    if moment.tzinfo is None:
        moment = moment.replace(tzinfo=timezone.utc)
    moment = moment.astimezone(timezone.utc)

    times = _solar_times_utc_minutes(lat, lon, moment)
    if times is None:
        # Aux latitudes extrêmes, on retombe sur une règle horaire grossière.
        return not (6 <= moment.hour < 20)

    sunrise, sunset = times
    now_minutes = moment.hour * 60 + moment.minute
    return not (sunrise <= now_minutes <= sunset)
