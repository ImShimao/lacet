---
title: Lacet
emoji: 🏃
colorFrom: purple
colorTo: gray
sdk: docker
app_port: 7860
pinned: false
---

# Lacet

Génère des boucles de course à pied et de vélo depuis ta porte, en écartant les
itinéraires qui longent une route rapide sans trottoir.

Ce n'est pas un tracé au hasard : chaque candidat est mesuré, noté, et **rejeté**
s'il ne passe pas le contrôle. L'app dit aussi ce qu'elle a écarté, et pourquoi.

Jusqu'à **douze propositions** par recherche, choisies pour partir dans des
directions différentes. Guidage vocal tour par tour, alerte avant chaque
traversée, bouton d'alerte à un proche, course libre sans itinéraire, et suivi
des sorties.

---

## Ce que c'est, techniquement

Un **site web installable** (PWA), pas une app native. C'est le choix le plus
compatible : iPhone, Android, PC, une seule base de code, pas d'App Store, et pas
besoin d'un Mac. Sur iPhone, « Ajouter à l'écran d'accueil » lui donne son icône
et le plein écran d'une vraie app.

```
backend/    Python + FastAPI — le moteur : données OSM, graphe, sécurité, génération
frontend/   React + MapLibre — l'interface
.vscode/    lancement, tâches et débogage prêts à l'emploi
```

Aucun service externe à configurer, aucune clé d'API. Les données viennent
d'OpenStreetMap (via Overpass), l'altitude de l'IGN, le fond de carte de CARTO.

---

## Démarrer (première fois)

Deux terminaux, ou la tâche VS Code plus bas.

**1. Backend**

```bash
cd backend
python -m venv .venv
.venv\Scripts\python.exe -m pip install -r requirements-dev.txt
```

**2. Frontend**

```bash
cd frontend
npm install
```

---

## Lancer

Dans VS Code : `Ctrl+Shift+B`, ou `Terminal → Exécuter la tâche → Lacet — tout lancer`.
Ça démarre les deux serveurs dans deux panneaux séparés.

À la main — deux terminaux. Les commandes ci-dessous sont écrites pour
**PowerShell**, le terminal par défaut de VS Code sous Windows : il enchaîne les
commandes avec `;`, et l'opérateur `&&` de bash y provoque une erreur d'analyse.

```powershell
cd backend; .venv\Scripts\python.exe -m uvicorn app.main:app --reload
```

```powershell
cd frontend; npm run dev
```

Puis **http://127.0.0.1:5173**.

Le front relaie `/api` vers le backend, donc une seule adresse à retenir : pas de
CORS à régler, et ça marchera pareil depuis le téléphone.

**Pour éprouver le hors ligne**, il faut le build de production : le service
worker ne s'enregistre pas en développement, où il mettrait en cache des modules
que Vite recompile à chaque frappe.

```powershell
cd frontend; npm run build; npm run preview
```

Puis **http://localhost:4173**. Ce mode relaie `/api` comme le serveur de
développement — sans quoi il faudrait tester la moitié de l'app à un endroit et
l'autre moitié ailleurs. Arrêter le serveur et recharger la page suffit alors à
vérifier que l'app s'ouvre sans réseau.

---

## Tester dans VS Code

**Débogage** — `F5`, puis choisis une configuration :

| Configuration | Ce qu'elle fait |
|---|---|
| Backend — API | Lance l'API avec rechargement auto. Les points d'arrêt fonctionnent dans tout `app/`. |
| Backend — tests | Lance pytest en mode debug. |
| Backend — test réel sur une ville | Génère de vraies boucles sur Paris et affiche le résultat dans le terminal. |
| Front — Chrome | Ouvre Chrome attaché au débogueur, points d'arrêt dans le JSX. |

**Tests** — 283 côté moteur, 125 côté interface. `Ctrl+Shift+P → Exécuter la
tâche → Lacet — tous les tests` lance les deux suites ; l'onglet « Test »
permet de rejouer un cas à la fois. En ligne de commande :

```powershell
cd backend; .venv\Scripts\python.exe -m pytest
```

```powershell
cd frontend; npm test
```

