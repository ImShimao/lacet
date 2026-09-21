"""Règle le projet Xcode généré par Capacitor pour Lacet.

    python3 ios-overlay/customize.py ios/App

Le dossier `ios/` n'est pas versionné : il est régénéré à chaque compilation
(`npx cap add ios`), sur le Mac de GitHub. Ce qui distingue Lacet d'un projet
Capacitor vierge tient donc ici, appliqué par un script plutôt que retouché à la
main dans Xcode — une retouche manuelle serait perdue à la génération suivante,
et personne ne saurait plus pourquoi l'app marchait.

Chaque réglage échoue bruyamment si le modèle de Capacitor a changé : mieux vaut
une compilation rouge qu'une app qui s'installe et dont le GPS se coupe écran
verrouillé sans que rien ne l'ait signalé.
"""

from __future__ import annotations

import os
import plistlib
import re
import shutil
import sys
from pathlib import Path

APP = Path(sys.argv[1] if len(sys.argv) > 1 else "ios/App") / "App"
OVERLAY = Path(__file__).resolve().parent


def info_plist() -> None:
    path = APP / "Info.plist"
    with path.open("rb") as fh:
        plist = plistlib.load(fh)

    plist["CFBundleDisplayName"] = "Lacet"
    plist["CFBundleShortVersionString"] = os.environ.get("APP_VERSION", "1.0")
    plist["CFBundleVersion"] = os.environ.get("BUILD_NUMBER", "1")

    # Les phrases qu'iOS affiche en demandant l'autorisation. Elles disent à
    # quoi sert la position, et pourquoi en arrière-plan : une demande muette
    # est une demande qu'on refuse.
    plist["NSLocationWhenInUseUsageDescription"] = (
        "Lacet utilise ta position pour partir de là où tu es et suivre ta sortie."
    )
    plist["NSLocationAlwaysAndWhenInUseUsageDescription"] = (
        "Pendant une sortie, Lacet continue de suivre ta position écran verrouillé, "
        "pour la distance et le guidage vocal."
    )
    plist["NSLocationAlwaysUsageDescription"] = plist["NSLocationAlwaysAndWhenInUseUsageDescription"]

    # Ce qui fait l'intérêt de l'app native : le GPS et la voix continuent quand
    # le téléphone est dans la poche. Sans ces deux modes, iOS suspend l'app
    # quelques secondes après le verrouillage de l'écran.
    plist["UIBackgroundModes"] = ["location", "audio"]

    # En portrait : on court téléphone en main ou dans un brassard, et une app
    # qui pivote au moindre mouvement est inutilisable en courant.
    plist["UISupportedInterfaceOrientations"] = ["UIInterfaceOrientationPortrait"]
    plist["UISupportedInterfaceOrientations~ipad"] = ["UIInterfaceOrientationPortrait"]
    plist["UIRequiresFullScreen"] = True

    plist["UIUserInterfaceStyle"] = "Dark"
    plist["ITSAppUsesNonExemptEncryption"] = False

    # L'écran de verrouillage pendant la sortie : la consigne à venir et le
    # temps restant, lisibles sans déverrouiller. Voir `live_activity()`.
    plist["NSSupportsLiveActivities"] = True

    # `lacet://` : l'adresse que la vignette d'écran d'accueil ouvre. Sans ce
    # schéma déclaré, toucher le widget n'ouvre rien du tout.
    plist["CFBundleURLTypes"] = [
        {"CFBundleURLName": "fr.lacet.app", "CFBundleURLSchemes": ["lacet"]}
    ]

    with path.open("wb") as fh:
        plistlib.dump(plist, fh)
    print(f"Info.plist réglé ({path})")


