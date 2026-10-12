# L'app iPhone

[← Lacet](../README.md) · [Toute la documentation](README.md)

## Récupérer l'IPA

Une IPA ne se compile qu'avec Xcode, donc sur un Mac. Le dépôt en emprunte un à
GitHub : à chaque modification du front poussée sur `main`, le workflow
**App iPhone (IPA)** lance les tests, construit l'app, génère le projet Xcode,
y applique `frontend/ios-overlay/customize.py` et compile. Compter deux minutes.

L'IPA est jointe à une **publication** du dépôt (`v1.0.<numéro de
compilation>`), et non aux artefacts de l'exécution : ceux-ci ont un quota de
cinq cents mégaoctets sur un dépôt privé, que six compilations suffisaient à
remplir. Elle se télécharge depuis l'onglet **Releases**, ou en ligne de
commande :

```bash
gh release download v1.0.58 --pattern Lacet.ipa
```

Sans numéro, `gh release download --pattern Lacet.ipa` prend la dernière. La
publication reste en **préversion** le temps de la compilation, et ne devient la
dernière qu'une fois l'IPA posée : le lien « Télécharger l'IPA » du README vise
toujours une version complète. Ses notes disent ce qui a changé depuis la
précédente, et comment l'installer.

Elle n'est **pas signée** : c'est l'installateur qui la signe, avec ton
identifiant Apple, au moment de l'installer. Le dossier `ios/` n'est pas
versionné — il est régénéré à chaque compilation, et tout ce qui distingue
Lacet d'un projet Capacitor vierge tient dans `customize.py`, où chaque réglage
dit pourquoi.

## L'installer avec AltStore

**Avec AltStore, pas Sideloadly.** Les deux installent l'app aussi bien ; un
seul signe **l'extension** qu'elle contient. L'activité en direct de l'écran de
verrouillage est dessinée par `LacetWidgets.appex`, et iOS ne lance une
extension que si elle a reçu **son propre** profil de signature, à côté de celui
de l'app. Sideloadly signe l'app et pas son extension : elle reste dans le
paquet, complète et rattachée, et le système l'ignore — pas de vignette dans la
galerie de widgets, une activité en direct acceptée par ActivityKit et dessinée
par personne, écran de verrouillage noir, aucun message. Une soirée entière y
est passée avant que l'app ne sache le dire elle-même.

1. Installe AltServer sur le PC et AltStore sur l'iPhone (iTunes et iCloud
   doivent venir du site d'Apple, pas du Microsoft Store).
2. Mets l'IPA sur le téléphone. Sans entrée « Sideload .ipa » dans AltServer, le
   plus simple est de la servir sur le réseau local :
   `python scripts/altstore_source.py` prépare le dossier `altstore/`, et
   `python -m http.server 8765 --directory altstore` le sert — ce dossier-là,
   jamais la racine du dépôt, qui livrerait `.git` à tout le Wi-Fi. Ouvre
   ensuite l'IPA dans Safari : elle arrive dans **Fichiers → Téléchargements**.
   Mieux, une fois pour toutes : **AltStore → Sources → +** →
   `http://<adresse du PC>:8765/source.json`, et chaque version s'installe
   ensuite d'un « Mettre à jour ». Pour que le dossier soit servi sans y
   penser, `python scripts/altstore_source.py --autostart` pose un lanceur dans
   le dossier Démarrage de Windows : à chaque ouverture de session, le serveur
   repart, sans fenêtre. Servi depuis une session de Claude Code, il mourait
   avec elle, et « Mettre à jour » échouait sans autre explication qu'une
   erreur réseau.
3. **AltStore → Mes apps → +** → l'IPA téléchargée. AltServer doit tourner :
   c'est lui qui signe.
4. Sur l'iPhone : **Réglages → Général → VPN et gestion de l'appareil** → ton
   identifiant → **Faire confiance** ; puis **Confidentialité et sécurité →
   Mode développeur** → activer et redémarrer.

Avec un compte Apple **gratuit**, l'app expire au bout de **7 jours** ; AltStore
la renouvelle tout seul tant qu'AltServer tourne sur le même Wi-Fi. Trois apps
actives au maximum, et **l'extension en consomme une** : Lacet en prend donc
deux.

