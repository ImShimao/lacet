"""Export GPX 1.1.

L'attribution OpenStreetMap est obligatoire : les données sont en ODbL, et un
tracé qui en dérive doit la porter — y compris dans un fichier exporté.
"""

from __future__ import annotations

from datetime import datetime, timezone
from xml.sax.saxutils import escape

from .geo import Coord, haversine_m


def _interpolate(coords: list[Coord], samples: list[float]) -> list[float]:
    """Étale une série d'altitudes échantillonnée sur toute la géométrie.

    Les échantillons sont supposés régulièrement espacés le long du tracé — ce
    que produit `geo.resample`. Chaque point de la géométrie reçoit l'altitude
    interpolée linéairement entre ses deux échantillons encadrants.
    """
    if len(samples) < 2 or len(coords) < 2:
        return [samples[0] if samples else 0.0] * len(coords)

    cumulative = [0.0]
    for i in range(len(coords) - 1):
        cumulative.append(cumulative[-1] + haversine_m(coords[i], coords[i + 1]))

    total = cumulative[-1] or 1.0
    step = total / (len(samples) - 1)

    out: list[float] = []
    for distance in cumulative:
        position = distance / step
        low = min(int(position), len(samples) - 2)
        fraction = position - low
        out.append(samples[low] + (samples[low + 1] - samples[low]) * fraction)
    return out

ATTRIBUTION = "Itinéraire dérivé des données OpenStreetMap, sous licence ODbL (openstreetmap.org/copyright)."


# Les types d'activité GPX reconnus par les montres et compteurs. Un fichier
# marqué « running » importé dans un compteur de vélo y arrive classé comme une
# course à pied, avec des zones d'effort et des moyennes qui n'ont aucun sens.
ACTIVITY_TYPE = {"run": "running", "bike": "cycling"}


def build_gpx(
    name: str,
    coords: list[Coord],
    elevations: list[float] | None = None,
    sport: str = "run",
) -> str:
    stamp = datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")
    safe_name = escape(name)

    # Le profil d'altitude est échantillonné (un point tous les 100 m), pas
    # aligné sur la géométrie complète. Les apparier par indice attribuerait à
    # chaque point du début du tracé l'altitude d'un point situé bien plus loin.
    series = _interpolate(coords, elevations) if elevations else None

    points: list[str] = []
    for i, (lon, lat) in enumerate(coords):
        if series is not None:
            points.append(
                f'      <trkpt lat="{lat:.7f}" lon="{lon:.7f}">'
                f"<ele>{series[i]:.1f}</ele></trkpt>"
            )
        else:
            points.append(f'      <trkpt lat="{lat:.7f}" lon="{lon:.7f}" />')

    body = "\n".join(points)
    activity = ACTIVITY_TYPE.get(sport, "running")
    return f"""<?xml version="1.0" encoding="UTF-8"?>
<gpx version="1.1" creator="Lacet"
     xmlns="http://www.topografix.com/GPX/1/1"
     xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance"
     xsi:schemaLocation="http://www.topografix.com/GPX/1/1 http://www.topografix.com/GPX/1/1/gpx.xsd">
  <metadata>
    <name>{safe_name}</name>
    <time>{stamp}</time>
    <copyright author="OpenStreetMap contributors">
      <license>https://opendatacommons.org/licenses/odbl/</license>
    </copyright>
    <desc>{escape(ATTRIBUTION)}</desc>
  </metadata>
  <trk>
    <name>{safe_name}</name>
    <type>{activity}</type>
    <trkseg>
{body}
    </trkseg>
  </trk>
</gpx>
"""