AUDIO_SETUP = """
        // « Annuler la saisie ? » — iOS ouvre cette alerte quand on secoue le
        // téléphone. En courant, le téléphone est secoué en permanence, et la
        // question tombait au milieu d'une sortie, sur une saisie qui n'existe
        // pas : l'app n'a aucun champ de texte à annuler.
        application.applicationSupportsShakeToEdit = false
        // Une version installée par-dessus une autre doit montrer *sa* version.
        // WKWebView garde en cache les fichiers de l'app — page et scripts — et
        // une réinstallation pouvait continuer d'afficher l'interface
        // précédente, sans que rien ne le signale. Au premier lancement d'un
        // nouveau build, on vide donc ce cache-là. Les données de l'app
        // (favoris, historique, cartes gardées) vivent dans le stockage local
        // et IndexedDB, qui ne sont pas touchés.
        let lacetBuild = Bundle.main.infoDictionary?["CFBundleVersion"] as? String ?? ""
        if UserDefaults.standard.string(forKey: "lacet.build") != lacetBuild {
            UserDefaults.standard.set(lacetBuild, forKey: "lacet.build")
            let caches: Set<String> = [
                WKWebsiteDataTypeDiskCache,
                WKWebsiteDataTypeMemoryCache,
                WKWebsiteDataTypeOfflineWebApplicationCache,
            ]
            WKWebsiteDataStore.default().removeData(ofTypes: caches, modifiedSince: .distantPast) {}
        }
        // Session audio du guidage vocal. Le module de synthèse vocale ne la règle
        // pas lui-même : sans elle, iOS coupe la voix dès que l'écran se verrouille,
        // et la rend muette en mode silencieux.
        //
        // `.mixWithOthers` et non `.duckOthers` : baisser la musique pendant une
        // consigne serait plus confortable, mais la synthèse laisse ensuite la
        // session active, et la musique resterait baissée toute la sortie après la
        // première consigne. La voix passe donc par-dessus, à plein volume.
        do {
            try AVAudioSession.sharedInstance().setCategory(.playback, mode: .voicePrompt, options: [.mixWithOthers])
        } catch {
            print("Lacet — session audio indisponible : \\(error)")
        }
"""


def app_delegate() -> None:
    path = APP / "AppDelegate.swift"
    source = path.read_text(encoding="utf-8")
    if "AVAudioSession" in source:
        print("AppDelegate déjà réglé")
        return

    if "import AVFoundation" not in source:
        source = source.replace("import UIKit", "import UIKit\nimport AVFoundation\nimport WebKit", 1)

    pattern = re.compile(r"(didFinishLaunchingWithOptions[^{]*\{)")
    match = pattern.search(source)
    if not match:
        sys.exit("AppDelegate.swift : point d'insertion introuvable — le modèle de Capacitor a changé.")
    source = source[: match.end()] + AUDIO_SETUP + source[match.end() :]
    path.write_text(source, encoding="utf-8")
    print(f"AppDelegate réglé ({path})")


def live_activity() -> None:
    """Pose les fichiers de l'activité en direct et branche son module.

    Les fichiers vont où `add_live_activity.rb` les attend : ce script-là les
    inscrit ensuite dans le projet Xcode, qui ne se modifie pas à la main.

    Le module natif est enregistré par un contrôleur à nous
    (`LacetBridgeViewController`) : le `SceneDelegate` de Capacitor doit donc le
    créer à la place du sien.
    """
    source = OVERLAY / "live-activity"
    for swift in (source / "App").glob("*.swift"):
        shutil.copy(swift, APP / swift.name)
    shutil.copytree(source / "LacetWidgets", APP.parent / "LacetWidgets", dirs_exist_ok=True)

    scene = APP / "SceneDelegate.swift"
    code = scene.read_text(encoding="utf-8")
    if "LacetBridgeViewController()" not in code:
        if "CAPBridgeViewController()" not in code:
            sys.exit("SceneDelegate.swift : contrôleur introuvable — le modèle de Capacitor a changé.")
        code = code.replace("CAPBridgeViewController()", "LacetBridgeViewController()", 1)
        scene.write_text(code, encoding="utf-8")
    print(f"Activité en direct posée ({APP.parent / 'LacetWidgets'})")


if __name__ == "__main__":
    if not (APP / "Info.plist").exists():
        sys.exit(f"Projet iOS introuvable dans {APP} — lance d'abord « npx cap add ios ».")
    info_plist()
    app_delegate()
    live_activity()
