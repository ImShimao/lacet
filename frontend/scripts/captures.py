"""Réduit les captures de `captures.mjs` au format de la doc : 780 px, 256 couleurs.

    python scripts/captures.py

Lit `docs/images/raw/*.png`, écrit `docs/images/<nom>.png`, puis efface les originaux.
À 3×, une capture pèse plus d'un mégaoctet : le README en montre six.
"""

from __future__ import annotations

import shutil
from pathlib import Path

from PIL import Image

IMAGES = Path(__file__).resolve().parents[2] / "docs" / "images"
WIDTH = 780


def main() -> None:
    raw = IMAGES / "raw"
    for path in sorted(raw.glob("*.png")):
        image = Image.open(path).convert("RGB")
        height = round(image.height * WIDTH / image.width)
        small = image.resize((WIDTH, height), Image.LANCZOS).quantize(colors=256, method=Image.MEDIANCUT)
        small.save(IMAGES / path.name, optimize=True)
        print(f"{path.name} : {(IMAGES / path.name).stat().st_size // 1024} Ko")
        path.unlink()
    # OneDrive verrouille parfois le dossier vide : il est ignoré par git, il peut rester.
    shutil.rmtree(raw, ignore_errors=True)


if __name__ == "__main__":
    main()
