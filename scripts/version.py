"""Le numéro de version de Lacet, d'après le numéro de run du workflow.

Chaque partie reste sous cent : quand le patch atteint 99, le suivant passe la
version au-dessus et remet le patch à zéro. Le run 104 donne donc 1.1.4 ; le
run 199, 1.1.99 ; le run 200, 1.2.0. Le compteur ne recule jamais, donc une
version déjà publiée n'est jamais remplacée par une plus ancienne.

    python scripts/version.py 104    # 1.1.4
    python scripts/version.py        # lit GITHUB_RUN_NUMBER (dans le workflow)
"""

from __future__ import annotations

import os
import sys


def version(run: int) -> str:
    return f"{1 + run // 10000}.{run // 100 % 100}.{run % 100}"


if __name__ == "__main__":
    print(version(int(sys.argv[1] if len(sys.argv) > 1 else os.environ["GITHUB_RUN_NUMBER"])))
