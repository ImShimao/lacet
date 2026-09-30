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


# Ce qu'AltStore sait nommer, et la clé du paquet qui le déclenche. Il compare
# ce que l'app demande à ce que la source annonce, et prévient quand ça diffère —
# « Lacet requires additional permissions not specified by the source ». C'est
# une bonne chose : on ne veut pas installer une app qui demande plus que ce
# qu'elle dit. Autant que la source dise vrai, en le lisant dans le paquet.
PRIVACY_KEYS = {
    "NSLocationAlwaysAndWhenInUseUsageDescription": "location",
    "NSLocationWhenInUseUsageDescription": "location",
    "NSLocationAlwaysUsageDescription": "location",
    "NSMotionUsageDescription": "motion",
    "NSMicrophoneUsageDescription": "microphone",
    "NSCameraUsageDescription": "camera",
    "NSPhotoLibraryUsageDescription": "photos",
    "NSContactsUsageDescription": "contacts",
    "NSCalendarsUsageDescription": "calendars",
    "NSBluetoothAlwaysUsageDescription": "bluetooth",
}

BACKGROUND_MODES = {
    "audio": ("background-audio", "Le guidage vocal continue pendant la sortie, écran éteint."),
    "fetch": ("background-fetch", "L'app se met à jour en fond."),
    "location": (
        "location",
        "Pendant une sortie, la position continue d'être suivie écran verrouillé.",
    ),
}


def declared(plist: dict) -> list[dict]:
    """Les autorisations que le paquet demande vraiment, dans l'ordre stable."""
    found: dict[str, str] = {}
    for key, kind in PRIVACY_KEYS.items():
        texte = plist.get(key)
        # La plus explicite l'emporte : « toujours et à l'usage » décrit mieux
        # que « à l'usage » ce que l'app fait réellement.
        if texte and (kind not in found or len(texte) > len(found[kind])):
            found[kind] = texte
    for mode in plist.get("UIBackgroundModes", []) or []:
        kind, texte = BACKGROUND_MODES.get(mode, (None, None))
        if kind and kind not in found:
            found[kind] = texte
    return [{"type": kind, "usageDescription": found[kind]} for kind in sorted(found)]


def changelog(build: str) -> str:
    """Ce qui a changé, tel qu'AltStore l'affichera sous « Mettre à jour ».

    « Compilation 58 » ne dit rien : on ne sait pas, le téléphone en main, si
    l'on installe la fin de course automatique ou une correction de typo. Les
    derniers messages de commit le disent — ce dépôt en fait des phrases, et
    c'est exactement ce qu'on veut lire là.

    Ce sont les commits **poussés** qui sont lus, pas ceux d'ici : l'IPA est
    compilée à partir de ce qui est parti sur GitHub, et annoncer un travail
    resté sur le PC ferait chercher dans l'app une chose qui n'y est pas.

    Sans dépôt git sous la main, le numéro de compilation reste : il vaut mieux
    une description pauvre qu'une mise à jour qui échoue.
    """
    try:
        import subprocess

        out = subprocess.run(
            ["git", "log", "-3", "--format=%s", "origin/main"],
            cwd=ROOT,
            capture_output=True,
            text=True,
            encoding="utf-8",
            timeout=10,
        )
        lignes = [l.strip() for l in out.stdout.splitlines() if l.strip()]
        if lignes:
            return "\n".join(f"• {l}" for l in lignes)
    except Exception:
        pass
    return f"Compilation {build}."


def main() -> None:
    host = sys.argv[1] if len(sys.argv) > 1 else lan_address()
    port = sys.argv[2] if len(sys.argv) > 2 else "8765"
    base = f"http://{host}:{port}"

    if not IPA.exists():
        sys.exit(f"{IPA} introuvable — télécharge d'abord l'artefact du workflow.")

    with zipfile.ZipFile(IPA) as ipa:
        plist = plistlib.loads(ipa.read("Payload/Lacet.app/Info.plist"))
    permissions = declared(plist)
    build = plist.get("CFBundleVersion", "1")
    # **Exactement ce que porte le paquet.** AltStore télécharge l'IPA, lit son
    # `Info.plist` et refuse d'installer si la version ne correspond pas à celle
    # annoncée ici : « The downloaded version does not match the version
    # specified by the source ». Annoncer « 1.0.42 » pour un paquet qui dit
    # « 1.0 » (compilation 42) suffit à tout bloquer.
    #
    # Le numéro de compilation, lui, va dans `buildVersion` : c'est ce qui
    # distingue deux paquets de même version et déclenche la mise à jour.
    version = plist.get("CFBundleShortVersionString", "1.0")
    size = IPA.stat().st_size
    date = datetime.fromtimestamp(IPA.stat().st_mtime, timezone.utc).isoformat()
    notes = changelog(build)

    # **Une adresse par version.** Servie toujours sous le même nom, une IPA
    # déjà téléchargée peut resservir — celle d'hier, alors que la source annonce
    # celle d'aujourd'hui, et AltStore refuse : « the downloaded version does not
    # match the version specified by the source ». Le nom porte donc la version,
    # et les anciennes s'effacent.
    copie = ROOT / f"Lacet-{version}.ipa"
    if not copie.exists() or copie.stat().st_size != size:
        copie.write_bytes(IPA.read_bytes())
    for vieille in ROOT.glob("Lacet-*.ipa"):
        if vieille != copie:
            vieille.unlink()
    download = f"{base}/{copie.name}"

    entry = {
        "name": "Lacet",
        "bundleIdentifier": plist.get("CFBundleIdentifier", "fr.lacet.app"),
        "developerName": "Shimao",
        "subtitle": "Des boucles de course depuis ta porte",
        "localizedDescription": DESCRIPTION,
        "iconURL": f"{base}/frontend/resources/icon-192.png",
        "tintColor": "7C3AED",
        "screenshotURLs": [],
        "permissions": permissions,
        # AltStore 1 lit ces clés à la racine de l'app…
        "version": version,
        "buildVersion": build,
        "versionDate": date,
        "versionDescription": notes,
        "downloadURL": download,
        "size": size,
        # …AltStore 2 lit la liste, la plus récente d'abord.
        "versions": [
            {
                "version": version,
                "buildVersion": build,
                "date": date,
                "localizedDescription": notes,
                "downloadURL": download,
                "size": size,
                "permissions": permissions,
            }
        ],
    }

    source = {
        "name": "Lacet",
        "identifier": "fr.lacet.source",
        "subtitle": "Les compilations de Lacet, servies depuis le PC",
        "iconURL": f"{base}/frontend/resources/icon-192.png",
        "tintColor": "7C3AED",
        "apps": [entry],
        "news": [],
    }

    OUT.write_text(json.dumps(source, ensure_ascii=False, indent=2), encoding="utf-8")
    print(f"{OUT} écrit — version {version}, compilation {build}")
    print(f"À ajouter dans AltStore : {base}/source.json")


if __name__ == "__main__":
    main()
