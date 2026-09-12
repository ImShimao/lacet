"""Lacet en un seul service : l'API sous `/api`, l'app web à la racine.

    uvicorn app.server:app --host 0.0.0.0 --port 8000

C'est la forme à héberger. La page et ses appels partagent une adresse — donc
un seul certificat HTTPS, sans proxy ni CORS, et le téléphone n'a qu'une URL à
retenir. En développement, rien ne change : Vite sert la page et relaie `/api`
vers `app.main:app`.

L'app doit avoir été construite avant (`cd frontend && npm run build`) ; le
dossier servi se règle par `LACET_WEB_DIR`.
"""

from __future__ import annotations

import os
from pathlib import Path

from fastapi import FastAPI, Request
from fastapi.staticfiles import StaticFiles

from .config import BACKEND_DIR
from .main import app as api

WEB_DIR = Path(os.environ.get("LACET_WEB_DIR", BACKEND_DIR.parent / "frontend" / "dist"))

if not (WEB_DIR / "index.html").is_file():
    raise RuntimeError(
        f"App web introuvable dans {WEB_DIR}. Construis-la d'abord : "
        "cd frontend && npm run build (ou règle LACET_WEB_DIR)."
    )

app = FastAPI(title="Lacet", docs_url=None, redoc_url=None, openapi_url=None)


@app.middleware("http")
async def cache_headers(request: Request, call_next):
    response = await call_next(request)
    path = request.url.path
    if path.startswith("/api"):
        return response
    # Les fichiers de `assets/` portent leur empreinte dans leur nom : ils ne
    # changent jamais, on peut les garder un an. Tout le reste — la page, le
    # service worker, le manifeste — doit être revalidé, sinon une mise à jour
    # attendrait l'expiration d'un cache que personne ne maîtrise.
    if path.startswith("/assets/"):
        response.headers["Cache-Control"] = "public, max-age=31536000, immutable"
    else:
        response.headers["Cache-Control"] = "no-cache"
    return response


app.mount("/api", api)
app.mount("/", StaticFiles(directory=WEB_DIR, html=True), name="web")
