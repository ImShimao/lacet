"""Vérification de bout en bout sur une vraie ville.

    python scripts/smoke.py                    # Paris, 10 km
    python scripts/smoke.py 45.7640 4.8357 8   # Lyon, 8 km

Appelle réellement Overpass et le service d'altitude. Le premier passage prend
quelques secondes ; les suivants sortent du cache disque et sont instantanés.
"""

from __future__ import annotations

import asyncio
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from app.models import LoopRequest  # noqa: E402
from app.service import plan_loops  # noqa: E402

VILLES = {
    "paris": (48.8566, 2.3522),
    "lyon": (45.7640, 4.8357),
    "toulouse": (43.6047, 1.4442),
    "annecy": (45.8992, 6.1294),
}


async def main() -> int:
    args = sys.argv[1:]
    if len(args) >= 3:
        lat, lon, km = float(args[0]), float(args[1]), float(args[2])
        label = f"{lat:.4f}, {lon:.4f}"
    else:
        ville = (args[0] if args else "paris").lower()
        if ville not in VILLES:
            print(f"Villes connues : {', '.join(VILLES)}")
            return 2
        lat, lon = VILLES[ville]
        km = float(args[1]) if len(args) > 1 else 10.0
        label = ville

    print(f"\n  Départ : {label}   Distance visée : {km} km\n")

    req = LoopRequest(lat=lat, lon=lon, distance_km=km)
    result = await plan_loops(req)

    meta = result.meta
    print(
        f"  Graphe : {meta['graph_nodes']:,} nœuds / {meta['graph_edges']:,} arêtes"
        f"   ·   {meta['raw_candidates']} candidats bruts"
        f"   ·   {'nuit' if meta['night'] else 'jour'}"
    )
    phases = "  ".join(f"{k} {v}s" for k, v in meta["timings_s"].items())
    print(f"  Temps  : {meta['elapsed_s']} s au total   ({phases})\n")

    if not result.routes:
        print(f"  Aucun itinéraire : {meta.get('message', '')}\n")

    for route in result.routes:
        s = route.safety
        ascent = f"D+ {route.ascent_m:.0f} m" if route.ascent_m is not None else "D+ n/d"
        print(f"  [{s.grade}]  {route.name}")
        print(
            f"       {route.distance_m / 1000:.2f} km · {ascent} · "
            f"{route.duration_s // 60} min · score {route.score:.3f}"
        )
        print(
            f"       {s.protected_share * 100:.0f} % protégé · "
            f"{s.exposed_m:.0f} m exposés (max {s.longest_exposed_m:.0f} m d'affilée) · "
            f"{s.unprotected_crossings} traversée(s) non protégée(s)"
        )
        surf = route.surfaces
        total = max(route.distance_m, 1)
        print(
            f"       revêtement : {surf.paved_m / total * 100:.0f} % route, "
            f"{surf.gravel_m / total * 100:.0f} % chemin, "
            f"{surf.trail_m / total * 100:.0f} % sentier"
        )
        if s.inferred_share > 0.2:
            print(f"       ⚠ trottoir estimé sur {s.inferred_share * 100:.0f} % du tracé")
        print()

    if result.rejected:
        print("  Écartés :")
        for r in result.rejected:
            print(f"       {r.distance_m / 1000:5.1f} km — {r.label}")
        print()

    # Contrôle : aucune boucle retenue ne doit dépasser les seuils du mode Sûr.
    for route in result.routes:
        assert route.safety.exposed_share <= 0.031, "le portail L3 a laissé passer un tracé exposé"
        assert route.safety.longest_exposed_m <= 151, "portion continue trop longue"
    print("  ✓ Toutes les boucles retenues respectent les seuils du mode Sûr.\n")
    return 0


if __name__ == "__main__":
    raise SystemExit(asyncio.run(main()))
