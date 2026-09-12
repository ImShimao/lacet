"""Génère les icônes de l'app — la marque Lacet : une boucle et son départ.

Encodeur PNG écrit à la main (zlib + struct de la bibliothèque standard) pour
n'ajouter aucune dépendance au projet. Le rendu se fait en 4× puis est réduit,
ce qui donne un anticrénelage propre sans bibliothèque graphique.

    python scripts/make-icons.py
"""

from __future__ import annotations

import struct
import zlib
from pathlib import Path

# Noir teinté, anneau violet, départ blanc — les couleurs de l'interface.
INK = (0x0A, 0x09, 0x10)
VIOLET = (0x8B, 0x5C, 0xF6)
WHITE = (0xFF, 0xFF, 0xFF)

OUT = Path(__file__).resolve().parent.parent / "public"
SIZES = {
    "icon-180.png": 180,  # apple-touch-icon
    "icon-192.png": 192,
    "icon-512.png": 512,
}
SUPERSAMPLE = 4


def write_png(path: Path, width: int, height: int, rows: list[list[tuple[int, int, int]]]) -> None:
    raw = b"".join(
        b"\x00" + bytes(channel for pixel in row for channel in pixel) for row in rows
    )

    def chunk(kind: bytes, data: bytes) -> bytes:
        body = kind + data
        return struct.pack(">I", len(data)) + body + struct.pack(">I", zlib.crc32(body) & 0xFFFFFFFF)

    header = struct.pack(">IIBBBBB", width, height, 8, 2, 0, 0, 0)  # RGB 8 bits
    png = (
        b"\x89PNG\r\n\x1a\n"
        + chunk(b"IHDR", header)
        + chunk(b"IDAT", zlib.compress(raw, 9))
        + chunk(b"IEND", b"")
    )
    path.write_bytes(png)


def render(size: int) -> list[list[tuple[int, int, int]]]:
    """La marque : un anneau (la boucle) et un point plein (le départ).

    Le point passe devant l'anneau : c'est le départ qu'on pose sur la boucle.
    """
    big = size * SUPERSAMPLE
    centre = big / 2
    ring_radius = big * 0.30
    ring_half_width = big * 0.038
    dot_centre_y = centre + ring_radius
    dot_radius = big * 0.085

    hi: list[list[tuple[int, int, int]]] = []
    for y in range(big):
        row: list[tuple[int, int, int]] = []
        for x in range(big):
            dx = x - centre
            dy = y - centre
            on_ring = abs((dx * dx + dy * dy) ** 0.5 - ring_radius) <= ring_half_width

            ddx = x - centre
            ddy = y - dot_centre_y
            in_dot = (ddx * ddx + ddy * ddy) ** 0.5 <= dot_radius

            row.append(WHITE if in_dot else VIOLET if on_ring else INK)
        hi.append(row)

    # Réduction : moyenne de chaque bloc SUPERSAMPLE × SUPERSAMPLE.
    out: list[list[tuple[int, int, int]]] = []
    block = SUPERSAMPLE * SUPERSAMPLE
    for y in range(size):
        row = []
        for x in range(size):
            r = g = b = 0
            for sy in range(SUPERSAMPLE):
                for sx in range(SUPERSAMPLE):
                    pr, pg, pb = hi[y * SUPERSAMPLE + sy][x * SUPERSAMPLE + sx]
                    r += pr
                    g += pg
                    b += pb
            row.append((r // block, g // block, b // block))
        out.append(row)
    return out


def main() -> None:
    OUT.mkdir(parents=True, exist_ok=True)
    for name, size in SIZES.items():
        write_png(OUT / name, size, size, render(size))
        print(f"  {name}  ({size}×{size})")

    # Version vectorielle pour l'onglet du navigateur.
    (OUT / "icon.svg").write_text(
        '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100">'
        '<rect width="100" height="100" fill="#0A0910"/>'
        '<circle cx="50" cy="50" r="30" fill="none" stroke="#8B5CF6" stroke-width="7.6"/>'
        '<circle cx="50" cy="80" r="8.5" fill="#FFFFFF"/>'
        "</svg>\n",
        encoding="utf-8",
    )
    print("  icon.svg")


if __name__ == "__main__":
    main()
