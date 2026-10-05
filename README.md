# Lacet

**Des boucles de course qui reviennent à ta porte — sans longer la nationale.**

Tu sors courir 10 km. Tu ne veux pas réfléchir à l'itinéraire, tu ne veux pas
finir sur un bas-côté à 80 km/h, et tu veux revenir chez toi. Lacet fait ça :
tu donnes une distance, il propose des boucles, il te dit lesquelles sont sûres,
et il te guide à la voix pendant que tu cours.

```
Distance ou durée  →  jusqu'à 12 boucles notées A, B ou C  →  guidage vocal, écran verrouillé
```

---

## Ce qu'il fait

**Il trouve des boucles, pas des allers-retours.** Douze propositions par
recherche au plus, choisies pour partir dans des directions différentes, à la
distance demandée — 10 km, un semi au mètre près (21,0975 km), ou une durée.
Chaque boucle est mesurée, notée, et **rejetée** si elle ne passe pas le
contrôle : l'app dit aussi ce qu'elle a écarté, et pourquoi.

**Il refuse les routes dangereuses.** Chaque tronçon est évalué : vitesse de la
voie, trottoir ou piste séparée, éclairage la nuit, traversées protégées ou non.
Une boucle notée **A** est presque entièrement protégée ; une **C** demande de
la vigilance, et l'app montre exactement où.

**Il guide comme un GPS.** La carte suit ta course, inclinée dans ton sens. Le
prochain virage s'affiche en grand, et la voix l'annonce deux fois — à l'avance,
puis au moment d'agir — en baissant ta musique le temps de parler. Écran
verrouillé, la consigne, la distance et l'heure d'arrivée restent lisibles dans
une activité en direct.

**Il ne te lâche pas si tu t'écartes.** Un virage raté, une rue barrée : au bout
de vingt secondes hors du tracé, il calcule un nouveau chemin depuis là où tu
es — sur le téléphone, sans réseau — en essayant de **tenir la distance
prévue**.

**Il marche sans réseau.** Les rues d'Alsace sont livrées avec l'app ; ailleurs,
elles se téléchargent une fois et restent. Le fond de carte se garde parcours
par parcours. Une sortie en montagne, sans antenne, fonctionne.

**Il garde ce que tu as couru.** À l'arrivée, un écran de fin : distance, temps,
allure, dénivelé, l'écart avec le parcours prévu, et **ta trace réelle** sur la
carte, qui s'exporte en GPX horodaté — pour une montre, Garmin Connect ou le
site de Strava. Et si l'app est fermée en plein effort, par iOS ou par une
batterie vide, elle propose de reprendre la sortie là où elle s'est arrêtée.

**Il sait où boire.** Coche « Point d'eau » ou « Toilettes » dans « Mon
compte » : ceux qui bordent la boucle apparaissent sur la carte, le détail dit
le plus long tronçon sans, et pendant la sortie la voix prévient cent mètres
avant.

**Il n'envoie rien.** Pas de compte, pas de serveur, pas de suivi. Tes favoris,
tes sorties et tes réglages ne quittent pas l'appareil — une sauvegarde
s'exporte en un fichier si tu veux les emporter.

Et le reste, qui compte le jour où il sert : départs enregistrés (« Chez moi »,
« Le club ») à une touche, pause automatique aux feux, alerte
avant chaque traversée non protégée, bouton SOS qui prépare un SMS avec ta
position, export GPX horodaté vers une montre, profil de dénivelé consultable
en pleine sortie, historique avec totaux mensuels.

## L'installer

**Sur iPhone.** L'app se compile toute seule sur GitHub et s'installe avec
[AltStore](https://altstore.io) — pas besoin de Mac.

```bash
gh release download v1.0.<numéro de compilation> --pattern Lacet.ipa
```

Puis AltStore → **Mes apps → +** → `Lacet.ipa`. Le détail, et pourquoi AltStore
plutôt qu'un autre installateur, est dans [L'app iPhone](#lapp-iphone).

Lacet n'existe que sur iPhone. Il y a eu un site web et une mise en page pour
ordinateur ; ils sont partis : personne ne court avec son PC, et chaque écran
existait en trois versions pour une seule qui servait.

## Comment c'est fait

**Tout tourne sur l'appareil.** Le moteur — données OpenStreetMap, graphe,
sécurité, génération, notation — est écrit en JavaScript et s'exécute dans un
*worker*, sur le téléphone. Rien à héberger, rien à
payer : l'app va chercher elle-même les rues sur Overpass, l'altitude à l'IGN,
le vent chez Open-Meteo, et garde ce qu'elle a téléchargé.

**Une app iPhone écrite en React.** L'interface est une page (React +
MapLibre) emballée par Capacitor, et tout ce qu'une page ne sait pas faire passe
par des modules natifs : GPS et voix écran verrouillé, activité en direct,
vibrations, feuille de partage (`src/native.js`). Une seule mise en page, celle
du téléphone tenu droit ; sur iPad, iOS l'ouvre en mode iPhone.

```
frontend/             React + MapLibre — l'app, et le moteur (src/engine/)
frontend/ios-overlay/ réglages iOS appliqués au projet Xcode généré
backend/              Python — le moteur de référence
.github/workflows/    compilation de l'IPA sur un Mac de GitHub
```

**Pourquoi un moteur Python en plus ?** C'est la référence. Le portage
JavaScript note la *sécurité* des parcours : subtilement faux, il proposerait un
« A » là où il faudrait un « C », et rien à l'écran ne le montrerait.
`backend/scripts/parity_dump.py` fait tourner Python sur dix cas réels — Beaune,
Lyon, damiers artificiels ; jour, nuit, vent, vélo, tours — et
`frontend/src/engine/parity.test.js` exige du JavaScript le même graphe, les
mêmes candidats arête par arête et la même réponse, à 1e-9 près. Ce qui a
demandé de reproduire l'arithmétique de CPython jusqu'au modulo flottant et à
l'arrondi au pair.

Les archives de rues couvrent la France, la Suisse, la Belgique et le
Luxembourg, l'Allemagne du Sud-Ouest, l'Italie du Nord-Ouest, l'Espagne du
Nord-Est, l'Autriche, les Pays-Bas et le Portugal. Ailleurs, les rues viennent
d'Overpass, et un calculateur public prend le relais quand il ne répond pas.
Ajouter un pays se fait dans `zones.json` du dépôt de données ; quand celui-ci
approchera des cinq gigaoctets que GitHub tolère, la suite ira dans un second
dépôt, dont l'adresse s'ajoute à `SOURCES` (voir `engine/archive.js`).

Aucune clé d'API n'est nécessaire. Données © OpenStreetMap (Overpass et les
archives de `lacet-data`), altitude IGN puis Valhalla — OpenTopoData côté
serveur, qui n'envoie pas d'en-têtes CORS —, itinéraire de secours Valhalla,
vent Open-Meteo, fond de carte CARTO, recherche de lieux Photon (Komoot) et
Nominatim — plus Mapbox pour les commerces, si un token est présent :
OpenStreetMap ignore les enseignes ouvertes trop récemment.

## Le détail, section par section

