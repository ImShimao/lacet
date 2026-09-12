# Lacet — l'API et l'app web dans une seule image.
#
#   docker build -t lacet .
#   docker run -p 7860:7860 lacet        → http://localhost:7860
#
# Le port suit la variable PORT (Render, Railway, Hugging Face la fixent).

# ── 1. l'app web ─────────────────────────────────────────────────────────────
FROM node:22-alpine AS web
WORKDIR /web
COPY frontend/package.json frontend/package-lock.json ./
RUN npm ci
COPY frontend/ ./
# Facultatif : active les fonds Mapbox (jeton public « pk. »).
ARG VITE_MAPBOX_TOKEN=""
ENV VITE_MAPBOX_TOKEN=$VITE_MAPBOX_TOKEN
RUN npm run build

# ── 2. le serveur ────────────────────────────────────────────────────────────
FROM python:3.13-slim
ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1 \
    PORT=7860 \
    LACET_WEB_DIR=/app/web \
    LACET_CACHE_DIR=/tmp/lacet-cache
WORKDIR /app
COPY backend/requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt
COPY backend/app ./app
COPY --from=web /web/dist ./web
RUN useradd -m -u 1000 lacet
USER lacet
EXPOSE 7860
CMD ["sh", "-c", "uvicorn app.server:app --host 0.0.0.0 --port ${PORT} --proxy-headers --forwarded-allow-ips='*'"]
