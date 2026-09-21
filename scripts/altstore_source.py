"""Écrit la source AltStore de Lacet, à servir avec l'IPA.

    python scripts/altstore_source.py            # découvre l'IP du PC
    python scripts/altstore_source.py 192.168.1.96 8765

AltStore sait suivre une « source » : un fichier JSON qui décrit une app et où
la télécharger. Ajoutée une fois dans AltStore, elle transforme chaque nouvelle
version en deux touches — *Sources → Lacet → Mettre à jour* — là où il fallait
sinon ouvrir Safari, télécharger l'IPA, la retrouver dans Fichiers, et la poser
dans AltStore.

Le fichier est écrit à côté de `Lacet.ipa`, à la racine du dépôt, et se sert
avec le même petit serveur (`python -m http.server 8765`). Rien n'est publié :
l'adresse est celle du PC sur le réseau local, et elle ne vaut que chez soi.
"""

from __future__ import annotations

import json
import plistlib
import socket
import sys
import zipfile
from datetime import datetime, timezone
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
IPA = ROOT / "Lacet.ipa"
OUT = ROOT / "source.json"

DESCRIPTION = (
    "Des boucles de course et de vélo depuis ta porte, qui évitent les routes "
    "rapides sans trottoir. Jusqu'à douze propositions notées A, B ou C, "
    "guidage vocal tour par tour, écran de verrouillage, recalcul si tu t'en "
    "écartes, et tout qui se calcule sur le téléphone — sans compte ni serveur."
)


def lan_address() -> str:
    """L'adresse du PC sur le réseau local, vue depuis le téléphone."""
    with socket.socket(socket.AF_INET, socket.SOCK_DGRAM) as probe:
        probe.connect(("8.8.8.8", 80))
        return probe.getsockname()[0]


def main() -> None:
    host = sys.argv[1] if len(sys.argv) > 1 else lan_address()
    port = sys.argv[2] if len(sys.argv) > 2 else "8765"
    base = f"http://{host}:{port}"

    if not IPA.exists():
        sys.exit(f"{IPA} introuvable — télécharge d'abord l'artefact du workflow.")

    with zipfile.ZipFile(IPA) as ipa:
        plist = plistlib.loads(ipa.read("Payload/Lacet.app/Info.plist"))
    build = plist.get("CFBundleVersion", "1")
    marketing = plist.get("CFBundleShortVersionString", "1.0")
    # AltStore compare des versions : le numéro de compilation les ordonne.
    version = f"{marketing}.{build}"
    size = IPA.stat().st_size
    date = datetime.fromtimestamp(IPA.stat().st_mtime, timezone.utc).isoformat()

    entry = {
        "name": "Lacet",
        "bundleIdentifier": plist.get("CFBundleIdentifier", "fr.lacet.app"),
        "developerName": "Shimao",
        "subtitle": "Des boucles de course depuis ta porte",
        "localizedDescription": DESCRIPTION,
        "iconURL": f"{base}/frontend/public/icon-192.png",
        "tintColor": "7C3AED",
        "screenshotURLs": [],
        # AltStore 1 lit ces trois clés à la racine de l'app…
        "version": version,
        "versionDate": date,
        "versionDescription": f"Compilation {build}.",
        "downloadURL": f"{base}/Lacet.ipa",
        "size": size,
        # …AltStore 2 lit la liste, la plus récente d'abord.
        "versions": [
            {
                "version": version,
                "date": date,
                "localizedDescription": f"Compilation {build}.",
                "downloadURL": f"{base}/Lacet.ipa",
                "size": size,
            }
        ],
    }

    source = {
        "name": "Lacet",
        "identifier": "fr.lacet.source",
        "subtitle": "Les compilations de Lacet, servies depuis le PC",
        "iconURL": f"{base}/frontend/public/icon-192.png",
        "tintColor": "7C3AED",
        "apps": [entry],
        "news": [],
    }

    OUT.write_text(json.dumps(source, ensure_ascii=False, indent=2), encoding="utf-8")
    print(f"{OUT} écrit — compilation {build}")
    print(f"À ajouter dans AltStore : {base}/source.json")


if __name__ == "__main__":
    main()