Les tests d'interface portent sur ce qui tourne **pendant** la sortie, sans
personne pour le regarder : le suivi de position sur le tracé, la formulation
des consignes vocales, et ce qu'on garde d'un parcours enregistré. Ce sont les
seuls endroits où une erreur ne se voit pas tout de suite — elle se vit sur le
terrain, à un carrefour.

Le service worker en fait partie, et pour une raison particulière : c'est le
seul morceau de l'app qu'on ne peut pas voir échouer en le regardant. Il ne
s'installe qu'en production, ses décisions se prennent pendant une coupure —
donc quand il n'y a ni console ouverte ni outil réseau pour observer — et les
requêtes qu'il intercepte le plus, celles des tuiles, partent d'un worker de
MapLibre qu'aucun journal de la page ne montre. `src/sw.test.js` le charge donc
tel quel dans un faux environnement et le met en situation : réseau coupé,
passerelle en erreur, sous-domaine différent, mise à jour de l'app.

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

**Documentation de l'API** — <http://127.0.0.1:8000/docs>, interactive.
Et <http://127.0.0.1:8000/explain> montre le modèle de sécurité appliqué à des
cas types : pratique pour vérifier d'un coup d'œil qu'il n'a pas dérivé.

---

## Tester sur ton iPhone

Le brancher en USB ne sert à rien ici : c'est une app web, elle passe par le
Wi-Fi. Le PC et le téléphone doivent être sur **le même réseau**.

### Le piège à connaître

Safari refuse la géolocalisation en dehors d'un « contexte sécurisé ». Une
adresse `http://192.168.x.x` n'en est pas un : la carte s'affichera, mais le GPS
restera muet. Il faut donc du HTTPS.

### La marche à suivre