**Ce que le téléphone sait dire.** « Mon compte → Pendant la sortie » vérifie les
cinq conditions d'une activité en direct — iOS 16.2, activités autorisées dans
Réglages, extension dans le paquet, extension **rattachée** à l'app
(`fr.lacet.app` → `fr.lacet.app.widgets`, sinon iOS refuse de la lancer), et
extension **signée** — et n'écrit que ce qui manque. Un bouton la montre vingt
secondes sans partir courir. La preuve indépendante : poser le widget **Lacet**
depuis la galerie de l'écran d'accueil. S'il s'affiche, l'extension tourne.

## Ce que fait l'app, et qu'une page ne ferait pas

- **Le GPS continue écran verrouillé.** À la première sortie, iOS demande
  l'accès à la position : choisir **Toujours** (ou « Lors de l'utilisation »
  puis « Toujours » quand iOS le repropose). Sans cela, la distance se fige dès
  que le téléphone part dans la poche.
- **Le guidage vocal aussi**, même en mode silencieux. La voix vient d'un
  module écrit pour Lacet (`ios-overlay/live-activity/App/VoicePlugin.swift`) :
  il baisse la musique — et met un podcast en pause — le temps d'une consigne,
  puis rend le son dès que la voix s'est tue. La session audio de repos, elle,
  est réglée dans `AppDelegate` : sans elle, iOS coupe la voix au verrouillage.
- **L'écran reste allumé** pendant la sortie si on le demande, et une vibration
  prévient avant chaque traversée.
- **Le GPX s'exporte par la feuille de partage** d'iOS (Fichiers, AirDrop…) —
  horodaté pour une sortie, pour qu'une montre ou un site y voie une activité.
- **Elle s'ouvre sans réseau** : ses fichiers sont sur le téléphone. Les zones
  déjà explorées se recalculent sans réseau aussi — les rues téléchargées sont
  gardées quatorze jours.
- **Les cartes hors ligne** sont rangées dans IndexedDB et lues directement par
  la carte : WebKit ne fait pas tourner de service worker dans une app, et sans
  ce chemin une carte « gardée » restait noire une fois dehors.
- **L'écran de verrouillage guide.** Pendant une sortie guidée, une activité en
  direct affiche la consigne à venir, sa distance, l'avancée de la boucle, ce
  qui reste et l'heure d'arrivée — aussi dans la Dynamic Island, et sans
  toucher à l'audio : la musique continue. C'est une extension iOS à part
  (`frontend/ios-overlay/live-activity/`), greffée au projet Xcode par
  `add_live_activity.rb` pendant la compilation, et son identifiant se **déduit**
  de celui de l'app pour que le lien ne puisse pas se rompre en silence.

  Elle est écrite pour ne jamais rendre du vide : chaque valeur a un repli, la
  vue porte son propre fond (`containerBackground`, exigé depuis iOS 17), et
  rien n'y peut échouer à l'affichage — un `Text(timerInterval:)` sur une
  arrivée déjà dépassée suffisait à laisser une carte noire, sans trace.
- **Le point de position montre où pointe le téléphone**, par un faisceau
  bleu comme dans Google Maps, en course comme au repos : au premier
  carrefour, on voit tout de suite si l'on part du bon côté. C'est la boussole
  de l'iPhone (`CompassPlugin.swift`), sans autorisation de plus que la
  position ; elle ne tourne que tant que le point est affiché. Sans
  magnétomètre — ou sur une installation d'avant —, le point de course garde
  sa flèche dans le sens du tracé.
- **L'app se présente sous son nom.** Les serveurs Overpass, qui donnent les
  points d'eau, les toilettes et les rues hors des archives, refusent depuis
  l'automne 2026 tout ce qui se présente comme un navigateur : 406 chez
  `overpass-api.de`, 403 chez `overpass.openstreetmap.fr`. L'app s'annonçait
  « Safari iPhone … Lacet/1.0 » (`appendUserAgent`), et les points d'eau ne
  s'affichaient jamais, sans un message. Elle s'annonce désormais « Lacet/1.0 »
  seul (`overrideUserAgent` dans `capacitor.config.json`) ; vérifié le 10
  octobre 2026 sur les douze services qu'elle appelle, qui l'acceptent tous.

## En course, la carte suit comme un GPS