| | |
|---|---|
| [Démarrer](#démarrer-première-fois) · [Lancer](#lancer) · [Tester](#tester-dans-vs-code) | installer les dépendances, lancer l'app, faire tourner les tests |
| [L'app iPhone](#lapp-iphone) | compiler l'IPA, l'installer avec AltStore, ce que le natif ajoute |
| [Le moteur de sécurité](#le-moteur-de-sécurité) · [La note A, B, C](#la-note-a-b-c) | comment un tronçon est jugé, et d'où vient la note |
| [L'algorithme de génération](#lalgorithme-de-génération) · [Le choix des propositions](#le-choix-des-propositions) | comment les boucles naissent, et lesquelles survivent |
| [Les tours](#quand-la-distance-ne-tient-pas--les-tours) · [Le vent](#le-vent) · [Le dénivelé](#la-préférence-de-dénivelé) | les cas particuliers |
| [Le guidage](#le-guidage) · [La sortie](#la-sortie) | les consignes, le suivi GPS, le hors-parcours |
| [Interface](#interface) · [Réglages](#réglages) | ce qui se voit et ce qui se règle |
| [Performances](#performances) · [Limites](#limites-dites-franchement) | ce que ça coûte, et ce que ça ne sait pas faire |

---

## Démarrer (première fois)

```bash
cd frontend
npm install
```

Et pour le moteur de référence Python, une fois :

```bash
cd backend
python -m venv .venv
.venv\Scripts\python.exe -m pip install -r requirements-dev.txt
```

---

## Lancer

```powershell
cd frontend; npm run dev
```

Puis **http://127.0.0.1:5173**, à la taille d'un téléphone (les outils de
développement du navigateur, ou l'aperçu de l'éditeur). C'est l'interface, pour
la développer — pas l'app : le GPS, la voix, l'écran de verrouillage, le
baromètre et les vibrations n'existent que dans l'app installée. La position y est donc
toujours « indisponible », et l'app retombe sur le dernier départ choisi.

Le moteur de référence Python n'a plus de serveur : l'app calcule tout sur le
téléphone. Il s'interroge par ses tests, par `scripts/smoke.py` (plus bas), et
par `scripts/parity_dump.py`, qui écrit la réponse que le moteur de l'app doit
reproduire.

---

## Tester dans VS Code

**Débogage** — `F5`, puis choisis une configuration :

| Configuration | Ce qu'elle fait |
|---|---|
| Backend — tests | Lance pytest en mode debug. |
| Backend — test réel sur une ville | Génère de vraies boucles sur Paris et affiche le résultat dans le terminal. |
| Front — Chrome | Ouvre Chrome attaché au débogueur, points d'arrêt dans le JSX. |

**Tests** — la suite Python du moteur de référence, et 544 côté app (moteur
JavaScript et interface). `Ctrl+Shift+P → Exécuter la tâche → Lacet — tous les
tests` lance les deux ; l'onglet « Test » permet de rejouer un cas à la fois. En
ligne de commande :

```powershell
cd backend; .venv\Scripts\python.exe -m pytest
```

```powershell
cd frontend; npm test
```

GitHub les relance à chaque envoi (`.github/workflows/tests.yml`), avec
`scripts/parity_dump.py --check` : un changement du moteur Python dont l'oracle
de parité n'a pas été refait fait échouer la vérification, au lieu de laisser le
JavaScript se comparer à l'ancienne réponse.

Les tests d'interface portent sur ce qui tourne **pendant** la sortie, sans
personne pour le regarder : le suivi de position sur le tracé, la formulation
des consignes vocales, et ce qu'on garde d'un parcours enregistré. Ce sont les
seuls endroits où une erreur ne se voit pas tout de suite — elle se vit sur le
terrain, à un carrefour.

C'est d'ailleurs en les écrivant qu'est apparu un défaut qui traînait :
l'allure affichait **« 4:60 »** dès qu'elle tombait dans la dernière
demi-seconde d'une minute, en gros chiffres au milieu de l'écran, et l'annonce
vocale disait « quatre minutes soixante ». Séparer les minutes des secondes
avant d'arrondir, plutôt qu'après, suffisait à le produire.

**Essayer sur une vraie ville** — c'est le test le plus utile, il appelle
réellement OpenStreetMap :

```powershell
cd backend; .venv\Scripts\python.exe scripts/smoke.py annecy 8
```

Villes préréglées : `paris`, `lyon`, `toulouse`, `annecy`. Ou des coordonnées
libres : `scripts/smoke.py 47.2184 -1.5536 12`.

Le script affiche les itinéraires retenus, leur note, **et** ceux qui ont été
écartés avec le motif. Le premier appel télécharge les données (10 à 30 s selon
la ville) ; les suivants sortent du cache disque et sont quasi instantanés.

---

## L'app iPhone

### Récupérer l'IPA

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

Elle n'est **pas signée** : c'est l'installateur qui la signe, avec ton
identifiant Apple, au moment de l'installer. Le dossier `ios/` n'est pas
versionné — il est régénéré à chaque compilation, et tout ce qui distingue
Lacet d'un projet Capacitor vierge tient dans `customize.py`, où chaque réglage
dit pourquoi.

### L'installer avec AltStore

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
   plus simple est de la servir sur le réseau local — `python -m http.server`
   à la racine du dépôt — puis de l'ouvrir dans Safari : elle arrive dans
   **Fichiers → Téléchargements**.
3. **AltStore → Mes apps → +** → `Lacet.ipa`. AltServer doit tourner : c'est lui
   qui signe.
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

### Ce que fait l'app, et qu'une page ne ferait pas

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

### En course, la carte suit comme un GPS

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

### Hors parcours : un nouveau chemin

Trois relevés GPS de suite à plus de 45 m du tracé : l'app le dit. Si l'on ne
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

### Les fonds de carte

Huit fonds gratuits et sans clé : Nuit et Clair et Plan (CARTO), Fjord et Rues
(OpenFreeMap), Nature (OpenTopoMap), Satellite (Esri) et le rendu
OpenStreetMap — ce dernier ne se garde pas hors ligne, ses conditions d'usage
l'interdisent. Chaque fond a son aperçu et une phrase qui dit à quoi il sert.

Les fonds **Mapbox** (nuit, nature, satellite, standard) s'ajoutent avec une clé
publique Mapbox (`pk.…`, gratuite jusqu'à un large quota) : dans
`frontend/.env` sous `VITE_MAPBOX_TOKEN=` pour le site, et en secret du dépôt
GitHub du même nom pour l'app iPhone.

---

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

---

## Le moteur de sécurité

C'est le cœur du produit. Six couches, dans `backend/app/safety/`.

**L0 — exclusion** (`exclusion.py`). Autoroutes, voies rapides, tunnels sans
trottoir, chemins interdits aux piétons : retirés du graphe. Pas pénalisés,
**absents**. Aucune pondération ne peut les faire revenir.

**L1 — le risque** (`risk.py`) :

```
risque = ((v − 40) / 30)² × (1 − sep / 2)
```

Le seuil de 40 km/h est le calibrage central : en dessous, courir sur la chaussée
est normal, et une app qui imposerait un détour serait inutilisable.

| Voie | risque | verdict |
|---|---|---|
| Rue à 30, ou trottoir | 0 | — |
| Rue à 50 sans trottoir | 0,11 | normal |
| Route à 70 sans trottoir | 1,00 | acceptable |
| Route à 80 avec accotement | 0,89 | acceptable |
| Route à 80 sans rien | 1,78 | **exposé** |
| Voie rapide | — | exclue en L0 |

La séparation dépend du sport : un trottoir protège un coureur, pas un cycliste —
lui a besoin d'une bande ou d'une piste cyclable. Une piste cyclable, elle, protège
les deux : pas de voitures.

**Chaque sport ses droits d'accès.** À vélo, ce qui ouvre ou ferme une voie se lit
sur `bicycle`, pas sur `foot` : une piste interdite aux piétons (`foot=no`) reste à
lui, un `access=no` se rouvre par `bicycle=yes`. Et **les sens uniques
s'appliquent à vélo** (`oneway`, giratoires), sauf contresens cyclable
(`oneway:bicycle=no`, bandes `opposite`). Mesuré dans le centre de Lyon : avant,
les trente-deux boucles vélo candidates remontaient toutes un sens interdit — dix-sept
kilomètres en tout ; après, aucune. À pied, rien ne change : un sens unique ne
s'impose pas au piéton. Une boucle vélo qui emprunte un sens unique ne se propose
pas « dans l'autre sens ».

**Voies sans voitures d'abord** — une case des filtres, cochée par défaut, propre
à l'app (`engine/weights.js`). La sécurité seule ne départage pas une piste d'une
rue à 30 : le moteur prenait la plus courte, et longeait une zone commerciale à
Guebwiller plutôt que la piste cyclable d'à côté. Pistes, chemins et allées
coûtent désormais 0,6 fois leur longueur ; la route ne sert que là où il n'y a
pas d'autre passage, ou pour varier les boucles. Sur cet exemple : 890 m sur la
piste au lieu de 197, pour 78 m de plus. Le trottoir dessiné à part ne compte
pas — il longe la rue.

**L2 — la règle du doute** (`risk.py`). Le tag `sidewalk` manque sur la majorité
des rues françaises. L'inférence est **asymétrique** : trottoir probable en zone
bâtie à 50 km/h ou moins, aucun trottoir supposé ailleurs. Un faux positif en
ville est gênant ; en rase campagne il est dangereux. En cas de doute, on pénalise.

**L3 — le portail** (`gate.py`). Une bonne pondération ne suffit pas : le routeur
empruntera quand même 800 m de départementale s'il n'a pas mieux. Contrôle après
génération, règles binaires, un candidat qui échoue est **jeté**.

| Critère (mode Sûr) | À pied | À vélo |
|---|---|---|
| Part du parcours exposée | > 3 % | > 8 % |
| Portion exposée continue | > 150 m | > 1 000 m |
| Traversées non protégées, sortie ≤ 10 km | > 2 | > 3 |
| … par tranche de 10 km au-delà | +4 | +5 |
| Tunnel sans trottoir | > 0 m | > 0 m |
| Écart de bouclage | > 50 m | > 50 m |
| Tracé parcouru deux fois | > 25 % | > 25 % |

Le seuil de portion continue est le plus important : traverser une
départementale sur 20 m va, la longer sur 900 m non. Un critère en pourcentage
seul laisse passer le second.

**Pourquoi les seuils dépendent du sport.** Un coureur peut presque toujours
éviter une départementale — trottoir, chemin, rue parallèle. Un cycliste roule
sur la chaussée par définition : sur une boucle de 80 km au départ de Lyon, il
n'existe aucun itinéraire sans plusieurs kilomètres de départementale. Avec les
seuils de la course, le mode Sûr rejetait **tout** — onze candidats sur quinze
pour ce seul motif — et l'app ne proposait rien. Un mode qui ne rend jamais de
résultat ne protège personne.

**Pourquoi le budget de traversées grandit avec la distance.** Un nombre fixe ne
peut pas couvrir une plage de 0,8 à 250 km. La mesure sur des villes réelles est
sans ambiguïté :

| | Traversées non protégées, par 10 km |
|---|---|
| Lyon, 10 km à pied | 0 |
| Lyon, 30 km à vélo | 0 à 1 |
| Semi-marathon en Bourgogne | 5,7 à 11,4 |
| 80 km à vélo au départ de Lyon | 4,4 à 12,2 |

En ville, le seuil ne sert jamais. En rase campagne, il rejetait absolument tout,
y compris les meilleurs candidats disponibles. Le supplément ne démarre donc
qu'au-delà de 10 km — une sortie urbaine garde exactement les seuils d'avant — et
l'écart entre candidats reste discriminant : sur 80 km à vélo ils s'étalent de 35
à 98 traversées, et le portail continue d'écarter la moitié la moins bonne.

**L4 — la nuit** (`night.py`). Un modèle distinct, qui inverse le premier. De
jour on s'éloigne du trafic ; de nuit, un sentier isolé devient le pire choix.

**L5 — la forme** (`geo.roundness`). Le quotient isopérimétrique `4πA/P²`
distingue une boucle d'un aller-retour dont le retour passe par la rue parallèle :
ce dernier ne se recoupe jamais, donc le critère de recouvrement ne le voit pas.

---

## La note A, B, C

La lettre affichée sur chaque proposition résume **la sécurité du tracé, et
elle seule** — pas sa beauté, pas sa longueur, pas son dénivelé.

| Note | Condition |
|---|---|
| **A** | Au plus 1 % du parcours au contact direct du trafic, **et aucune** traversée non protégée. |
| **B** | Au plus 3 % au contact du trafic. C'est aussi la note d'une boucle sans aucune exposition mais qui traverse une voie rapide sans passage protégé. |
| **C** | Au-delà. N'apparaît qu'en mode Standard : le portail du mode Sûr rejette ces tracés. |

« Au contact du trafic » a un sens précis : un tronçon dont le risque dépasse
1,5, c'est-à-dire une route à 80 km/h ou plus sans trottoir ni accotement. Une
rue à 50 et une route à 70 n'y entrent pas — sinon la note serait C partout et
ne dirait plus rien.

En mode Sûr à pied, l'exposition est plafonnée à 3 % par le portail : **un B y
signale donc presque toujours une traversée**, pas une portion longée. Le détail
sous la proposition dit lequel des deux.

**Les propositions sont classées par note d'abord.** Une A passe toujours devant
une B, même si la B est plus ronde, mieux calibrée ou dans une direction plus
originale. Ce n'était pas le cas jusqu'ici : les traversées non protégées
comptaient dans la note sans compter dans le score, et l'app pouvait afficher un
B en tête suivi de A — se contredisant sous les yeux de l'utilisateur. À note
égale, le score départage : distance, exposition fine, forme, variété, dénivelé.

## L'algorithme de génération

`backend/app/routing/loops.py`

Le principe tient en une idée : **une boucle est un polygone dont le départ est
un sommet.** La décrire demande trois nombres — une forme, une taille, une
orientation — et la géométrie fournit le reste.

1. **Un seul** Dijkstra depuis le départ. Il donne d'un coup, pour tous les
   nœuds atteignables, leur distance réseau réelle et leur coût pondéré — donc
   leur sûreté au mètre.
2. On en tire un index : pour chaque direction (par tranche de 5°) et chaque
   bande de distance, le nœud le moins cher au mètre. C'est le vivier.
3. On demande alors des polygones — *un triangle orienté à 40°*, *un carré à
   15°*, *un hexagone à 0°* — et on relie leurs points de passage par A*.
4. Portail L3, dédoublonnage, altitude, notation.

**Où sont les points de passage.** C'est le point à ne pas rater. Le départ
étant un sommet, les autres ne l'entourent pas : ils sont tous du même côté.
Dans un polygone régulier à *m* côtés vu depuis l'un de ses sommets, les *m−1*
autres se répartissent sur (m−2)·180/m degrés seulement, par pas de 180/m, et à
des distances **inégales** :

| Forme | Points | Étalement | Distances (× périmètre) | Rondeur idéale |
|---|---|---|---|---|
| Triangle | 2 | 60° | 0,333 · 0,333 | 0,605 |
| Carré | 3 | 90° | 0,250 · 0,354 · 0,250 | 0,785 |
| Pentagone | 4 | 108° | 0,200 · 0,324 · 0,324 · 0,200 | 0,865 |
| Hexagone | 5 | 120° | 0,167 · 0,289 · 0,333 · 0,289 · 0,167 | 0,907 |

La formule générale, par le théorème de l'angle inscrit : le k-ième point est à
`L·sin(kπ/m) / (m·sin(π/m))` et à `(k−1)·180/m` degrés du premier.

Répartir au contraire les points sur 360° — ce que faisait la version
précédente — place le départ **au centre** de la figure au lieu d'être dessus.
La boucle doit alors retraverser le milieu à chaque côté, les aires s'annulent,
et la rondeur s'effondre à 0,03. Le symptôme ne désignait pas la cause : les
boucles se refermaient, ne se recoupaient presque pas, respectaient la distance,
et n'étaient pourtant pas des boucles. `tests/test_shape_model.py` verrouille ce
point.

**Deux garde-fous** empêchent un tronçon de saboter la figure :

- une **zone centrale interdite** autour du départ, de rayon 0,45 fois la
  distance au premier point de passage. Une interdiction, pas une pénalité :
  une pénalité assez forte pour être efficace rend la recherche exorbitante,
  puisqu'elle continue d'explorer la zone chère au lieu de l'ignorer ;
- un **couloir de progression** angulaire. Sans lui, contourner par l'arrière
  est régulièrement moins cher que la corde directe : le tracé repassait dans un
  quartier déjà parcouru, en sens inverse, et son aire s'annulait. Le test coûte
  une lecture de tableau par arête, et il *réduit* l'espace exploré.

**Pourquoi viser les distances sur le réseau.** Le réseau impose des détours —
environ 1,3 fois la distance à vol d'oiseau. Mais ce facteur joue autant sur les
distances aux points de passage que sur le périmètre : viser les distances
théoriques en distance **réseau** donne directement la bonne longueur, sans
avoir à estimer le détour. Une boucle d'ajustement corrige le résidu.

Les tronçons utilisent A* avec une heuristique gonflée de 25 % : le chemin peut
être marginalement moins direct, la recherche est deux à trois fois plus rapide,
et la sécurité reste garantie par le portail L3.

**Ce que ça donne**, sur un panel de huit départs (grandes villes, périphérie,
village, littoral) × trois distances (5, 10, 21,1 km) :

| | Avant | Après |
|---|---|---|
| Itinéraires rendus | 61 | **115** |
| Rondeur médiane | 0,30 | **0,471** |
| Cas rendant le compte demandé | 16/24 (sur 3) | **22/24 (sur 5)** |
| Recherches ne rendant rien | 6/24 | **0/24** |
| Écart de distance | jusqu'à 10 % | **≤ 5 % le plus souvent** |
| Temps médian | 8,1 s | **3,3 s** |
| Temps maximum | 72 s | **19 s** |
| Échecs Overpass | 6/24 | **0/24** |

## Le choix des propositions

**« Regénérer d'autres boucles » en propose vraiment d'autres.** Le moteur est
déterministe : relancer la même recherche redonnait exactement les mêmes
parcours. Une régénération tourne donc les polygones de départ d'une fraction du
nombre d'or — jamais deux fois le même angle, quel que soit le nombre de
relances — et pénalise les directions déjà montrées. La note de sécurité garde
la main : un cran de note retire 0,9 au classement, la ressemblance au plus
0,75, si bien qu'à qualité égale une boucle moins sûre ne passe pas devant pour
faire du neuf. Sans régénération, la réponse reste identique à celle du moteur
Python.

Trier sur la seule note ne marche pas : les meilleurs candidats se ressemblent,
parce que ce qui fait une bonne note — les rues calmes, les parcs, les berges —
se trouve toujours au même endroit. On sortait trois boucles partant du même
côté, ce qui n'est pas un choix.

La sélection retient donc, à chaque tour, le candidat dont la note **diminuée de
ce qu'il partage avec les déjà retenus** est la plus haute : arêtes communes et
proximité de direction. Le premier choisi reste toujours le mieux noté — la
variété ne coûte jamais la meilleure boucle, elle ne joue que sur les suivantes.

La direction affichée est celle du **centre de gravité** de la boucle, pas celle
des cent premiers mètres. Deux boucles qui partent par la même rue puis
divergent complètement s'annonçaient auparavant à l'identique.

**Les noms sont choisis ensemble.** Nommer chaque boucle par sa voie la plus
longue paraît naturel, mais échoue précisément quand on en propose beaucoup :
les boucles d'un même quartier partagent leur artère principale, et l'écran
affichait « Boucle nord-ouest · avenue de la Gare » quatre fois. Le nom cesse
alors d'aider à choisir, ce qui est sa seule fonction.

Chaque boucle prend donc la voie qui lui est la plus **propre**, mesurée comme
*ce qu'elle en a de plus que toutes les autres réunies* — soit `2 × chez moi −
partout`. Une avenue partagée à parts égales vaut zéro quelle que soit sa
longueur ; une rue qu'une seule boucle emprunte vaut toute la sienne. Le
traitement est séquentiel, si bien que deux propositions ne peuvent pas porter
le même nom. Sur dix boucles au départ du Châtelet : dix noms distincts.

## Quand la distance ne tient pas : les tours

Il existe des endroits où une boucle de 21 km n'est tout simplement pas
possible sans longer une départementale. Un village dont toutes les sorties
sont des routes à 80, une presqu'île, un réseau trop pauvre. L'app rendait
alors une liste vide et un message d'explication — honnête, et parfaitement
inutile.

Or il reste une réponse évidente, celle que prend tout coureur qui connaît son
quartier : **une boucle deux fois plus courte, parcourue deux fois.** L'app la
propose désormais, en essayant deux tours avant trois, trois avant quatre, et
jamais en dessous de 1,5 km par tour — « cinq tours de 800 m » n'est plus une
sortie, c'est de la piste.

**Rien n'est relâché pour autant.** Le tour est généré et validé comme
n'importe quelle boucle de sa propre longueur : mêmes seuils, même portail,
même exigence de forme. Et le parcours répété est **revalidé dans son
ensemble**, parce que répéter change des choses réelles — on franchit chaque
traversée à chaque tour, on encaisse le dénivelé à chaque tour, et si le départ
tombe au milieu d'une portion exposée, les tours la mettent bout à bout.

Deux mesures, en revanche, sont reprises du tour unique et ne se répètent pas :
la **rondeur**, parce que l'aire double quand le périmètre double et que la
formule isopérimétrique la ferait chuter de moitié alors que la forme est
identique ; et le **recouvrement**, qui vaudrait mécaniquement (n−1)/n et ne
dirait plus rien.

**L'ordre des essais découle de la promesse du produit** : on préfère changer la
forme de la sortie plutôt que baisser l'exigence de sécurité. Les tours sont
donc tentés **avant** le repli sur les seuils Standard. L'inverse affichait
« aucun itinéraire ne tient les seuils du mode Sûr » au-dessus d'un itinéraire
noté A — l'app se contredisait.

Le parcours proposé est le parcours réel : géométrie répétée, consignes
répétées, profil altimétrique complet, fichier GPX de la sortie entière. Aucun
cas particulier ne subsiste en aval — le suivi GPS, la bande de parcours et le
guidage décrivent la sortie telle qu'elle sera courue.

**Sur le terrain, un tour ressemble au précédent.** On entend les mêmes
consignes dans le même ordre, et rien ne dit si c'est le premier passage ou le
dernier. Le guidage marque donc chaque retour au départ — « Fin du premier tour.
Encore deux tours. Repars vers le sud-ouest. » — et l'écran affiche « Tour 2
sur 3 » pendant toute la sortie.

La direction est reprise à chaque tour parce que le passage au départ est le
seul endroit du parcours où l'on peut repartir dans le mauvais sens sans s'en
apercevoir. Et la manœuvre qui tombe à cet endroit est absorbée par le repère :
l'angle y est bien de 180°, si bien que le guidage annonçait « fais demi-tour »
là où l'on repart pour un tour de plus — géométriquement exact, et trompeur
précisément au moment où l'on hésite.

**Ce que ça change**, au départ de Beaune :

| Distance demandée | Avant | Après |
|---|---|---|
| 21 km | **aucune proposition** | 5 propositions, dont **3 notées A** (6,9 km × 3) |
| 10 km | 1 proposition | 5 propositions |

Et là où les boucles entières existent — Paris, Nice, Lyon — rien ne change :
les tours ne sont proposés que pour compléter une liste trop courte.

## Le vent

Finir dix kilomètres face au vent est la façon la plus sûre de gâcher les deux
derniers. C'est un désagrément que tout le monde connaît, que personne ne peut
anticiper sans carte, et qu'une boucle permet d'éviter **gratuitement** : le
tracé passe de toute façon par tous les points cardinaux, il suffit de choisir
dans quel ordre.

L'app demande donc la direction du vent au départ (Open-Meteo, sans clé) et
préfère, à qualité égale, la boucle dont le **dernier tiers** se court vent dans
le dos — c'est là que le vent se paie, et le reste de la boucle le traversera de
toute façon.

Trois garde-fous, parce qu'un agrément ne doit jamais devenir un critère :

- **Sous 12 km/h, rien ne se passe.** En dessous, le vent ne se sent pas en
  courant, et l'orientation doit rester décidée par la sécurité et le terrain.
- **Le poids est de 0,10**, pondéré par la force du vent, contre 0,9 par cran de
  note de sécurité. Une boucle notée A avec un retour vent de face passe
  toujours devant une B vent dans le dos, et une demande de plat n'est jamais
  contredite. `tests/test_wind.py` vérifie exactement ces deux points.
- **L'échec est silencieux.** Sans réponse du service, le terme vaut zéro et la
  recherche est inchangée : on ne fait pas dépendre un itinéraire de la météo.

## La préférence de dénivelé

Elle ne pouvait pas être un simple bonus. Le dénivelé n'est connu qu'**après**
avoir tracé l'itinéraire — il vient d'une API externe — donc il n'entre pas dans
le routage, seulement dans le choix final. Or le tri diversifié y accorde
jusqu'à 0,75 point pour une direction originale : une boucle de montagne était
repêchée en mode Plat au seul motif qu'elle partait d'un côté encore inutilisé.
Annecy proposait ainsi 304 m de D+ à qui demandait du plat.

Chaque préférence porte donc une **fourchette**, et en sortir coûte plus que
tout ce que la variété peut rapporter :

| Préférence | Cible | Fourchette acceptée |
|---|---|---|
| Plat | 3 m/km | 0 à 10 m/km |
| Vallonné | 10 m/km | 3 à 20 m/km |
| Côtes | 22 m/km | 12 m/km et au-delà |

Ce n'est pas un rejet : s'il n'existe que des boucles hors fourchette, elles
sont proposées — simplement jamais devant une boucle conforme.

### Le dénivelé annoncé, et celui qu'on monte

`frontend/src/engine/environment.js` · `backend/app/elevation.py`

Le dénivelé annoncé se calculait sur un point tous les 100 m, lissé par une
moyenne de trois points — trois cents mètres — avec un seuil de deux mètres. Il
rabotait les côtes courtes : « on annonce 150 m, on en monte 200 ». Mesuré le
4 octobre 2026 sur 54 boucles de l'app autour de Guebwiller, contre leur
altitude IGN relevée tous les cinq mètres :

| Réglage | Total | Écart moyen | Pire boucle |
|---|---|---|---|
| Avant : 100 m, moyenne sur 3 points, seuil 2 m | −10 % | 15 % | −48 % |
| Après : 50 m, noyau triangulaire de 60 m, seuil 1 m | −1 % | 1,7 % | 10 % |

Hors de France (Valhalla, ~30 m), le noyau passe à 100 m et le seuil à 3 m :
−2 % et 11 %, contre −14 % et 21 % avec l'ancien seuil de huit mètres. Les ponts
et passages souterrains, où le modèle de terrain voit la rivière ou le talus, ne
pesaient que 0,3 % : pas de traitement à part.

**Le dénivelé mesuré** vient du **baromètre** de l'iPhone
(`ios-overlay/live-activity/App/AltimeterPlugin.swift`), cumulé côté natif
pendant toute la sortie : lissage de quatre secondes, seuil d'un mètre compté
depuis le creux. L'altitude du GPS, qui tremble de plusieurs mètres, ne sert
plus que de repli — iPhone qui refuse l'accès à « Mouvements et forme » — et le
bilan dit alors que ce n'est qu'un ordre de grandeur.

## Le guidage

`backend/app/navigation.py`

Un tracé est une suite de points ; une consigne est une décision. Tout le
travail consiste à ne garder que les endroits où il y a réellement quelque chose
à décider — un guidage qui parle en permanence cesse d'être écouté au bout de
cinq minutes.

- **Un vrai virage** (> 55°) se dit toujours.
- **Une inflexion** (30 à 55°) ne se dit que si elle fait changer de rue.
  Sinon c'est le dessin de la voie, pas une décision.
- **« Tout droit »** ne se dit que pour confirmer un changement de nom, sur une
  voie assez longue pour que l'information serve.
- **Une fourche se dit, même douce.** Quand une autre voie part vers l'avant
  (à moins de 45°), on dit laquelle prendre : « serre à droite dans la rue
  Haute » quand la rue s'infléchit et que la ruelle d'en face continue,
  « continue tout droit » quand c'est elle qu'on prend. On se tait seulement
  si l'on reste sur la même voie et qu'elle est la plus droite. Mesuré sur les
  boucles de Beaune et de Lyon : 2 % de consignes en plus, toutes à des
  fourches qui étaient muettes.
- **Deux manœuvres à moins de 25 m** deviennent une phrase : « tourne à droite
  puis tout de suite à gauche ».
- **La voie se nomme comme on la dit** : « dans la rue Pasteur », « sur
  l'avenue Foch », « sur le chemin de Halage ». OpenStreetMap écrit « Rue
  Pasteur », sans article ; l'app disait « sur Rue Pasteur ».
- **Après un virage, la ligne droite se dit** quand elle dépasse 300 m :
  « Maintenant, tourne à droite dans la rue Pasteur, puis continue pendant
  600 mètres. » (`guidance.js`)

L'angle se mesure sur une vingtaine de mètres de part et d'autre, pas sur les
deux points qui encadrent l'intersection : OSM place un point tous les quelques
mètres, et deux points consécutifs donnent une direction bruitée où un virage à
90° ressemble à trois virages à 30°.

Résultat : une consigne tous les 120 m environ en centre-ville, chacune étant
une décision réelle.

## Réglages

`backend/.env` (copie `.env.example`) :

| Variable | Défaut | Rôle |
|---|---|---|
| `LACET_ELEVATION_PROVIDER` | `ign` | `ign` (France, 1–5 m) · `opentopodata` (monde) · `none` |
| `LACET_ELEVATION_SAMPLE_M` | `50` | Un point d'altitude tous les N mètres. Voir « Le dénivelé annoncé, et celui qu'on monte ». |
| `LACET_ASCENT_THRESHOLD_M` | `1.0` | Seuil d'hystérésis du D+ (modèle fin, après lissage). Sans lui, le bruit du modèle d'altitude gonfle le dénivelé ; trop haut, il rabote les côtes. |
| `LACET_SECTORS` | `16` | Directions explorées. Moins = plus rapide, plus = plus varié. |
| `LACET_MAX_CANDIDATES` | `32` | Boucles brutes générées avant filtrage. Quatre formes × huit orientations. |
| `LACET_CACHE_TTL_DAYS` | `14` | Durée de vie du cache OSM. Passée cette date on retélécharge — mais si tous les miroirs sont muets, l'extrait périmé sert quand même. |
| `LACET_OVERPASS_ROUNDS` | `2` | Tours complets de la liste des miroirs avant d'abandonner. |
| `LACET_GRAPH_CACHE_NODES` | `320000` | Plafond du cache de graphes, en nœuds. À baisser sur un hébergeur étroit : c'est ce qui décide de la mémoire occupée. |
| `LACET_GRAPH_CACHE_ENTRIES` | `4` | Nombre de zones gardées en mémoire, quel que soit leur poids. |

Pour ajouter les fonds **Mapbox**, crée un compte gratuit sur mapbox.com, copie
le jeton public par défaut (il commence par `pk.`) et crée `frontend/.env` :

```
VITE_MAPBOX_TOKEN=pk.ton_jeton
```

Relance `npm run dev` : trois fonds s'ajoutent au sélecteur — Mapbox sombre,
**Mapbox Outdoors** (sentiers, courbes de niveau, ombrage du relief : le plus
utile pour courir hors des villes) et Mapbox Satellite. Ils passent par les
tuiles image de Mapbox (« Static Tiles »), prévues pour les bibliothèques
tierces comme MapLibre ; la formule gratuite couvre largement un usage
personnel. Leur feuille de style vectorielle, elle, désigne ses données par des
adresses `mapbox://` que MapLibre ne sait pas lire.

Sans jeton, le fond par défaut est **Nuit** : la carte sombre de CARTO, recolorée
au chargement aux teintes de l'interface — gratuit, mondial, sans clé. Tous ces
fonds dessinent les mêmes données OpenStreetMap ; ce qui change, c'est le rendu.

---

## Interface

La carte occupe tout l'écran, et le reste flotte dessus : les cartes de
parcours, qu'on fait défiler du pouce, la barre d'action et les onglets.
Toucher la carte de parcours choisie déplie son détail — profil, note de
sécurité, points d'eau — et la poignée grise le replie. L'app reste en
portrait (`customize.py`) : on court téléphone en main ou au bras, et une app
qui pivote au moindre mouvement est inutilisable en courant.

Le cadrage d'une boucle tient compte de tout ce qui flotte — la recherche, la
pastille d'activité, les boutons, le panneau du bas — pour qu'aucune partie du
tracé ne passe dessous (`dockPadding` dans `MapView.jsx`).

**La bande de parcours** est l'élément central. Elle superpose le profil
altimétrique et le niveau de sécurité sur le même axe — celui de la distance —
parce que les deux ne se lisent pas séparément : savoir qu'il y a 200 m
d'exposition ne sert à rien tant qu'on ignore *où*. En la parcourant du
doigt, le point correspondant s'allume sur la carte.

**Fonds de carte** — cinq styles sans clé d'API : Nuit (le sombre de CARTO aux
couleurs de l'app), Clair, Plan, Relief et Satellite, plus trois fonds Mapbox
avec un jeton. Le choix est mémorisé, et les couleurs du tracé s'adaptent
(un vert pâle disparaîtrait sur de l'imagerie satellite).

**Le point de départ** se pose de trois façons : le bouton de position, la
recherche d'adresse, ou directement sur la carte — le repère se fait glisser, et
le mode placement permet de le poser d'une touche.

**La boucle part de la rue, devant ce point** — pas du carrefour d'à côté, ni de
la maison elle-même. Le point d'une adresse est posé sur le toit : on coupe la
rue au droit de la porte, et c'est de là que la boucle part et là qu'elle
revient ; le repère s'y pose après la recherche. Quand la recherche d'adresse
donne le nom de la rue, c'est elle qu'on rejoint, même si une autre voie passe
plus près des murs — une maison d'angle, un jardin qui donne sur un chemin. La
première consigne dit de quel côté partir : « Départ — en sortant, pars à
droite dans la rue des Tonneliers. » (`engine/door.js`)

**Le sens de parcours** est marqué par des chevrons le long du tracé. Ce n'est
pas décoratif : les consignes de navigation, le profil altimétrique et
l'orientation par rapport au vent décrivent tous la boucle **dans un sens
précis**. La parcourir à l'envers donne les côtes au mauvais moment, le vent de
face à la fin, et un guidage qui annonce des virages à gauche là où il faut
tourner à droite.

Techniquement c'est un motif de ligne, pas une couche de symboles : deux des
cinq fonds de carte (Relief et Satellite) sont des styles raster écrits à la
main, sans champ `glyphs`, donc incapables d'alimenter la chaîne de rendu des
symboles. Le motif suit la ligne dans le sens où la géométrie a été écrite — et
le backend écrit chaque tronçon dans le sens du parcours, si bien que le chevron
indique la bonne direction sans aucun calcul supplémentaire.

**Les propositions** s'affichent ensemble : la retenue en couleur, les autres en
pointillés. Toucher l'une d'elles sur la carte la met en avant. Chacune porte sa
distance **et sa direction** — c'est elle qui les distingue vraiment, puisque
toutes tombent dans la fourchette demandée. Le nombre se règle dans les filtres :
3, 5, 8 ou 12.

**VoiceOver et clavier.** La recherche de lieu se parcourt aux flèches et se
valide par `Entrée` ; les fenêtres de réglages retiennent le focus tant
qu'elles sont ouvertes et le rendent au bouton d'origine en se fermant ; la
poignée de la feuille se manœuvre aux flèches. Et une région annoncée dit ce
qui vient de se passer — « 5 itinéraires proposés, le premier : Boucle nord,
10 km, note A » — parce que le reste de l'interface change en silence.

## La sortie

**Le guidage vocal** annonce chaque manœuvre deux fois : à 110 m — « dans cent
mètres, tourne à gauche sur l'avenue de la Gare » — puis au moment d'agir. Un
seul message ne suffit pas : trop tôt on l'oublie, trop tard on a dépassé la
rue. Les distances sont arrondies à des repères que l'oreille retient, personne
n'estimant 87 mètres en courant.

C'est la voix d'iOS — aucune clé, aucun réseau —, qui continue écran verrouillé
et baisse la musique le temps de parler (`VoicePlugin.swift`). Chaque consigne
coupe la précédente : une consigne périmée dite après le carrefour est pire que
rien. La musique remonte sur ce que la voix fait vraiment, et non sur un compte
de phrases : avec l'extension de synthèse d'avant, une seule fin de phrase
perdue — une consigne qui en coupait une autre — la laissait en sourdine
jusqu'au bout de la sortie.

**Les points d'eau et toilettes**, quand ils sont cochés, s'annoncent cent
mètres avant — « Point d'eau dans cent mètres » —, une fois par kilomètre au
plus : à Paris, il y a une fontaine tous les deux cents mètres.

**Le hors-parcours** se signale après trois relevés consécutifs à plus de 45 m
du tracé. Un point aberrant est banal entre deux immeubles ; trois de suite,
non. Le retour sur le tracé est annoncé aussi.

**L'alerte de traversée** prévient 120 m avant chaque passage non protégé, avec
vibration.

**Le bouton SOS** prépare un SMS vers un proche : position, distance parcourue,
temps écoulé. **L'app ne l'envoie pas** — elle ouvre l'application de messagerie,
c'est la personne qui appuie sur envoyer. Il s'arme par **appui maintenu** : un
bouton d'alerte posé à côté de « Terminer », sur un écran qu'on touche en
courant, part tout seul au premier frôlement. Le numéro reste sur l'appareil.

**La course libre** enregistre une sortie sans itinéraire. C'est ce que fait la
moitié des sorties — on part sans savoir où l'on va — et l'exiger obligeait à
choisir une boucle pour lancer le chronomètre.

**L'app s'ouvre sans réseau** : ses fichiers sont sur le téléphone. Les zones
déjà explorées se recalculent sans réseau, et les parcours gardés s'ouvrent
avec leurs consignes, leur profil et leur note.

### Les cartes hors ligne

Le réflexe était de dire « enregistrer ses parcours hors ligne ». Mais **ils le
sont déjà** : géométrie, consignes vocales, profil et évaluation de sécurité
vivent dans le stockage local et s'ouvrent sans réseau. La seule pièce qui
manquait, c'est **le fond de carte** — un favori ouvert sans couverture donnait
un trait vert sur du noir, inutilisable pour se repérer.

Une icône, à droite de chaque parcours dans « Mes parcours », le télécharge. Le
geste est **explicite, parcours par parcours** : garder automatiquement les
quarante favoris remplirait le téléphone à l'insu de tout le monde, souvent sur
des données mobiles.

Trois choses ont été apprises en mesurant, et chacune a changé le code :

**Le zoom 14 suffit — pour les fonds vectoriels.** La source CARTO déclare
`maxzoom: 14` : au-delà, le moteur agrandit la même tuile au lieu d'en demander
d'autres. Garder du zoom 10 au zoom 14 donne donc, hors ligne, exactement ce
qu'on voit en ligne. Relief et Satellite sont des images et déclarent 17 et 19 :
elles continuent de demander des tuiles plus fines, et resteront vides si l'on
zoome au-delà du 14. L'écran « Mon compte » le dit plutôt que de le taire.

**Peu de tuiles ne veut pas dire peu d'octets.** Une boucle de 10 km dans Paris
tient en trente-deux tuiles — et pèse **seize mégaoctets**, parce qu'une tuile
vectorielle de centre-ville transporte six cents kilooctets de bâtiments, de
commerces et de libellés. La même boucle en rase campagne en pèse moins d'un.
Un plafond exprimé en nombre de tuiles se trompait donc d'un facteur vingt. Le
plafond réel est en octets (40 Mo par parcours) et **se vérifie pendant le
téléchargement** : chaque niveau de zoom est estimé d'après la taille moyenne
des tuiles déjà prises à cet endroit, et l'on s'arrête à une **frontière de
niveau**, jamais au milieu — une carte plus grossière reste lisible, une carte
tronquée laisse des carrés noirs là où l'on court.

**Les quatre sous-domaines de tuiles sont un piège.** Le rendu tire `tiles-a` à
`tiles-d` au hasard pour chaque tuile ; une tuile enregistrée depuis l'un serait
introuvable si le rendu demande l'autre. L'app range donc tout sous un seul
nom. Sans cela, trois tuiles sur quatre manquent — une carte
en damier, et rien pour expliquer pourquoi.

Le reste suit : les tuiles sont **partagées** entre parcours (deux boucles de la
même ville ne se paient qu'une fois, et retirer l'une ne casse pas l'autre) ; les
cartes vivent dans **leur propre magasin**, que les mises à jour de l'app ne
balayent jamais ; « Mon compte » affiche la place occupée et permet de tout
vider ; et le fond utilisé est retenu avec la carte, parce que les tuiles de
« Sombre » ne servent pas à « Satellite ».

**Ce qu'on lit quand ça rate.** Une recherche qui échoue affichait la commande
à taper pour lancer le serveur — juste sur un poste de développement, absurde
sur un téléphone au milieu d'un chemin : la personne n'a pas de serveur à
lancer, elle a perdu le réseau. L'app distingue donc les deux, et hors ligne
elle dit ce qui lui reste : *« Calculer un itinéraire demande le réseau — mais
tes parcours enregistrés restent accessibles dans Mes parcours »*, avec le
bouton qui y mène. « Réessayer » n'y apparaît pas : cela ne servirait à rien.

**Le suivi** cumule distance, temps, sorties et kilomètres des sept derniers
jours. Les calories sont **estimées** à partir du poids, et le disent : sans
capteur cardiaque, on ne peut que multiplier une distance par un coefficient et
une masse. Les afficher comme des mesures serait un mensonge confortable ; les
cacher priverait d'un repère que tout le monde utilise. Le nombre de pas, lui,
a été retiré : il valait la distance multipliée par une longueur de foulée
supposée — la même information, présentée comme une seconde.

---

## Performances

### Sur l'appareil

Le moteur JavaScript est **plus rapide que le Python** qu'il reproduit : les
graphes y vivent dans des tableaux typés (voisins en CSR, coordonnées dans un
seul tampon), et la boucle de Dijkstra n'alloue rien.

| Paris intra-muros, 21 km | Python | JavaScript |
|---|---|---|
| Construction du graphe | 10,9 s | 4,7 s |
| Génération et notation | 4,3 s | 0,5 à 0,8 s |

**La région où l'on court est livrée avec l'app.** Chaque lundi, la compilation
télécharge l'extrait OpenStreetMap de la région chez Geofabrik (l'Alsace, dans
`.github/workflows/ios.yml`), le découpe en tuiles avec
`frontend/scripts/region_tiles.py` et les range dans l'app. Une recherche dans
la région lit ses rues sur place : **0,04 s** au lieu de vingt secondes à
plusieurs minutes chez Overpass, et même sans réseau. Les tuiles sont identiques
à ce qu'Overpass aurait rendu — vérifié voie par voie, étiquettes, nœuds et
géométries au bit près.

**Et elle déborde de six kilomètres.** Une carte qui s'arrête pile à la limite
administrative laisse sans rues quiconque habite près d'elle : constaté à
Bréchaumont, à deux kilomètres du Territoire de Belfort, où deux des six tuiles
d'une sortie de 5 km manquaient et partaient chez Overpass. La compilation coupe
donc les extraits des régions voisines — Lorraine, Franche-Comté, Bade-Wurtemberg,
Rhénanie-Palatinat, Suisse — à une emprise commune, les fusionne, et ne livre que
les tuiles qui y tiennent **entièrement** : le débord est aussi complet que le
reste. Depuis n'importe où en Alsace, y compris sur la frontière, les sorties de
5 et 10 km n'ont plus rien à demander à personne.

**On ne charge que ce qu'une boucle peut atteindre.** Une boucle de longueur L
ne s'éloigne jamais de plus de L/2 à vol d'oiseau : c'est tout ce qu'il faut
charger, et le rayon suit maintenant l'écart toléré au lieu d'une marge fixe
prise pour le mode le plus souple. Les rues arrivent par carreaux de 0,05°, pris
dès qu'ils **effleurent** ce disque : le débord — plus de la moitié de la
surface — est écarté avant la construction du graphe, sans jamais couper une rue
en deux. Mesuré à Guebwiller, 10 km : 16 carreaux et 14 062 voies avant, 11
carreaux et 5 833 voies après ; le graphe passe de 18 499 à 7 493 nœuds, et
l'ensemble rues + graphe de 0,59 s à 0,19 s sur un PC de bureau — un peu plus du
double sur un iPhone. Les carreaux, eux, restent gardés **entiers** : c'est ce
qui rend immédiate la recherche suivante, deux rues plus loin.

**Ailleurs, des archives préparées d'avance.** Overpass n'est pas un service de
téléchargement : c'est un moteur de requêtes, qui *calcule* l'extraction des
rues à la volée sur des serveurs publics. C'est la cause de fond de toutes les
lenteurs hors de la région livrée. Les rues, elles, ne changent pas d'une heure
à l'autre : elles sont donc découpées une fois par mois dans le dépôt public
[`lacet-data`](https://github.com/ImShimao/lacet-data), en archives d'un
demi-degré, et l'app **n'en lit que ce dont elle a besoin** — un répertoire de
quelques kilooctets, puis les tuiles voulues par plages d'octets (`Range`).
GitHub sert les
deux et autorise l'app à les lire (« HTTP 206 » et
« Access-Control-Allow-Origin : * », vérifié avant d'écrire une ligne — et
jsDelivr écarté au même moment, parce que ses plages d'octets portent sur une
version encodée du fichier et ne rendent pas les octets demandés). Une sortie de 10 km dans une ville jamais visitée : trois ou quatre
requêtes, trois mégaoctets, environ une seconde au lieu d'une minute. Ce qui en
vient est gardé sur l'appareil comme le reste — la zone devient utilisable hors
ligne — et n'est pas rafraîchi chez Overpass, puisque c'est le découpage mensuel
qui le remet à jour. Le format est décrit en tête de
`frontend/scripts/pack_tiles.py`, relu par `src/engine/archive.js`, et un test
lit une archive fabriquée par le Python : un décalage d'un octet se voit là
plutôt que sur le téléphone.

**Overpass reste le dernier recours.** Pour l'étranger, et pour les trous.
Deux serveurs y font la course. Hors de la région livrée, les rues
viennent d'Overpass. Mesuré le 19 septembre 2026 sur la France, la Suisse,
l'Italie, l'Espagne et l'Allemagne : l'instance principale répondait en 1,6 s…
ou en « 504 » au bout de 14 s, selon la minute ; celle d'OpenStreetMap France,
mondiale aussi et aux données identiques, en 1,5 à 5,4 s à chaque fois. Les deux
reçoivent donc chaque requête dès la première seconde, et la première réponse
l'emporte. Et seules les tuiles qui touchent le disque de recherche sont
demandées, non plus tout le carré qui l'entoure. Recherches à froid, dans des villes
jamais visitées : Marseille 10 km en 9 s, Toulouse 12 s, Lausanne 9 s, la
campagne provençale 4 s, Lyon 21 km en 23 s.

**Changer de distance ne retélécharge plus rien.** Au-delà de 25 km, le moteur
demande moins de détail (plus de voies de service) : c'était un autre
téléchargement, alors que les rues déjà gardées contenaient tout. Elles sont
maintenant filtrées sur place. Et quand seule la couronne extérieure manque, on
ne redemande qu'elle, en bandes, sans le centre.

**Rien n'attend plus indéfiniment.** Le pire cas s'additionnait sans plafond :
quatre miroirs relancés l'un après l'autre, deux tours, une file d'attente d'une
minute sur chacun, et tout ça autant de fois qu'il y a de lots à demander —
vingt minutes d'écran de chargement, constatées sur un téléphone. Le chargement
des rues a maintenant un budget : **quarante secondes**, puis on cherche avec ce
qui est arrivé (pourvu que la tuile du départ en fasse partie et qu'il y ait un
tiers de la zone), et quatre-vingt-dix secondes en tout avant de dire
honnêtement que les serveurs ne répondent pas. Le relief a le sien, quinze
secondes : c'est un complément, il ne doit pas coûter la recherche. Et les deux
lots qui partent ensemble vont désormais sur **deux serveurs différents**, au
lieu d'entrer dans la même file d'attente.

**Le cœur de la zone arrive avant son bord.** Une boucle reste bien à l'intérieur
du rayon demandé, et les tuiles du bord ne servent qu'à celles qui vont
l'effleurer. Quand la zone est lourde — une ville —, elle part donc en deux
temps : le cœur d'abord, la recherche commence avec lui, le bord continue
pendant qu'on lit les propositions. Et si ce bord tarde, ou si aucun miroir ne
répond, la recherche ne reste pas bloquée : elle cherche avec ce qu'elle a, le
dit, et le graphe tronqué n'est pas gardé — la recherche suivante aura tout.
C'est ce qui manquait le plus : une barre figée à 80 % pendant qu'il y avait,
déjà sur l'appareil, de quoi tracer la boucle.

**Les rues se préparent en fond.** Dès que le point de départ est connu — à
l'ouverture, ou quand on choisit une adresse —, l'app télécharge les rues de la
zone et construit leur graphe pendant qu'on règle ses filtres. La recherche qui
suit les trouve prêtes, ou rejoint le chargement en cours au lieu de le
recommencer. Mesuré à Colmar, ville jamais visitée : préparation en fond en
26 s, puis **recherche en 2 s**, relief compris — contre une trentaine de
secondes d'attente auparavant.

**Le relief part en un seul envoi.** L'IGN met en file les requêtes simultanées :
mille points passent en moins d'une seconde en un POST, en plus de cinq en dix
petits envois parallèles. Et c'est la requête qui coûte, pas les points —
remesuré le 22 septembre 2026 : 3,3 s pour trois cents points, 3,1 s pour mille,
3,7 s pour cinq mille, et un refus au-delà. Cinq itinéraires de 10 km, qui
partaient en deux envois, tiennent donc dans un seul : c'est, une fois les rues
sur l'appareil, le plus gros de ce qui reste à attendre.

Les rues sont gardées par carreaux de 0,05° dans IndexedDB, **au format serré
des tuiles livrées** : trois fois moins de place que les mêmes objets rangés
tels quels, 44 ms pour relire une tuile de 4 Mo au lieu de 100, et une taille
connue — sans quoi aucun plafond n'est possible. Le cache en a un : deux cent
cinquante mégaoctets, ou le quart de ce que WebKit accorde s'il promet
moins, et les carreaux dont on ne s'est pas servi depuis le plus longtemps
laissent la place. Soit environ trois fois l'Alsace : son coin, celui du
travail, deux ou trois endroits de vacances. Il n'y a rien à épingler, rien à
préparer avant de partir — et surtout plus de cache sans fin, que le système
finit par vider **en entier** au pire moment. Fraîches quatorze
jours ; ensuite, et jusqu'à trois mois, elles sont servies tout de suite et
rafraîchies en fond après la recherche. Une zone voisine ne retélécharge que
les carreaux qui lui manquent, et dans une grande ville deux lots partent en
parallèle — Overpass en accorde deux par adresse.

### Le moteur de référence (Python)

Mesuré sur un panel de huit départs et trois distances, après les optimisations :

| | Médiane | Maximum |
|---|---|---|
| Recherche complète, données à télécharger | 3,2 s | 18,4 s (Paris, 21 km) |
| Recherche suivante au même endroit | ~1,5 s | ~4,5 s |

Détail du pire cas — Paris intra-muros, 21,1 km, 547 000 nœuds après contraction :

| Étape | Première recherche | Recherche suivante |
|---|---|---|
| Téléchargement OSM | 2,9 s | ~2 s (lecture du cache disque) |
| Construction du graphe | 10,9 s | 0 s (cache mémoire) |
| Génération et notation | 4,3 s | 4,3 s |
| Altitude | 1,9 s | 0,07 s (cache disque) |
| **Total** | **~19 s** | **~4,5 s** |

Trois changements expliquent l'essentiel du gain :

**Les nœuds portent des indices contigus**, de 0 à N−1, au lieu de leur numéro
OpenStreetMap. La boucle interne de Dijkstra lit alors ses tableaux par indice
au lieu de hacher une clé — sur un centre-ville, où elle s'exécute des dizaines
de millions de fois par requête, c'est la différence entre une seconde et cinq.

**L'altitude est mise en commun et mise en cache.** Interroger chaque itinéraire
séparément était le poste le plus cher dès qu'on en propose cinq : autant de
connexions TLS, et des lots à moitié vides. Tous les points partent maintenant
ensemble, et une recherche relancée après un changement de filtre ne repaie plus
rien (4,75 s → 0,01 s).

**La zone bâtie est mémoïsée par cellule de 80 m.** La question était reposée
pour chacune des 350 000 voies d'un extrait parisien, alors que la notion est
déjà une approximation à l'échelle du quartier.

**Le cache range l'extrait au lieu de le recopier.** Overpass rend chaque point
de géométrie comme un petit dictionnaire `{"lat": …, "lon": …}` : sur Paris,
2,9 millions de dictionnaires à reconstruire **à chaque lecture du cache**, soit
trois secondes de pure analyse syntaxique avant le moindre calcul. Le cache
écrit désormais les coordonnées à plat — `[lon, lat, lon, lat, …]` — et range
d'avance voies, polygones et traversées. À données rigoureusement identiques :
**41 % de fichier en moins, 30 % de lecture en moins.**

Les extraits déjà sur disque restent lisibles et sont convertis à leur première
relecture, en conservant leur date : réécrire un fichier le rajeunit, et un
extrait vieux de treize jours repartirait sinon pour quatorze sans avoir été
rafraîchi. `tests/test_extract.py` vérifie que les deux formats produisent le
même graphe, arête par arête.

Le graphe ne dépend que de l'extrait et du sport — ni de la distance visée, ni
du profil de sécurité. Enchaîner plusieurs recherches au même endroit, ce que
tout le monde fait, ne le construit donc qu'une fois.

Paris est le pire cas de France. Une ville moyenne tourne autour de 1 à 3 s à
froid. Pour descendre plus bas il faudrait un moteur compilé (GraphHopper)
plutôt qu'un Dijkstra en Python — mais ce prototype existe pour valider le
**modèle de sécurité**, et sur ce point il est déjà juste.

### Robustesse des données

Overpass est une ressource publique gratuite, régulièrement saturée aux heures
ouvrées européennes. Ce que fait le moteur de l'app, et l'échec constaté qui a
motivé chaque mesure :

- **Une requête par zone, pas par carreau.** Les carreaux manquants partent
  regroupés dans le rectangle qui les englobe, jusqu'à 40 Mo par requête. Un
  carreau par requête en envoyait vingt pour une recherche en ville, et chacune
  pouvait tomber sur un miroir saturé : **127 s** mesurées, contre 21 s groupées.
- **Quatre miroirs, dans un ordre fixe, et une santé retenue.** Un miroir qui
  échoue passe en fin de file pour les requêtes suivantes, et reprend sa place
  dès qu'il répond. Le tirage au sort répétait les mêmes erreurs une requête sur
  deux.
- **On n'attend pas un miroir muet.** Passé huit secondes sans réponse, un
  second part **sans abandonner le premier** ; la première réponse gagne. Un
  miroir qui répond normalement reste seul sollicité.
- **Une erreur passagère se réessaie sur place** (504, coupure) ; une limite de
  débit (429) attend le temps que le miroir annonce lui-même sur `/api/status`,
  au lieu de repartir à l'aveugle.
- **Une réponse vide est un échec, pas un résultat** : mise en cache, elle
  empoisonnait la zone deux semaines.
- **Un extrait périmé vaut mieux qu'une erreur.** Si tout est muet et qu'une
  copie existe, on s'en sert : le réseau de rues n'a pas changé, et la personne
  voulait juste courir.

## Limites, dites franchement

- **L'app ne garantit pas la sécurité.** Elle privilégie les voies protégées
  d'après OpenStreetMap. Les données peuvent être incomplètes ou dépassées, un
  chantier peut apparaître. La formulation dans l'interface le dit, et elle doit
  y rester.
- **Les tuiles CARTO** sont gratuites pour un usage raisonnable, pas pour une app
  distribuée à grande échelle. Prévois MapTiler, Mapbox ou Protomaps auto-hébergé.
  Le téléchargement hors ligne y va d'ailleurs doucement — une tuile à la fois,
  jamais en rafale — pour la même raison.
- **Une carte hors ligne pèse lourd en ville** : compter une quinzaine de
  mégaoctets pour une boucle de 10 km en plein centre, contre un ou deux à la
  campagne. C'est le prix des bâtiments et des commerces dans chaque tuile ; le
  plafond de 40 Mo par parcours empêche seulement que cela dérape.
- **Overpass est une ressource publique partagée.** Pour de la production, il
  faut héberger sa propre instance ou passer à un extrait OSM local.
- **Attribution OpenStreetMap obligatoire** (licence ODbL), à l'écran et dans les
  fichiers GPX exportés. C'est déjà fait, ne le retire pas.

---

## Ensuite

- **Séance du jour** : « 6 × 400 m » → une boucle qui contient une ligne droite
  plate de 400 m près de chez toi. Personne ne le fait correctement aujourd'hui.
- Partage live d'une sortie en cours, couche communautaire de signalements avec
  seuil anti-abus.

---

Données cartographiques © contributeurs OpenStreetMap (ODbL) ·
Fonds de carte © CARTO · Altitudes IGN RGE ALTI et OpenTopoData