**1. Lance la version de production, en HTTPS sur le réseau** (l'API doit
tourner à côté, comme d'habitude) :

```powershell
cd frontend; npm run build; npm run preview:mobile
```

Vite affiche plusieurs adresses ; prends celle en `https://192.168.…:4173`.

Pourquoi pas `npm run dev:mobile` ? Il marche pour la carte et le GPS, mais c'est
le mode développement, où le service worker ne s'enregistre pas : l'app ne
s'ouvrirait pas sans réseau, et les cartes hors ligne ne seraient pas proposées.
C'est précisément ce qu'on veut sur un téléphone.

**2. Ouvre le pare-feu Windows**, une seule fois, dans un PowerShell
**administrateur** :

```powershell
New-NetFirewallRule -DisplayName "Lacet dev" -Direction Inbound -LocalPort 4173,5173 -Protocol TCP -Action Allow
```

Le port 8000 de l'API n'a pas besoin d'être ouvert : le téléphone ne parle
qu'à la page, qui relaie elle-même vers l'API depuis le PC.

**3. Sur le téléphone**, ouvre cette adresse (Safari sur iPhone, Chrome sur
Android). Un avertissement de certificat apparaît — il est auto-signé, c'est
attendu. Sur iPhone : « Afficher les détails » puis « Visiter ce site web ».

**4. Installe-la** : bouton Partager → « Sur l'écran d'accueil » (Android :
menu ⋮ → « Ajouter à l'écran d'accueil »). Elle s'ouvre alors en plein
écran, avec son icône, sans barre d'adresse.

### Ce qu'il faut savoir

**Le PC reste le serveur.** Calculer un itinéraire demande que le PC soit
allumé, les deux serveurs lancés, et le téléphone sur le même Wi-Fi. Ce qui est
déjà sur le téléphone — favoris, historique, cartes mises de côté, suivi d'une
sortie — n'en a pas besoin. Pour une app indépendante du PC, voir
[Héberger en ligne](#héberger-en-ligne).

**Tout est rangé par adresse.** Favoris et cartes hors ligne appartiennent à
l'adresse exacte qui les a créés : `https://192.168.1.96:4173` et une autre
adresse sont, pour le navigateur, deux apps différentes. Si l'adresse du PC
change (nouveau Wi-Fi, box redémarrée), le téléphone repart d'un stockage vide.

**Le certificat auto-signé et le hors ligne.** Il suffit pour le GPS. Il n'est
pas garanti qu'il suffise au service worker : les navigateurs peuvent refuser de
l'installer derrière un certificat qu'on a dû accepter à la main. Si l'app ne
s'ouvre pas sans réseau après l'avoir ouverte une fois en ligne, c'est la
raison — et le tunnel ci-dessous, qui a un vrai certificat, la contourne.

### Le tunnel : une vraie adresse HTTPS, même en 4G

```powershell
cd frontend; npm run build; npm run preview
```

Puis, dans un autre terminal (`winget install Cloudflare.cloudflared` la
première fois) :

```powershell
cloudflared tunnel --url http://localhost:4173
```

L'URL affichée, en `https://xxx.trycloudflare.com`, s'ouvre directement sur le
téléphone, sans avertissement et sans pare-feu à ouvrir. Ici c'est `preview` et
non `preview:mobile` : le tunnel fournit lui-même le HTTPS.

Deux réserves. Vite refuse par défaut les noms d'hôte qu'il ne connaît pas ;
`vite.config.js` autorise donc `*.trycloudflare.com`, et seulement lui — sans
cela, cette adresse répondait « Blocked request ». Et **l'URL change à chaque
lancement** : c'est parfait pour essayer, mais une app installée depuis un
tunnel perd ses favoris dès le tunnel suivant, pour la raison dite plus haut.

### Ce qui marche sur le téléphone

Le GPS temps réel, le guidage vocal tour par tour, l'alerte avant chaque
traversée (vibration), la détection de hors-parcours, le bouton SOS, le maintien
de l'écran allumé pendant la sortie, l'export GPX — marqué `running` ou
`cycling` selon le sport, faute de quoi un compteur de vélo classe la sortie en
course à pied — et le stockage local des favoris et de l'historique.

Une fois installée depuis la version de production, **l'app s'ouvre sans
réseau** : le service worker garde sa
coquille. Le suivi GPS, le chronomètre et les consignes déjà téléchargées
fonctionnent alors normalement, et le fond de carte suit s'il a été mis de côté
depuis « Mes parcours ».

## Héberger en ligne

Une fois hébergée, Lacet n'a plus besoin du PC : une adresse HTTPS fixe, qu'on
ouvre sur le téléphone et qu'on installe sur l'écran d'accueil.

### Un seul service

`backend/app/server.py` sert **l'API sous `/api` et l'app web à la racine**.
La page et ses appels partagent la même adresse : un seul certificat, ni proxy
ni CORS, et c'est exactement le chemin (`/api`) qu'emprunte déjà le front en
développement. Les fichiers de `assets/`, qui portent leur empreinte dans leur
nom, sont gardés un an par le navigateur ; la page, le service worker et le
manifeste sont revalidés à chaque visite, pour qu'une mise à jour arrive tout
de suite.

En local, pour l'essayer :

```powershell
cd frontend; npm run build; cd ..\backend
.venv\Scripts\python -m uvicorn app.server:app --port 8000
```

→ http://localhost:8000. Et pour l'ouvrir sur le téléphone sans rien héberger,
le tunnel pointe sur ce seul port : `cloudflared tunnel --url http://localhost:8000`.

### L'image Docker

Le `Dockerfile` à la racine construit le front puis le sert avec l'API :

```powershell
docker build -t lacet .
docker run -p 7860:7860 lacet
```

Elle écoute sur `$PORT` (7860 par défaut), écrit son cache OSM dans
`/tmp/lacet-cache` et tourne sous un utilisateur non administrateur. Pour les
fonds Mapbox : `docker build --build-arg VITE_MAPBOX_TOKEN=pk.… -t lacet .`

### Où l'héberger

| | Mémoire | Veille | Remarque |
|---|---|---|---|
| **Hugging Face Spaces** (Docker) | 16 Go | après 48 h sans visite | gratuit ; le plus confortable pour les graphes des grandes villes |
| **Render** (Web Service, Docker) | 512 Mo | après 15 min, ~1 min de réveil | gratuit ; trop juste pour une grande ville — voir ci-dessous |
| **Railway / Fly.io** | au choix | aucune | payant, quelques euros par mois |

Sur chacun : créer le service à partir du dépôt Git, type Docker, sans autre
réglage — le port est lu dans `$PORT`.

**La mémoire décide.** Mesuré : **568 Mo** occupés après une recherche sur Paris,
dont l'essentiel est le graphe en cache. Les 512 Mo d'une offre gratuite sont
donc dépassés, et le service tué sans explication. Deux issues : prendre un
hébergeur plus large, ou baisser le plafond avec
`LACET_GRAPH_CACHE_NODES=120000` — l'app reste vivante, au prix d'une
reconstruction du graphe plus fréquente.

**Avant de mettre en ligne**, renseigne `LACET_USER_AGENT` (variable
d'environnement du service) avec une adresse de contact réelle, par exemple
`Lacet/0.1 (ton-adresse@exemple.fr)`. Overpass, Nominatim et l'IGN l'exigent de
toute application publique, et bloquent celles qui ne s'identifient pas.

Le cache disque des hébergeurs gratuits est éphémère : il se vide à chaque
redémarrage. La première boucle autour d'une nouvelle ville reprend alors ses
quelques secondes de téléchargement OSM, rien de plus.

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
lui a besoin d'une bande ou d'une piste cyclable.

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
- **Deux manœuvres à moins de 25 m** deviennent une phrase : « tourne à droite
  puis tout de suite à gauche ».

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
| `LACET_ASCENT_THRESHOLD_M` | `2.0` | Seuil d'hystérésis du D+. Sans lui, le bruit du modèle d'altitude gonfle le dénivelé de 30 à 50 %. |
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

L'écran est en deux parties : la carte occupe la place, le panneau de droite
porte la lecture. Sur téléphone tenu droit, la carte occupe tout l'écran et le reste flotte
dessus : les cartes de parcours, qu'on fait défiler du pouce, la barre d'action
et les onglets. Toucher la carte de parcours choisie déplie son détail — profil,
note de sécurité — et la poignée grise le replie. Le téléphone **ne pivote jamais** : couché, l'app reste dans son sens.
Android installé la verrouille en portrait (le manifeste le demande) ; Safari,
qui n'accorde ce verrou à aucune page, reçoit une app qui tourne d'elle-même en
sens inverse. La carte reste alors droite par rapport à l'écran et fait pivoter
son contenu — ses gestes restent justes sous le doigt —, et les noms de lieux
tournent avec elle. Seuls les fonds en image (Satellite, Relief) gardent leurs
libellés couchés : ils sont dessinés dans l'image.

**La bande de parcours** est l'élément central. Elle superpose le profil
altimétrique et le niveau de sécurité sur le même axe — celui de la distance —
parce que les deux ne se lisent pas séparément : savoir qu'il y a 200 m
d'exposition ne sert à rien tant qu'on ignore *où*. En la parcourant à la
souris, le point correspondant s'allume sur la carte.

**Fonds de carte** — cinq styles sans clé d'API : Nuit (le sombre de CARTO aux
couleurs de l'app), Clair, Plan, Relief et Satellite, plus trois fonds Mapbox
avec un jeton. Le choix est mémorisé, et les couleurs du tracé s'adaptent
(un vert pâle disparaîtrait sur de l'imagerie satellite).

**Le point de départ** se pose de trois façons : le bouton de position, la
recherche d'adresse, ou directement sur la carte — le repère se fait glisser, et
le mode placement permet de le poser d'un clic.

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
pointillés. Cliquer l'une d'elles sur la carte la met en avant. Chacune porte sa
distance **et sa direction** — c'est elle qui les distingue vraiment, puisque
toutes tombent dans la fourchette demandée. Le nombre se règle dans les filtres :
3, 5, 8 ou 12.

**Raccourcis clavier** : `Entrée` rechercher · `F` filtres · `L` ma position ·
`P` mode placement · `1` à `9` choisir une proposition · `Échap` fermer.

**Tout se fait au clavier**, et ce n'est pas une case à cocher : on arrive sur ce
champ en tapant une adresse, les doigts sur les touches. La recherche de lieu se
parcourt aux flèches et se valide par `Entrée` — auparavant `Entrée` ne faisait
rien, et atteindre un résultat en tabulant le faisait disparaître, puisque
quitter le champ fermait la liste. Les fenêtres de réglages retiennent le focus
tant qu'elles sont ouvertes et le rendent au bouton d'origine en se fermant ;
sans ça, la tabulation parcourt les commandes qu'elles recouvrent. Enfin, une
région annoncée dit ce qui vient de se passer — « 5 itinéraires proposés, le
premier : Boucle nord, 10 km, note A » — parce que le reste de l'interface
change en silence.

## La sortie

**Le guidage vocal** annonce chaque manœuvre deux fois : à 110 m — « dans cent
mètres, tourne à gauche sur l'avenue de la Gare » — puis au moment d'agir. Un
seul message ne suffit pas : trop tôt on l'oublie, trop tard on a dépassé la
rue. Les distances sont arrondies à des repères que l'oreille retient, personne
n'estimant 87 mètres en courant.

La synthèse vocale du navigateur suffit — aucune clé, aucun réseau — mais elle
demande trois précautions, toutes traitées dans `src/voice.js` : la liste des
voix arrive en retard (sinon une voix anglaise lit le français), iOS exige un
geste de l'utilisateur pour la première phrase, et la file d'attente ne se vide
pas seule (une consigne périmée dite après le carrefour est pire que rien).

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

**L'app s'ouvre sans réseau.** C'est une app qu'on utilise dehors, souvent en
périphérie, parfois en forêt : rouvrir l'onglet à mi-parcours dans une zone sans
couverture donnait une page blanche, et la sortie en cours était perdue. Un
service worker garde la coquille de l'app. La stratégie est **réseau d'abord** —
une app de cartographie qui sert du vieux contenu est pire qu'une app qui ne se
charge pas — et **rien de ce qui vient de l'API n'est gardé** : un itinéraire
rejoué depuis un cache serait faux sans le dire.

**Et quand même la coquille manque**, une page de repli s'affiche : le logo de
l'app, ce qui se passe, et ce qui reste accessible. Sans elle, quelqu'un parti
courir tombait sur l'écran d'erreur du navigateur, qui lui parlait de DNS. Elle
est entièrement autonome — style, logo et polices à l'intérieur du fichier —
puisqu'elle s'affiche précisément quand plus rien ne peut être téléchargé.

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
introuvable si le rendu demande l'autre. L'app et le service worker rangent donc
tout sous un seul nom. Sans cela, trois tuiles sur quatre manquent — une carte
en damier, et rien pour expliquer pourquoi.

Le reste suit : les tuiles sont **partagées** entre parcours (deux boucles de la
même ville ne se paient qu'une fois, et retirer l'une ne casse pas l'autre) ; les
cartes vivent dans **leur propre cache**, que les mises à jour de l'app ne
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
jours. Les calories et le nombre de pas sont **estimés** à partir du gabarit, et
le disent : sans capteur cardiaque ni accéléromètre, on ne peut que multiplier
une distance par un coefficient. Les afficher comme des mesures serait un
mensonge confortable ; les cacher priverait d'un repère que tout le monde
utilise.

---

## Performances

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
ouvrées européennes. Cinq mesures, toutes tirées d'échecs constatés :

- **Quatre miroirs**, interrogés dans un ordre **tiré au sort** à chaque requête.
  Attaquer toujours le même en premier concentre la charge et le fait saturer :
  c'est ce qui produisait des « 429 Too Many Requests » en rafale.
- **On n'attend pas un miroir jusqu'au bout avant d'essayer le suivant.** Ils
  étaient interrogés en file, avec quatre-vingt-dix secondes d'attente chacun.
  Mesuré en conditions réelles : **87 secondes** perdues à attendre qu'un miroir
  en panne finisse par répondre « 504 », quand le suivant répondait en sept.
  Passé quinze secondes, on en lance donc un second **sans abandonner le
  premier**, et on garde la première réponse qui arrive. Un miroir qui répond
  normalement reste seul sollicité : quadrupler la charge de chaque recherche
  sur des serveurs publics serait un abus.
- **Deux tours**, séparés par une attente qui double et comporte une part
  aléatoire.
- **Une réponse vide est un échec, pas un résultat.** Un miroir qui abandonne en
  cours de route rend un JSON valide contenant zéro élément. Mis en cache, il
  empoisonnait la zone pendant deux semaines et la recherche répondait « aucune
  voie praticable » en plein centre-ville.
- **Un extrait périmé vaut mieux qu'une erreur.** Si tous les miroirs sont muets
  et qu'un extrait existe en cache, on s'en sert : le réseau de rues n'a pas
  changé, et la personne voulait juste courir.

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