Le sens de la course en haut, la carte inclinée, le coureur placé bas pour voir
ce qui vient. Le cap se lit **sur le tracé**, pas sur la boussole du GPS : à
pied, celle-ci est du bruit, et la carte tournait de trente degrés à chaque
seconde. Déplacer ou tourner la carte au doigt la libère ; « Recentrer » la
reprend. Pincer pour zoomer ne libère rien, et le zoom choisi est gardé.

Pendant la sortie, l'écran change de rôle : la consigne à venir en bandeau, en
haut (le virage, sa distance en très grand, la rue) ; le chrono et les chiffres
en bas ; et sur la droite, les seules commandes utiles en courant — fond de
carte, voix, **orientation** (dans le sens de la course, ou nord en haut, à
plat) et **vue d'ensemble** du parcours. L'activité et les filtres ne se
touchent plus : rien ne change le parcours en pleine course. « Terminer »
n'apparaît qu'en pause, pour qu'un doigt qui glisse n'arrête pas la sortie.

## Hors parcours : un nouveau chemin

Trois relevés GPS de suite à plus de 45 m du tracé : l'app le dit. Et quand
on est parti du mauvais côté — sur la fin de la boucle, à rebours —, elle dit
« Tu pars à contresens du parcours. Fais demi-tour. » plutôt qu'un simple
écart, qui ne disait pas de quel côté repartir (`wrongWay` dans
`routeTracker.js`). Le demi-tour en pleine course, lui, était déjà vu : « Tu
reviens sur tes pas ». Si l'on ne
l'a pas retrouvé vingt secondes plus tard — le temps de contourner des travaux
sans qu'on nous impose un itinéraire — elle en calcule un nouveau, sur
l'appareil, avec les rues déjà chargées (`frontend/src/engine/reroute.js`).

Il ne ramène pas au point le plus proche, mais à celui qui **tient la distance
prévue** : chaque point de la fin de boucle est un candidat, un seul Dijkstra
donne la distance jusqu'à tous, et l'on garde celui où « déjà couru + raccord +
fin de boucle » tombe le plus près de l'objectif, le raccord comptant un peu en
plus. Après un simple écart, on rejoint la boucle devant soi ; après un
raccourci, on va chercher ce qu'on a sauté ; après un grand détour, on rentre
au plus court. Le raccord suit les mêmes préférences que la boucle, ses
consignes se disent comme les autres, et le bouton « Recalculer » n'attend pas
les vingt secondes.

## Les fonds de carte

Huit fonds gratuits et sans clé : Nuit et Clair et Plan (CARTO), Fjord et Rues
(OpenFreeMap), Nature (OpenTopoMap), Satellite (Esri) et le rendu
OpenStreetMap — ce dernier ne se garde pas hors ligne, ses conditions d'usage
l'interdisent. Chaque fond a son aperçu et une phrase qui dit à quoi il sert.

Les fonds **Mapbox** (nuit, nature, satellite, standard) s'ajoutent avec une clé
publique Mapbox (`pk.…`, gratuite jusqu'à un large quota) : dans
`frontend/.env` sous `VITE_MAPBOX_TOKEN=` pour le site, et en secret du dépôt
GitHub du même nom pour l'app iPhone.

## Apple Santé et Strava

**Apple Santé ne marche pas avec AltStore.** Apple ouvre HealthKit aux comptes
gratuits, mais AltStore ne l'active pas : il signe l'app avec les seules
autorisations de son profil, et n'y ajoute que les groupes d'apps. HealthKit
refuserait donc tout, sans erreur visible. Et même installé autrement, Santé
ne mènerait pas à Strava : Strava n'y reprend que les séances de l'app Exercice
d'Apple, pas celles d'une autre app. Il faudrait un compte développeur payant
(99 € par an) pour signer l'app soi-même — et ce serait alors l'occasion de
supprimer aussi le renouvellement tous les sept jours.

**L'envoi direct vers Strava a été retiré** (octobre 2026). Une sortie
s'exporte en GPX horodaté depuis son écran de fin ou sa fiche — l'heure de
chaque point retrouvée par les tours de kilomètre (`frontend/src/runGpx.js`),
pour que l'allure au kilomètre y soit la vraie — et le site de Strava l'importe
(« Téléverser une activité »). Les jetons qu'une version précédente avait
gardés sont effacés au lancement (`frontend/src/main.jsx`).
