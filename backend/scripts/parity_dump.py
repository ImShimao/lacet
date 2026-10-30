"""Oracle de parité pour le moteur JavaScript.

    python scripts/parity_dump.py            # rejoue les cas à partir des extraits figés
    python scripts/parity_dump.py --fetch    # télécharge d'abord les extraits réels manquants
    python scripts/parity_dump.py --check    # vérifie, sans rien écrire, que l'oracle est à jour

Le moteur de l'app tourne désormais sur le téléphone, en JavaScript. Ce module
Python reste la référence : c'est ici que chaque seuil est justifié et testé.
Ce script fait tourner le moteur Python sur des extraits OpenStreetMap figés et
écrit, pour chaque cas, **tout ce qui permet de localiser une divergence** :

- le graphe construit (nombre de nœuds, d'arêtes, longueur totale) ;
- chaque candidat brut produit par la génération, arête par arête ;
- la réponse finale, telle que l'API la rend.

`frontend/src/engine/parity.test.js` rejoue les mêmes cas et compare.

Deux sources d'aléa sont remplacées des deux côtés par des fonctions
déterministes, **sans trigonométrie** pour qu'elles soient identiques au bit
près dans les deux langages : l'altitude (qui viendrait de l'IGN) et le vent
(qui viendrait d'Open-Meteo).
"""

from __future__ import annotations

import asyncio
import gzip
import io
import json
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))
sys.path.insert(0, str(ROOT / "tests"))

from app import service  # noqa: E402
from app.models import LoopRequest  # noqa: E402
from app.elevation import Relief, terrain_values  # noqa: E402
from app.osm.extract import read as read_extract, to_cache  # noqa: E402
from app.osm.overpass import fetch_area  # noqa: E402
from app.solar import is_night  # noqa: E402
from app.wind import Wind  # noqa: E402
from conftest import grid_payload  # noqa: E402

OUT = ROOT.parent / "frontend" / "src" / "engine" / "__fixtures__" / "parity"

# Extraits réels : une petite ville, et un bout de centre-ville dense. Le rayon
# est volontairement petit pour que les fichiers restent raisonnables.
REAL = {
    "beaune": {"lat": 47.0245, "lon": 4.8395, "radius_m": 3000.0, "target_m": 4000.0},
    "lyon-centre": {"lat": 45.7640, "lon": 4.8357, "radius_m": 2000.0, "target_m": 3000.0},
}

