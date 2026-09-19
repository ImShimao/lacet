"""Dessine les flèches de virage posées sur la notification d'écran verrouillé.

    python scripts/make-turn-icons.py

Une notification iOS peut porter une vignette, à droite du texte : c'est elle
qui fait la différence entre « une ligne de texte de plus » et la consigne de
navigation qu'on reconnaît d'un coup d'œil, écran verrouillé, en courant.
WidgetKit dessinerait ces flèches lui-même dans une activité en direct, mais
l'activité n'est pas toujours disponible sur une app installée hors App Store
(voir `LiveActivityPlugin.swift`) : ces images-là, elles, marchent partout.

Elles sont écrites dans `public/turns/`, donc embarquées dans l'app, et
nommées comme les virages du moteur (`navigation.js`) : `right.png`,
`slight_left.png`, `uturn.png`…
"""

from __future__ import annotations

import math
from pathlib import Path

from PIL import Image, ImageDraw

SIZE = 220
STROKE = 24
WHITE = (255, 255, 255, 255)
OUT = Path(__file__).resolve().parent.parent / "public" / "turns"


def canvas() -> tuple[Image.Image, ImageDraw.ImageDraw]:
    image = Image.new("RGBA", (SIZE, SIZE), (0, 0, 0, 0))
    return image, ImageDraw.Draw(image)


def stroke(draw: ImageDraw.ImageDraw, points: list[tuple[float, float]]) -> None:
    """Une polyligne épaisse, aux angles et aux bouts arrondis."""
    draw.line(points, fill=WHITE, width=STROKE, joint="curve")
    radius = STROKE / 2
    for x, y in points:
        draw.ellipse([x - radius, y - radius, x + radius, y + radius], fill=WHITE)


def head(draw: ImageDraw.ImageDraw, tip: tuple[float, float], angle_deg: float) -> None:
    """La pointe de la flèche, orientée selon `angle_deg` (0 = vers le haut)."""
    angle = math.radians(angle_deg)
    length = STROKE * 1.9
    half = STROKE * 1.25
    dx, dy = math.sin(angle), -math.cos(angle)
    bx, by = tip[0] - dx * length, tip[1] - dy * length
    px, py = -dy, dx
    draw.polygon(
        [tip, (bx + px * half, by + py * half), (bx - px * half, by - py * half)],
        fill=WHITE,
    )


def turn(side: int, hook: float = 0.0) -> Image.Image:
    """Un virage : on monte, on tourne. `side` vaut 1 à droite, -1 à gauche.

    `hook` prolonge le virage vers le bas — c'est ce qui distingue « tourne »
    d'un virage franc, à plus de 115°.
    """
    image, draw = canvas()
    x = SIZE / 2 - side * 34
    corner_y = 96 - hook * 6
    end_x = SIZE / 2 + side * 46
    points = [(x, 186), (x, corner_y), (end_x, corner_y)]
    if hook:
        points.append((end_x, corner_y + 40))
        stroke(draw, points)
        head(draw, (end_x, corner_y + 74), 180)
    else:
        stroke(draw, points)
        head(draw, (end_x + side * 34, corner_y), 90 * side)
    return image


def slight(side: int) -> Image.Image:
    image, draw = canvas()
    x = SIZE / 2 - side * 26
    stroke(draw, [(x, 190), (x, 128), (x + side * 46, 82)])
    head(draw, (x + side * 72, 56), 45 * side)
    return image


def straight() -> Image.Image:
    image, draw = canvas()
    stroke(draw, [(SIZE / 2, 190), (SIZE / 2, 78)])
    head(draw, (SIZE / 2, 40), 0)
    return image


def uturn() -> Image.Image:
    image, draw = canvas()
    left, right = 66.0, 154.0
    top = 96.0
    stroke(draw, [(left, 186), (left, top)])
    draw.arc([left, top - 44, right, top + 44], start=180, end=360, fill=WHITE, width=STROKE)
    stroke(draw, [(right, top), (right, 132)])
    head(draw, (right, 168), 180)
    return image


def lap() -> Image.Image:
    image, draw = canvas()
    box = [46, 46, SIZE - 46, SIZE - 46]
    draw.arc(box, start=300, end=210, fill=WHITE, width=STROKE)
    head(draw, (SIZE / 2 + 62, 74), 120)
    return image


def finish() -> Image.Image:
    image, draw = canvas()
    stroke(draw, [(62, 190), (62, 44)])
    cell = 26
    for row in range(3):
        for col in range(3):
            if (row + col) % 2:
                continue
            x0 = 74 + col * cell
            y0 = 46 + row * cell
            draw.rectangle([x0, y0, x0 + cell, y0 + cell], fill=WHITE)
    draw.rectangle([74, 46, 74 + 3 * cell, 46 + 3 * cell], outline=WHITE, width=6)
    return image


def start() -> Image.Image:
    image, draw = canvas()
    draw.polygon([(78, 48), (176, 110), (78, 172)], fill=WHITE)
    return image


def warning() -> Image.Image:
    image, draw = canvas()
    draw.polygon([(110, 36), (196, 184), (24, 184)], outline=WHITE, width=STROKE - 6)
    draw.rectangle([98, 92, 122, 140], fill=WHITE)
    draw.ellipse([98, 150, 122, 174], fill=WHITE)
    return image


ICONS = {
    "straight": straight,
    "right": lambda: turn(1),
    "left": lambda: turn(-1),
    "sharp_right": lambda: turn(1, hook=1),
    "sharp_left": lambda: turn(-1, hook=1),
    "slight_right": lambda: slight(1),
    "slight_left": lambda: slight(-1),
    "uturn": uturn,
    "lap": lap,
    "finish": finish,
    "start": start,
    "warning": warning,
}


if __name__ == "__main__":
    OUT.mkdir(parents=True, exist_ok=True)
    for name, draw_icon in ICONS.items():
        draw_icon().save(OUT / f"{name}.png")
    print(f"{len(ICONS)} flèches écrites dans {OUT}")
