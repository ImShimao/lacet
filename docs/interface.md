# L'interface et les réglages

[← Lacet](../README.md) · [Toute la documentation](README.md)

## Interface

La carte occupe tout l'écran, et le reste flotte dessus : les cartes de
parcours, qu'on fait défiler du pouce, la barre d'action et les onglets.
Toucher la carte de parcours choisie déplie son détail — profil, note de
sécurité, points d'eau — et la poignée grise le replie. L'app reste en
portrait (`customize.py`) : on court téléphone en main ou au bras, et une app
qui pivote au moindre mouvement est inutilisable en courant.

**Peu de cadres, peu de bruit.** Les étiquettes de section sont de petits
titres en minuscules, dans la police du texte — plus de capitales espacées en
chasse fixe précédées d'un point. Les chiffres du bilan n'ont plus de cadre,
les lignes de « Mes parcours » se détachent par leur surface et non par un
filet, et le bouton « garder la carte » n'est plus qu'une icône
(`20-labels.css`). Les noms vont à l'essentiel : « Terrain », « Route · Rues et
routes goudronnées ».

**Peu de texte à l'écran.** Dans le détail, l'heure de retour, la météo et le
vent tiennent sur une rangée de pastilles (`Facts` dans `Explore.jsx`) ; seul
un conseil qui change la tenue (pluie, froid, chaleur) garde sa phrase. Dans
les filtres et les réglages, une ligne suffit sous chaque champ : la
fourchette de distance, la durée estimée. Le reste se lit dans l'aide (i).

Le cadrage d'une boucle tient compte de tout ce qui flotte — la recherche, la
pastille d'activité, les boutons, le panneau du bas — pour qu'aucune partie du
tracé ne passe dessous (`dockPadding` dans `MapView.jsx`).

**L'habillage** est sobre : des gris ardoise neutres, un seul accent (bleu par
défaut), des aplats plutôt que des dégradés, et une seule police, Inter, dont
les chiffres à chasse fixe alignent les colonnes. Contrastes mesurés selon
WCAG : AA au moins pour tout texte, au-delà de 7:1 (AAA) pour les chiffres de
course, dans les deux thèmes. Le vert, le jaune et le rouge de la sécurité
restent fixes, quel que soit l'accent, et ont été choisis pour rester
distincts en deutéranopie et en protanopie : le vert tire vers le bleu, le
jaune reste le plus clair, le rouge le plus sombre — et la note se lit aussi
en lettre (A, B, C).

Toutes les couleurs passent par des jetons CSS (`styles/01-base.css`), carte
comprise : MapLibre ne lisant pas le CSS, `MapView.jsx` relit les jetons
`--map-…` (`mapToken`, `traceColors` dans `mapStyles.js`) et repeint le
tracé, les pointillés des autres propositions, la pastille du survol et sa
traînée quand l'accent, le thème ou le fond changent.

**Une icône, un sens.** Le fichier fléché exporte (GPX, sauvegarde) ou
importe (GPX, restauration) ; le partage d'iOS partage ; la flèche vers le bas
ne sert plus qu'à garder une carte hors ligne ; les flèches croisées proposent
d'autres boucles, la boucle fléchée dit les tours, l'horloge « déjà couru »,
et l'arc qui tourne une préparation en cours. Dans la barre d'action, chaque
icône porte son mot dessous — Favori, GPX, Sens, Autres — à côté de
« Démarrer » ; sur un écran de 320 px, les boutons cèdent quatre pixels et
« Démarrer » son triangle.

**La bande de parcours** est l'élément central. Elle superpose le profil
altimétrique et le niveau de sécurité sur le même axe — celui de la distance —
parce que les deux ne se lisent pas séparément : savoir qu'il y a 200 m
d'exposition ne sert à rien tant qu'on ignore *où*. En la parcourant du
doigt, le point correspondant s'allume sur la carte.

**Fonds de carte** — six styles sans clé d'API : Nuit (le sombre d'OpenFreeMap
aux couleurs de l'app), Fjord, Rues, Clair, Plan et Nature, plus Satellite et
trois fonds Mapbox avec un jeton. Le choix est mémorisé, et les couleurs du tracé s'adaptent au
fond, pas au thème : sur un fond clair, le tracé est cerné de sombre, et le
jaune s'y lit encore. Tant qu'on n'a pas choisi de fond, le thème clair part
du fond Clair et le sombre de Nuit.

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

**La feuille de route**, dans le détail d'un parcours : chaque consigne à son
kilomètre — « 0,7 · Tourne à gauche sur le quai de Montebello » —, et un
toucher montre l'endroit sur la carte. On y repère, avant de partir, le virage
qui piège ou la rue qu'on ne connaît pas.

**La nuit qui tombe** : partie maintenant, si la boucle finit après le coucher
du soleil (le même calcul que le moteur, `isNight`), un avertissement le dit
avec l'heure — c'est le moment où une rue sans éclairage ni trottoir devient
dangereuse.