CASES = [
    {"name": "damier-sur", "extract": "grid9", "req": {"lat": 48.806, "lon": 2.306, "distance_km": 2.5}},
    {"name": "damier-danger-sur", "extract": "grid9-danger",
     "req": {"lat": 48.806, "lon": 2.306, "distance_km": 2.5}},
    {"name": "damier-danger-standard", "extract": "grid9-danger",
     "req": {"lat": 48.806, "lon": 2.306, "distance_km": 2.5, "safety": "standard"}},
    {"name": "damier-velo", "extract": "grid15",
     "req": {"lat": 48.8105, "lon": 2.3105, "distance_km": 4.0, "sport": "bike", "limit": 8}},
    # Un parc, une rivière et un sentier balisé : l'indice vert et le bonus
    # « nature », avec puis sans.
    {"name": "damier-nature", "extract": "grid9-nature",
     "req": {"lat": 48.806, "lon": 2.306, "distance_km": 2.5}},
    {"name": "damier-sans-nature", "extract": "grid9-nature",
     "req": {"lat": 48.806, "lon": 2.306, "distance_km": 2.5, "nature": False}},
    # Un rond-point au centre : le tour par la gauche (par défaut), par la
    # droite, et à vélo, sur l'anneau à sens unique — voir `loops.keep_side` et
    # `navigation._roundabout`.
    {"name": "damier-rond-point", "extract": "grid9-ring",
     "req": {"lat": 48.803, "lon": 2.303, "distance_km": 2.5, "limit": 8}},
    {"name": "damier-rond-point-droite", "extract": "grid9-ring",
     "req": {"lat": 48.803, "lon": 2.303, "distance_km": 2.5, "limit": 8, "side": "right"}},
    {"name": "damier-rond-point-velo", "extract": "grid9-ring",
     "req": {"lat": 48.803, "lon": 2.303, "distance_km": 3.0, "limit": 8, "sport": "bike"}},
    {"name": "damier-tours", "extract": "grid9",
     "req": {"lat": 48.806, "lon": 2.306, "distance_km": 6.0, "limit": 6}},
    # La forme demandée, sur le même damier : que des « 8 », que des tours —
    # trois, quand « Auto » commence par deux —, ou une boucle et rien d'autre.
    {"name": "damier-deux-boucles", "extract": "grid9",
     "req": {"lat": 48.806, "lon": 2.306, "distance_km": 6.0, "limit": 6, "form": "eight"}},
    {"name": "damier-trois-tours", "extract": "grid9",
     "req": {"lat": 48.806, "lon": 2.306, "distance_km": 6.0, "limit": 6, "form": "laps", "laps": 3}},
    {"name": "damier-une-boucle", "extract": "grid9",
     "req": {"lat": 48.806, "lon": 2.306, "distance_km": 6.0, "limit": 6, "form": "loop"}},
    {"name": "beaune-course", "extract": "beaune",
     "req": {"lat": 47.0245, "lon": 4.8395, "distance_km": 4.0, "with_elevation": True}, "wind": True},
    {"name": "beaune-sentier-nuit", "extract": "beaune",
     "req": {"lat": 47.0245, "lon": 4.8395, "distance_km": 3.5, "surface": "trail",
             "time_of_day": "night", "elevation": "hilly", "limit": 8}},
    {"name": "beaune-duree-standard", "extract": "beaune",
     "req": {"lat": 47.0245, "lon": 4.8395, "duration_min": 25, "safety": "standard",
             "pace_sec_per_km": 360, "elevation": "flat", "with_elevation": True}},
    # Le D+ visé remplace « Plat » : la pente ne se paie plus. Le faux relief
    # monte de 215 à 245 m/km ; 760 m sur 4 km en visent 190, et la fourchette
    # (152 à 228) en laisse dehors une partie.
    {"name": "beaune-d-plus-vise", "extract": "beaune",
     "req": {"lat": 47.0245, "lon": 4.8395, "distance_km": 4.0, "elevation": "flat",
             "climb_m": 760.0, "with_elevation": True, "limit": 8}},
    {"name": "lyon-douze", "extract": "lyon-centre",
     "req": {"lat": 45.7640, "lon": 4.8357, "distance_km": 3.0, "limit": 12}, "wind": True},
    {"name": "lyon-velo", "extract": "lyon-centre",
     "req": {"lat": 45.7640, "lon": 4.8357, "distance_km": 3.0, "sport": "bike", "safety": "standard"}},
]


def fake_elevation(lon: float, lat: float) -> float:
    """Relief artificiel, reproductible au bit près en JavaScript."""
    return 100.0 + (lon * 100000.0) % 97.0 + ((lat * 100000.0) % 53.0) * 0.5


async def fake_fetch_many(routes):
    # `fetch_many` rend un `Relief` — les altitudes **et** la finesse de leur
    # source, qui décide du lissage et du seuil. La source est la fine : la
    # parité se juge à réglage égal des deux côtés.
    return [
        Relief([fake_elevation(lon, lat) for lon, lat in coords], False)
        if coords
        else None
        for coords in routes
    ]


def write_gz(path: Path, data) -> None:
    """Écrit `data` en JSON compressé, sans date dans l'en-tête.

    `gzip.open` y inscrivait l'heure : chaque passage « modifiait » les trois
    damiers sans que rien n'ait changé, et le diff du commit s'en encombrait.
    """
    with gzip.GzipFile(path, "wb", mtime=0) as raw, io.TextIOWrapper(raw, encoding="utf-8") as fh:
        json.dump(data, fh)


