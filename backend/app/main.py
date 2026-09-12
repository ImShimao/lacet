"""API Lacet.

    uvicorn app.main:app --reload

Documentation interactive une fois lancé : http://127.0.0.1:8000/docs
"""

from __future__ import annotations

import logging

from fastapi import FastAPI, HTTPException, Query
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import Response

from . import __version__, geocode
from .config import settings
from .gpx import build_gpx
from .models import GpxRequest, LoopRequest, LoopResponse
from .osm.overpass import OverpassError
from .safety.gate import THRESHOLDS
from .safety.risk import DEFAULT_SPEED_KMH, evaluate_edge
from .service import PlanningError, plan_loops

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s  %(levelname)-7s %(name)s — %(message)s",
    datefmt="%H:%M:%S",
)

app = FastAPI(
    title="Lacet",
    version=__version__,
    description="Génération de boucles de course à pied, notées sur la sécurité du tracé.",
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=settings.cors_origins,
    allow_credentials=False,
    allow_methods=["GET", "POST"],
    allow_headers=["*"],
)


@app.get("/health")
async def health() -> dict[str, str]:
    return {"status": "ok", "version": __version__}


@app.get("/places")
async def places(
    q: str = Query(min_length=2, max_length=120), limit: int = Query(5, ge=1, le=8)
) -> list[dict]:
    """Recherche d'un lieu de départ, n'importe où dans le monde.

    La saisie est bornée avant d'être relayée à Nominatim : on ne transmet pas
    une requête arbitraire à un service tiers, et une saisie interminable ne
    doit pas pouvoir servir de levier.
    """
    return await geocode.search(q.strip(), limit=limit)


@app.get("/place")
async def place(
    lat: float = Query(ge=-90, le=90), lon: float = Query(ge=-180, le=180)
) -> dict[str, str | None]:
    """Nom lisible d'un point, pour l'afficher comme point de départ."""
    return {"label": await geocode.reverse(lat, lon)}


@app.post("/loops", response_model=LoopResponse)
async def loops(req: LoopRequest) -> LoopResponse:
    """Génère des boucles depuis un point de départ.

    Rend les itinéraires retenus **et** ceux qui ont été écartés, avec le motif :
    c'est ce qui permet à l'app d'expliquer pourquoi elle ne propose que deux
    parcours plutôt que trois.
    """
    try:
        return await plan_loops(req)
    except PlanningError as exc:
        raise HTTPException(status_code=422, detail=str(exc)) from exc
    except OverpassError as exc:
        raise HTTPException(status_code=503, detail=str(exc)) from exc


@app.post("/gpx")
async def gpx(req: GpxRequest) -> Response:
    """Convertit un tracé en fichier GPX téléchargeable."""
    if not req.geometry:
        raise HTTPException(status_code=400, detail="Tracé vide.")

    coords = [(float(p[0]), float(p[1])) for p in req.geometry]
    content = build_gpx(req.name, coords, req.elevation, req.sport.value)
    filename = "".join(c if c.isalnum() or c in "-_" else "-" for c in req.name)[:60]

    return Response(
        content=content,
        media_type="application/gpx+xml",
        headers={"Content-Disposition": f'attachment; filename="{filename or "lacet"}.gpx"'},
    )


@app.get("/explain")
async def explain() -> dict:
    """Expose le modèle de sécurité — utile pour l'écran « comment ça marche ».

    Sert aussi de vérification rapide : si ces chiffres bougent sans qu'on l'ait
    voulu, c'est que le modèle a été touché.
    """
    examples = [
        ("Allée de parc", {"highway": "footway"}, True),
        ("Rue résidentielle avec trottoir", {"highway": "residential", "sidewalk": "both"}, True),
        ("Rue résidentielle sans trottoir", {"highway": "residential", "sidewalk": "no"}, True),
        ("Rue sans information (ville)", {"highway": "residential"}, True),
        ("Rue sans information (campagne)", {"highway": "unclassified"}, False),
        ("Départementale avec accotement", {"highway": "tertiary", "shoulder": "yes"}, False),
        ("Départementale nue", {"highway": "secondary"}, False),
    ]

    return {
        "formula": "risque = (v / 50)^2 * (1 - sep / 2)",
        "default_speeds_kmh": DEFAULT_SPEED_KMH,
        "gate": {
            sport: {
                mode: {
                    "exposed_share": th.exposed_share,
                    "longest_exposed_m": th.longest_exposed_m,
                    "unprotected_crossings": th.unprotected_crossings,
                    "closure_m": th.closure_m,
                    "overlap_share": th.overlap_share,
                }
                for mode, th in modes.items()
            }
            for sport, modes in THRESHOLDS.items()
        },
        "examples": [
            {
                "label": label,
                "tags": tags,
                "in_builtup": builtup,
                "speed_kmh": ev.speed_kmh,
                "separation": ev.separation,
                "risk": round(ev.risk, 3),
                "level": ev.level,
                "reason": ev.reason,
                "inferred": ev.inferred,
            }
            for label, tags, builtup in examples
            for ev in [evaluate_edge(tags, in_builtup=builtup)]
        ],
    }