**Avant de chercher**, le bouton « Filtres » dit ce qu'il règle — « Mixte ·
Vallonné », « VTT · D+ 300 m · 3 tours » — sans avoir à l'ouvrir
(`filtersLine`) ; la longueur est écrite en grand juste au-dessus. Dans le
panneau, l'activité, le terrain et le relief viennent d'abord ; la longueur et
l'allure, déjà réglées sur l'accueil ou une fois pour toutes, s'y replient en
une ligne qui dit leur valeur (« 5 km · souple », « 6:30 /km ») et s'ouvrent
pour le semi au mètre près, la saisie au clavier ou la tolérance.

**Les longueurs usuelles** : à pied, 5 km, 10 km, Semi et Marathon, au mètre
près ; à vélo, 25, 50, 75 et 100 km, sans resserrer la tolérance. En durée, la
demi-heure, les trois quarts d'heure, l'heure et l'heure et demie à pied ; une,
une et demie, deux et trois heures à vélo.

**Éviter** : les escaliers, les rues non éclairées, et les boucles déjà courues
depuis ce départ, qui passent alors après les neuves. Chaque nouvelle recherche
varie d'elle-même, et ne remet pas en tête ce qu'elle vient de montrer d'ici
(voir [generation.md](generation.md#le-choix-des-propositions)).

**La forme de la sortie** se choisit dans les filtres, sous la longueur : Auto,
1 boucle, 2 boucles (un « 8 » qui repasse au départ) ou Tours, avec le nombre de
tours. La ligne dit ce que ça donnera à cette longueur — « Une boucle d'environ
3,3 km, à faire 3 fois en repassant au départ » — et prévient quand un tour
tomberait sous 1,5 km. Une forme choisie est tenue strictement : s'il n'y en a
pas d'ici, l'app le dit au lieu d'en proposer une autre (voir
[generation.md](generation.md#choisir-la-forme)).

**Mes parcours** montre le croquis de chaque sortie et de chaque favori à la
place d'une icône : dix « Boucle sud-ouest » se reconnaissent à leur dessin. Une
course libre prend le nom de son moment — « Course du soir », « Vélo du
matin ». Chaque mois de l'historique a un bouton **Bilan** : kilomètres, D+,
temps, plus longue sortie et régularité, partageables en image comme une sortie.
Sous les onglets Sorties / Favoris, les **objectifs** de la semaine et du mois
(réglés dans « Mon compte › Profil ») montrent ce qu'il reste à courir, en
barres qui passent au vert une fois atteints (`goalProgress`, semaine depuis le
lundi). Puis le total, en grand chiffre, le volume par semaine et les séries et
défis tiennent sur une bande qu'on fait glisser au pouce (`.statstrip`) :
empilés, ils poussaient la liste sous le pli. Chaque mois forme un seul bloc,
comme un relevé de compte, la distance de chaque sortie en gros à droite.

**Le point de passage** : un appui long sur la carte (ou « Passer par un
point » dans le menu du départ) pose un fanion, et la recherche repart avec
des boucles qui y passent toutes. Le fanion se fait glisser ; la pastille
« Par ce point », sous la recherche, le retire d'un ✕.

**La zone à éviter** : le cercle hachuré des outils de carte efface la feuille,
un toucher sur la carte pose le centre (un autre toucher, ou glisser la poignée
du centre, le déplace), un curseur règle
le rayon de 100 m à 2 km, un champ la nomme. Ou un **contour** posé coin par
coin, jamais tracé au doigt, qui se battrait avec le déplacement de la carte —
voir `zones.js`. Ses coins gardent l'ordre des touchers ; deux côtés qui se
croisent sont décroisés (`ringOf`, « 2-opt »), si bien qu'une forme en L reste
un L et que des points posés en désordre ne font pas une étoile. Le « i » de la
carte se pose au-dessus de la carte de réglage (`--zone-cover`). Ses rues pèsent comme un signalement (`engine/blocked.js`) : un mur,
sauf quand le départ est dedans, où la boucle en sort par le plus court. Les
zones gardées se gèrent dans « Mon compte › Sécurité », hachurées sur la carte
quand elles comptent, en pointillés quand elles sont désactivées.

**Le sens de parcours** est marqué par des chevrons le long du tracé. Ce n'est
pas décoratif : les consignes de navigation, le profil altimétrique et
l'orientation par rapport au vent décrivent tous la boucle **dans un sens
précis**. La parcourir à l'envers donne les côtes au mauvais moment, le vent de
face à la fin, et un guidage qui annonce des virages à gauche là où il faut
tourner à droite.

**De petits traits blancs coulent sans fin dans le tracé**, dans son sens : des
gélules courtes et espacées, comme chez RunnrZ, qui se voient d'un coup d'œil
sans suivre la ligne. **Une flèche pleine se pose à quatre-vingts mètres du
départ** et dit par où partir (`startArrowGeoJson`). Sous une page (Mes
parcours, Mon compte, le bilan), la carte est cachée : l'animation s'arrête. MapLibre ne sait pas décaler
des pointillés ; le motif tourne donc en réécrivant `line-dasharray`
(`flowDashes`, `MapView.jsx`), vingt crans par seconde. Chaque cran redessine la
carte : **au bout de vingt secondes sans geste, les traits s'arrêtent** et des
chevrons fixes prennent le relais ; glisser, pincer ou toucher la carte, ou
choisir une autre boucle, les relance. De loin, où une ville entière tient à l'écran, les
traits ne feraient qu'un scintillement : les chevrons reprennent aussi la main,
et la flèche du départ s'efface pour ne pas recouvrir le point de départ. Sur un fond sombre, un liseré blanc
détache le tracé des rues, comme chez RunnrZ ; sur un fond clair, il se fond
dans le halo. En course,
pendant le survol et quand l'iPhone demande de réduire les animations, rien ne
bouge : de petits chevrons fixes, blancs cernés de sombre, prennent le relais
(`arrowIcon`). Ils suivent la géométrie dans le sens où elle est écrite — celui
du parcours — sans calcul.

**La boucle se dessine** depuis le départ, dans son sens, à chaque nouvelle
proposition choisie : on voit d'un coup d'œil par où elle part et par où elle
revient (`routeDraw.js`). Pas en course, où un détour doit apparaître tout de
suite, ni quand l'iPhone demande de réduire les animations.

**Le survol 3D** : le bouton « 3D » de la colonne de droite fait voler la carte
le long de la boucle choisie, inclinée sur le relief, de la porte à la porte —
dix-sept secondes pour 10 km. Une pastille à la couleur d'accent court sur le tracé,
la caméra la suit en tournant doucement aux virages, la part déjà parcourue
s'allume en blanc, et un compteur en haut donne les kilomètres et l'altitude.
Le relief (Terrain Tiles d'AWS, zoom 12, exagéré 1,5×, ombrage neutre)
n'est chargé que le temps du survol : hors ligne, ou si une tuile d'altitude
échoue, le survol se fait à plat. Toucher la carte met en pause et reprend ; la
faire glisser ou le bouton d'arrêt le termine, et la carte revient à plat sur
toute la boucle. Si l'iPhone demande moins d'animations, la caméra reste fixe
sur la boucle inclinée et seule la pastille avance.

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

## Réglages

**Mon compte** s'ouvre sur un en-tête à la manière des apps bancaires : un grand
avatar rond et « Profil local › », qui ouvre le profil. Les réglages à peu de
choix s'ouvrent en menu posé sur la ligne (`Prefs.jsx`). Aucune barre de
défilement nulle part : sur l'iPhone, le contenu qui suit le doigt suffit.

**Mon compte › Apparence** règle la couleur d'accent (bleu, violet, framboise,
vert — chacune avec sa teinte pour le thème clair et pour le sombre, le blanc
dessus à 4,5:1), le thème — sombre, clair, ou « Auto », qui
suit l'iPhone en direct — et la taille du texte (normale ou grande, +15 % ;
les très grands chiffres de course ne bougent pas). Le choix se pose en
attributs sur `<html>` avant le premier rendu (`appearance.js`, appelé par
`main.jsx`), sans passer par les couleurs d'origine ; la barre d'état d'iOS
suit le thème. Il est gardé dans le magasin de l'app : « Tout effacer » le
remet à zéro, une restauration le reprend.

Dans l'app, **Mon compte › Recherche** choisit les **filtres affichés** : une
case par filtre (Activité, Forme, Terrain, Dénivelé, Direction, Sécurité, Éviter). La
longueur et l'allure restent toujours. Un filtre masqué revient à sa valeur par
défaut, écrite sous la case — sauf l'activité, qui garde la sienne. **Pendant la
sortie › Écran** laisse l'écran se mettre en veille (téléphone au brassard) au
lieu de rester allumé. **Parcours › Au lancement** choisit ce que l'accueil
propose à l'ouverture : Boucle, Aller à…, ou le dernier utilisé.

**L'interface**, refaite à la manière des apps récentes (Revolut) : boutons
principaux et choix segmentés en gélule, gestes secondaires en ronds à côté de
« Démarrer », pastille de l'onglet actif autour de son icône seulement. Toucher
la carte ne réduit rien : l'accueil et les propositions restent comme on les a
laissés. Une boucle proposée se partage en image (`drawLoopCard`) : tracé,
distance, note et dénivelé, depuis « Partager › Une image ».

Côté moteur Python, `backend/.env` (copie `.env.example`) :

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

Sans jeton, le fond par défaut est **Nuit** (ou **Clair** en thème clair) : la
carte sombre d'OpenFreeMap, recolorée au chargement dans l'ardoise de l'interface —
elle ne prend pas la couleur de l'accent — gratuit, mondial, sans clé. Tous ces
fonds dessinent les mêmes données OpenStreetMap ; ce qui change, c'est le rendu.
