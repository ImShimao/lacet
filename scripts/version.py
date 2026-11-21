"""Le numéro de version de Lacet : celui qui suit la dernière version publiée.

Chaque partie reste sous cent : après 1.1.99 vient 1.2.0, après 1.99.99, 2.0.0.
Le numéro suit les publications, pas le compteur de runs du workflow : un run
qui échoue ou qu'on annule n'en consomme plus (le run 109, en échec, avait fait
passer de 1.1.8 à 1.1.10).

    python scripts/version.py --after v1.1.10    # 1.1.11
    python scripts/version.py --after v1.1.99    # 1.2.0
"""

from __future__ import annotations

import sys


def bump(previous: str) -> str:
    major, minor, patch = (int(p) for p in previous.lstrip("v").split("."))
    patch += 1
    if patch == 100:
        minor, patch = minor + 1, 0
    if minor == 100:
        major, minor = major + 1, 0
    return f"{major}.{minor}.{patch}"


if __name__ == "__main__":
    assert bump("v1.1.10") == "1.1.11" and bump("1.1.99") == "1.2.0" and bump("1.99.99") == "2.0.0"
    print(bump(sys.argv[sys.argv.index("--after") + 1]))
