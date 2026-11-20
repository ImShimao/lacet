"""Génère les icônes de l'app — la marque Lacet : une boucle qui revient à son départ.

La boucle a la forme libre d'un vrai parcours dans des rues : on part du point
blanc, on fait le tour, on revient au même point — la sortie que l'app propose. C'est le même tracé que `src/Logo.jsx` (`LOOP`), en 64 × 64.

Encodeur PNG écrit à la main (zlib + struct de la bibliothèque standard) pour
n'ajouter aucune dépendance au projet. Le trait est rendu par distance au tracé,
avec un anticrénelage d'un pixel : pas de suréchantillonnage, et l'écran de
lancement se calcule en quelques secondes.

    py scripts/make-icons.py
"""

from __future__ import annotations

import math
import struct
import zlib
from pathlib import Path

# Le fond de l'app, la boucle à l'accent bleu par défaut, le départ blanc.
INK = (0x0A, 0x09, 0x10)
LOOP_COLOR = (0x3D, 0x7B, 0xFF)
WHITE = (0xFF, 0xFF, 0xFF)

# Le tracé de `src/Logo.jsx`, en coordonnées 0–64 : deux courbes de Bézier.
LOOP = [
    ((21, 46), (10, 34), (14, 15), (28, 12)),
    ((28, 12), (41, 9), (55, 18), (51, 31)),
    ((51, 31), (48, 41), (41, 40), (39, 47)),
    ((39, 47), (37, 55), (27, 55), (21, 46)),
]
STROKE = 6.0  # largeur du trait, en unités du tracé
DOT = (21, 46)
DOT_RADIUS = 6.2
DOT_RING = 2.4  # l'anneau de fond autour du point, qui le détache du trait

RESOURCES = Path(__file__).resolve().parent.parent / "resources"
SIZES = {
    "icon-192.png": 192,  # l'icône de la source AltStore (scripts/altstore_source.py)
}


def bezier(p0, p1, p2, p3, steps: int = 64) -> list[tuple[float, float]]:
    out = []
    for i in range(steps + 1):
        t = i / steps
        u = 1 - t
        out.append(
            (
                u**3 * p0[0] + 3 * u * u * t * p1[0] + 3 * u * t * t * p2[0] + t**3 * p3[0],
                u**3 * p0[1] + 3 * u * u * t * p1[1] + 3 * u * t * t * p2[1] + t**3 * p3[1],
            )
        )
    return out


def render(size: int, scale: float = 1.0) -> list[bytearray]:
    """La marque dans un carré de `size` pixels, lignes RGB en octets.

    `scale` : la part du carré qu'occupe le cadre 64 × 64 (1 pour l'icône).
    """
    k = size * scale / 64
    off = (size - 64 * k) / 2
    points = [pt for curve in LOOP for pt in bezier(*curve)]
    points = [(off + x * k, off + y * k) for x, y in points]
    half = STROKE * k / 2

    # Distance au tracé, segment par segment, seulement autour de chacun : le
    # reste du carré est le fond.
    dist = [math.inf] * (size * size)
    for (ax, ay), (bx, by) in zip(points, points[1:]):
        dx, dy = bx - ax, by - ay
        length2 = dx * dx + dy * dy or 1e-9
        x0 = max(0, int(min(ax, bx) - half - 2))
        x1 = min(size - 1, int(max(ax, bx) + half + 2))
        y0 = max(0, int(min(ay, by) - half - 2))
        y1 = min(size - 1, int(max(ay, by) + half + 2))
        for y in range(y0, y1 + 1):
            py = y + 0.5
            row = y * size
            for x in range(x0, x1 + 1):
                px = x + 0.5
                t = max(0.0, min(1.0, ((px - ax) * dx + (py - ay) * dy) / length2))
                ex, ey = px - ax - t * dx, py - ay - t * dy
                d = math.sqrt(ex * ex + ey * ey)
                if d < dist[row + x]:
                    dist[row + x] = d

    cx, cy = off + DOT[0] * k, off + DOT[1] * k
    dot_r = DOT_RADIUS * k
    ring_r = (DOT_RADIUS + DOT_RING) * k

    def mix(a, b, alpha):
        return tuple(round(a[i] + (b[i] - a[i]) * alpha) for i in range(3))

    rows: list[bytearray] = []
    for y in range(size):
        row = bytearray()
        for x in range(size):
            pixel = mix(INK, LOOP_COLOR, max(0.0, min(1.0, half - dist[y * size + x] + 0.5)))
            d = math.hypot(x + 0.5 - cx, y + 0.5 - cy)
            pixel = mix(pixel, INK, max(0.0, min(1.0, ring_r - d + 0.5)))
            pixel = mix(pixel, WHITE, max(0.0, min(1.0, dot_r - d + 0.5)))
            row.extend(pixel)
        rows.append(row)
    return rows


def write_png(path: Path, width: int, height: int, rows) -> None:
    """Écrit un PNG RGB 8 bits ; les lignes arrivent en octets, une à une.

    L'écran de lancement fait 2 732 pixels de côté : ligne par ligne, il tient
    sans peine en mémoire.
    """
    compressor = zlib.compressobj(9)
    data = b"".join(compressor.compress(b"\x00" + bytes(row)) for row in rows) + compressor.flush()

    def chunk(kind: bytes, payload: bytes) -> bytes:
        body = kind + payload
        return struct.pack(">I", len(payload)) + body + struct.pack(">I", zlib.crc32(body) & 0xFFFFFFFF)

    header = struct.pack(">IIBBBBB", width, height, 8, 2, 0, 0, 0)
    path.write_bytes(b"\x89PNG\r\n\x1a\n" + chunk(b"IHDR", header) + chunk(b"IDAT", data) + chunk(b"IEND", b""))


def ios_resources() -> None:
    """L'icône de l'app iPhone et son écran de lancement.

    L'icône est opaque : iOS arrondit lui-même les coins et remplirait de noir
    une zone transparente. L'écran de lancement pose la marque au centre, sur le
    fond de l'app, à la taille où l'animation d'ouverture (`src/Launch.jsx`) la
    reprend : le passage de l'un à l'autre ne se voit pas.
    """
    write_png(RESOURCES / "icon.png", 1024, 1024, render(1024, scale=0.82))
    print("  resources/icon.png  (1024×1024)")

    side = 2732
    logo_size = 520
    logo = render(logo_size)
    background = bytes(INK) * side
    left = (side - logo_size) // 2
    top = (side - logo_size) // 2

    def rows():
        for y in range(side):
            if top <= y < top + logo_size:
                yield background[: left * 3] + logo[y - top] + background[(left + logo_size) * 3 :]
            else:
                yield background

    for name in ("splash.png", "splash-dark.png"):
        write_png(RESOURCES / name, side, side, rows())
        print(f"  resources/{name}  ({side}×{side})")


def main() -> None:
    RESOURCES.mkdir(parents=True, exist_ok=True)
    for name, size in SIZES.items():
        write_png(RESOURCES / name, size, size, render(size, scale=0.82))
        print(f"  resources/{name}  ({size}×{size})")
    ios_resources()


if __name__ == "__main__":
    main()
