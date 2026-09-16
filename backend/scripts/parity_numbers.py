"""Oracle numérique pour le portage JavaScript du moteur.

    python scripts/parity_numbers.py

Écrit `frontend/src/engine/__fixtures__/numbers.json` : des milliers de calculs
faits **par CPython lui-même**, que `engine/py.test.js` rejoue en JavaScript.
C'est la seule façon honnête de vérifier qu'une réimplémentation du modulo, de
l'arrondi ou de la somme se comporte comme l'original — pas comme sa
documentation.

Les valeurs sont tirées au hasard avec une graine fixe, et complétées par les
cas limites qui font diverger les deux langages.
"""

from __future__ import annotations

import json
import math
import random
from pathlib import Path

OUT = Path(__file__).resolve().parents[2] / "frontend" / "src" / "engine" / "__fixtures__" / "numbers.json"

rng = random.Random(20260916)


def floats(n: int) -> list[float]:
    out: list[float] = []
    for _ in range(n):
        kind = rng.random()
        if kind < 0.3:
            out.append(rng.uniform(-720, 720))
        elif kind < 0.5:
            out.append(rng.uniform(-1, 1) * 10 ** rng.randint(-6, 6))
        elif kind < 0.7:
            # demi-unités et quarts exacts : là où les arrondis divergent
            out.append(rng.randint(-2000, 2000) / rng.choice([2, 4, 8, 16, 20, 40]))
        else:
            out.append(rng.uniform(0, 400))
    return out


EDGE = [0.0, -0.0, 0.5, 1.5, 2.5, -2.5, 0.125, 0.375, 2.675, 1.005, 359.9999999999, 360.0,
        -1e-20, 1e-20, 0.49999999999999994, 4.5, 5.5, -0.5, 22.5, 67.5, 1.0, 0.1, 0.3]

xs = floats(4000) + EDGE
divisors = [360.0, 45.0, 5.0, 0.1, 400.0, 80.0, 50.0, 200.0, 500.0, -360.0, 3.0, 25.0, 7.5]

cases_mod = []
cases_floordiv = []
for x in xs:
    for d in rng.sample(divisors, 3):
        cases_mod.append([x, d, x % d])
        cases_floordiv.append([x, d, x // d])
for x in EDGE:
    for d in divisors:
        cases_mod.append([x, d, x % d])
        cases_floordiv.append([x, d, x // d])

cases_round_int = [[x, round(x)] for x in xs]
cases_round = [[x, n, round(x, n)] for x in xs for n in (1, 3, 6)]
cases_fixed = [[x, n, format(x, f".{n}f")] for x in xs for n in (0, 1, 2)]

cases_sum = []
for _ in range(600):
    k = rng.randint(1, 60)
    values = [rng.uniform(-1, 1) * 10 ** rng.randint(-3, 7) for _ in range(k)]
    cases_sum.append([values, sum(values)])
cases_sum.append([[0.1] * 10, sum([0.1] * 10)])
cases_sum.append([[1e16, 1.0, -1e16], sum([1e16, 1.0, -1e16])])

cases_trig = []
for x in floats(1500):
    r = math.radians(x)
    cases_trig.append({
        "x": x,
        "radians": r,
        "degrees": math.degrees(x),
        "sin": math.sin(r),
        "cos": math.cos(r),
        "atan2": math.atan2(x, 1.7),
        "sqrt": math.sqrt(abs(x)),
        "hypot": math.hypot(x, 3.3),
    })

OUT.parent.mkdir(parents=True, exist_ok=True)
OUT.write_text(
    json.dumps({
        "mod": cases_mod,
        "floordiv": cases_floordiv,
        "round_int": cases_round_int,
        "round": cases_round,
        "fixed": cases_fixed,
        "sum": cases_sum,
        "trig": cases_trig,
    }),
    encoding="utf-8",
)
print(f"{OUT} : {len(cases_mod)} modulos, {len(cases_round)} arrondis, "
      f"{len(cases_sum)} sommes, {len(cases_trig)} calculs trigonométriques")