def extract_path(name: str) -> Path:
    return OUT / f"extract-{name}.json.gz"


def load_extract(name: str) -> dict:
    if name == "grid9":
        return to_cache(read_extract(grid_payload(9)))
    if name == "grid9-danger":
        return to_cache(read_extract(grid_payload(9, dangerous_row=4)))
    if name == "grid9-nature":
        return to_cache(read_extract(grid_payload(9, nature=True)))
    if name == "grid9-ring":
        return to_cache(read_extract(grid_payload(9, roundabout=True)))
    if name == "grid15":
        return to_cache(read_extract(grid_payload(15)))
    with gzip.open(extract_path(name), "rt", encoding="utf-8") as fh:
        return json.load(fh)


async def fetch_real() -> None:
    OUT.mkdir(parents=True, exist_ok=True)
    for name, spec in REAL.items():
        path = extract_path(name)
        if path.exists():
            continue
        extract = await fetch_area(spec["lat"], spec["lon"], spec["radius_m"], target_m=spec["target_m"])
        write_gz(path, to_cache(extract))
        print(f"extrait {name} : {len(extract.ways)} voies → {path.stat().st_size / 1e6:.1f} Mo compressés")


async def run_case(case: dict) -> dict:
    compact = load_extract(case["extract"])
    extract = read_extract(compact)
    trace: dict = {"graph": None, "raw": []}

    async def fake_fetch_area(lat, lon, radius_m, *, target_m=0.0):
        return extract

    real_build = service.build_graph

    def traced_build(payload, **kwargs):
        graph = real_build(payload, **kwargs)
        trace["graph"] = {
            "nodes": len(graph.nodes),
            "edges": len(graph.edges),
            "length_m": sum(e.length_m for e in graph.edges),
            "crossings": len(graph.crossings),
            "green": sum(e.green for e in graph.edges),
            "marked": sum(e.marked for e in graph.edges),
            "first_edges": [[e.a, e.b, e.length_m] for e in graph.edges[:20]],
        }
        return graph

    real_generate = service.generate_loops

    def traced_generate(graph, start, target_m, profile, **kwargs):
        raw = real_generate(graph, start, target_m, profile, **kwargs)
        trace["raw"].append({
            "start": start,
            "target_m": target_m,
            "candidates": [
                {
                    "edges": c.edges,
                    "distance_m": c.stats.distance_m,
                    "roundness": c.roundness,
                    "bearing": c.bearing,
                    "shape": c.shape,
                }
                for c in raw
            ],
        })
        return raw

    async def fake_wind(lat, lon):
        return Wind(bearing=75.0, speed_kmh=24.0) if case.get("wind") else None

    service.graph_cache.clear()
    service.fetch_area = fake_fetch_area
    service.build_graph = traced_build
    service.generate_loops = traced_generate
    service.fetch_many = fake_fetch_many
    service.current_wind = fake_wind
    try:
        req = LoopRequest(**{"with_elevation": False, "time_of_day": "day", **case["req"]})
        response = await service.plan_loops(req)
    finally:
        service.build_graph = real_build
        service.generate_loops = real_generate

    body = response.model_dump(mode="json")
    for key in ("elapsed_s", "timings_s", "graph_cache"):
        body["meta"].pop(key, None)
    return {"case": case, "trace": trace, "response": body}


def solar_table() -> list:
    from datetime import datetime, timezone

    rows = []
    for lat, lon in [(48.85, 2.35), (47.02, 4.84), (69.65, 18.95), (-33.87, 151.21), (0.0, 0.0)]:
        for month in (1, 3, 6, 9, 12):
            for hour in range(0, 24, 1):
                when = datetime(2026, month, 15, hour, 30, tzinfo=timezone.utc)
                rows.append([lat, lon, when.isoformat(), is_night(lat, lon, when)])
    return rows


