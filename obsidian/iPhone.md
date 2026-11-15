---
type: categorie
tags: [iphone, livraison]
---

# iPhone : livraison, installation, natif

Retour : [[Accueil]] · Source : `docs/app-iphone.md`, `docs/guidage.md`

## Livrer l'IPA

Une IPA ne se compile qu'avec Xcode, donc sur un Mac. Le dépôt en emprunte un à GitHub.

1. **Compilation** : à chaque push sur `main` qui touche `frontend/`, le workflow `.github/workflows/ios.yml` lance les tests, construit l'app, génère le projet Xcode, y applique `frontend/ios-overlay/customize.py`, compile. Environ deux minutes. Manuel : `gh workflow run ios.yml`.
2. **Suivi** : `gh run list --workflow ios.yml`, `gh run view <id> --log-failed`.
3. **Publication** : l'IPA est jointe à une publication `v1.0.<numéro>`, pas aux artefacts (quota de 500 Mo sur un dépôt privé, que six compilations remplissaient). La publication reste en préversion le temps de la compilation. Le lien « Télécharger l'IPA » du README vise toujours une version complète.
4. **Télécharger** : `gh release download v1.0.<n> --pattern Lacet.ipa`. Sans numéro, la dernière.
5. **Source AltStore** : remplacer `Lacet.ipa` à la racine, puis `python scripts/altstore_source.py`. Ce script prépare `altstore/`, **le seul dossier servi**. Ne jamais servir la racine : elle livrerait `.git` à tout le Wi-Fi.
6. **Service permanent** : `python scripts/altstore_source.py --autostart` pose un lanceur dans le dossier Démarrage de Windows. Servi depuis une session Claude Code, le serveur mourait avec elle, et « Mettre à jour » échouait sans message clair. Vérifier : `curl http://192.168.1.96:8765/source.json`.

L'IPA **n'est pas signée** : c'est l'installateur qui la signe avec ton identifiant Apple, au moment de l'installer. `frontend/ios/` n'est pas versionné, il est régénéré à chaque compilation.

## Installer

- **Outil** : SideStore depuis le 2026-10-19. `docs/app-iphone.md` est à jour, mais sa procédure vient de guides tiers : la vérifier sur sidestore.io. Le `README.md` parle encore d'AltStore (voir [[Taches]]).
- **Sideloadly ne convient pas** : il signe l'app mais **pas son extension**. L'activité en direct est dessinée par `LacetWidgets.appex`, qui n'est lancée qu'avec son propre profil de signature. Sans lui : pas de vignette, activité acceptée et dessinée par personne, écran verrouillé noir, aucun message. Une soirée a été perdue à le découvrir.
- **Pas de HealthKit** : ni AltStore ni SideStore n'activent HealthKit. Et même installé autrement, Santé ne mène pas à Strava (Strava n'y reprend que les séances de l'app Exercice d'Apple). Il faudrait un compte développeur payant (99 € par an).
- **Expiration** : compte gratuit = 7 jours, renouvelé tout seul tant qu'AltServer tourne sur le même Wi-Fi. Trois apps actives au maximum, l'extension en compte une : Lacet en prend deux.
- **Diagnostic dans l'app** : « Mon compte › Pendant la sortie » vérifie les cinq conditions d'une activité en direct (iOS 16.2, activités autorisées, extension dans le paquet, rattachée `fr.lacet.app` → `fr.lacet.app.widgets`, signée) et ne corrige que ce qui manque. Preuve indépendante : poser le widget **Lacet** depuis la galerie.

## Natif : ce que la page ne ferait pas

- **Plugins Swift** (`frontend/ios-overlay/live-activity/App/`) :
  - `AltimeterPlugin` : baromètre, dénivelé mesuré pendant la sortie (lissage 4 s, seuil 1 m).
  - `CompassPlugin` : boussole, faisceau bleu sur le point de position.
  - `LiveActivityPlugin` : activité en direct sur l'écran verrouillé et la Dynamic Island.
  - `VoicePlugin` : voix iOS, baisse la musique ou le podcast le temps d'une consigne.
  - `LacetBridgeViewController` : pont avec la page.
- **Configuration** : `customize.py` (chaque réglage y dit pourquoi), `info_plist`, `app_delegate`. La session audio de repos est réglée dans `AppDelegate` : sans elle, iOS coupe la voix au verrouillage.
- **Extension** greffée au projet Xcode par `add_live_activity.rb` à la compilation. Son identifiant se **déduit** de celui de l'app, pour que le lien ne puisse pas se rompre en silence.
- **Le GPS continue écran verrouillé** : à la première sortie, choisir **Toujours** (sinon la distance se fige dans la poche).
- **Activité en direct** : consigne à venir, distance, avancée, temps restant, heure d'arrivée. Chaque valeur a un repli, la vue porte son fond (`containerBackground`, exigé depuis iOS 17). Un `Text(timerInterval:)` sur une arrivée dépassée suffisait à laisser une carte noire.
- **Le GPX** s'exporte par la feuille de partage d'iOS, horodaté pour qu'une montre ou un site y voie une activité.
- **Overpass refuse les navigateurs** depuis l'automne 2026 (406 chez `overpass-api.de`, 403 chez `overpass.openstreetmap.fr`). L'app s'annonce donc « Lacet/1.0 » (`overrideUserAgent` dans `capacitor.config.json`), et non plus « Safari iPhone ». Sans cela, les points d'eau ne s'affichaient jamais.

## Règles d'interface iPhone

- **Portrait uniquement** (`customize.py`).
- **`maximum-scale=1` et champs ≥ 16 px** dans `index.html`. Sans cela, iOS zoome toute l'app au toucher. Voir [[Decisions]].
- **Cartes hors ligne** : rangées dans IndexedDB et lues directement par la carte. WebKit ne fait pas tourner de service worker dans une app.

## Fichiers générés, à ne pas éditer

`frontend/ios/`, `frontend/dist/`, `*.ipa`, `altstore/`, `frontend/public/region/`.

## Liens

[[Donnees]] · [[Performances]] · [[Dev]] · [[Decisions]] · [[Taches]]