def fake_tile(z: int, x: int, y: int) -> list[list[float]]:
    """Une tuile terrarium artificielle : des entiers, donc exacte en JavaScript."""
    return [
        [((x * 256 + i) * 37 + (y * 256 + j) * 101) % 997 * 0.25 + 150 for i in range(256)]
        for j in range(256)
    ]


def terrain_table() -> list:
    """L'altitude lue dans les tuiles en quelques points, dont certains à cheval
    sur deux ou quatre tuiles : la projection et l'interpolation de
    `terrain_values`, que le moteur JavaScript refait à l'identique."""
    points = [(7.2108 + k * 0.0137, 47.9097 - k * 0.0091) for k in range(40)]
    points += [(7.03125, 47.98992), (-0.0001, 0.0001), (151.21, -33.87)]
    return [[lon, lat, z] for (lon, lat), z in zip(points, terrain_values(points, fake_tile))]


def first_gap(old, new, path: str = "") -> str | None:
    """Le premier écart entre deux oracles, à la tolérance de `parity.test.js`.

    Pas une comparaison des fichiers : gzip y inscrit l'heure d'écriture, et le
    PC et la CI n'ont pas la même bibliothèque mathématique — un sinus peut y
    différer au dernier bit sans que rien n'ait changé.
    """
    if isinstance(old, dict) and isinstance(new, dict):
        if old.keys() != new.keys():
            return f"{path} : clés {sorted(old.keys() ^ new.keys())}"
        return next((g for k in old if (g := first_gap(old[k], new[k], f"{path}.{k}"))), None)
    if isinstance(old, list) and isinstance(new, list):
        if len(old) != len(new):
            return f"{path} : {len(old)} éléments, puis {len(new)}"
        return next((g for i, (a, b) in enumerate(zip(old, new)) if (g := first_gap(a, b, f"{path}[{i}]"))), None)
    numbers = (int, float)
    if isinstance(old, numbers) and isinstance(new, numbers) and not isinstance(old, bool):
        return None if abs(old - new) <= 1e-9 * max(1.0, abs(old), abs(new)) else f"{path} : {old!r} → {new!r}"
    return None if old == new else f"{path} : {old!r} → {new!r}"


async def main() -> None:
    # Les « → » et « nœuds » du journal faisaient planter le script dans une
    # console Windows redirigée — après l'écriture de l'oracle, heureusement.
    sys.stdout.reconfigure(errors="replace")
    check = "--check" in sys.argv
    if "--fetch" in sys.argv:
        await fetch_real()

    OUT.mkdir(parents=True, exist_ok=True)
    for name in () if check else ("grid9", "grid9-danger", "grid9-nature", "grid9-ring", "grid15"):
        write_gz(extract_path(name), load_extract(name))

    results = []
    for case in CASES:
        if case["extract"] in REAL and not extract_path(case["extract"]).exists():
            print(f"— {case['name']} : extrait absent, lance avec --fetch")
            continue
        result = await run_case(case)
        routes = result["response"]["routes"]
        print(
            f"{case['name']:<24} graphe {result['trace']['graph']['nodes']:>6} nœuds · "
            f"{sum(len(r['candidates']) for r in result['trace']['raw']):>3} candidats bruts · "
            f"{len(routes)} itinéraires {[r['safety']['grade'] for r in routes]}"
        )
        results.append(result)

    oracle = {"cases": results, "solar": solar_table(), "terrain": terrain_table()}
    if check:
        # Un changement du moteur Python sans oracle refait : `parity.test.js`
        # comparerait alors le JavaScript à l'ancienne réponse, et resterait vert.
        with gzip.open(OUT / "expected.json.gz", "rt", encoding="utf-8") as fh:
            gap = first_gap(json.load(fh), json.loads(json.dumps(oracle)), "oracle")
        if gap:
            sys.exit(f"Oracle périmé — relance scripts/parity_dump.py.\nPremier écart : {gap}")
        print("Oracle à jour.")
        return

    write_gz(OUT / "expected.json.gz", oracle)
    print(f"→ {OUT / 'expected.json.gz'}")


if __name__ == "__main__":
    asyncio.run(main())
