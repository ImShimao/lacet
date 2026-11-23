# Le guidage et la sortie

[← Lacet](../README.md) · [Toute la documentation](README.md)

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
  puis tout de suite à gauche ». L'angle retenu est celui du chemin, du cap
  d'arrivée au cap de départ, et non la somme des deux angles annoncés : sur
  les pentes de la Croix-Rousse, les bouts de trottoir d'un mètre d'une
  traversée faisaient dire « fais demi-tour » pour un virage à gauche. Un
  « tout droit » qui suit un virage de près nomme la voie où il mène :
  « tourne à droite sur Passerelle du Collège », une seule fois.
- **Un rond-point se dit en une phrase**, à son entrée, avec l'angle de la
  rue d'arrivée à la rue de sortie : « Au rond-point, continue en face en
  restant à gauche dans la rue Pasteur ». L'anneau était découpé en tronçons
  comme une rue, et les consignes tombaient sur ses nœuds : sur 44 passages
  autour de Guebwiller, Soultz et Issenheim, aucune ne disait « rond-point » —
  sept étaient muets, onze faisaient une chicane (« tourne à droite puis tout
  de suite à gauche » pour aller en face), les autres un virage pris au milieu
  de l'anneau. Après : 44 sur 44. À pied, on ne compte pas les sorties : on
  dit où l'on va et, quand ça ne va pas de soi, de quel côté faire le tour —
  « prends à droite en faisant le tour par la gauche ». À vélo, on roule sur
  l'anneau : « Au rond-point, prends la deuxième sortie ». Le côté suit le
  réglage « Côté de la route » (voir [generation.md](generation.md)).
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

## La sortie

**Le guidage vocal** annonce chaque manœuvre deux fois : une trentaine de
secondes avant — « dans cent mètres, tourne à gauche sur l'avenue de la Gare »
— puis au moment d'agir, cinq secondes avant le carrefour (`guidance.js`). Un
seul message ne suffit pas : trop tôt on l'oublie, trop tard on a dépassé la
rue. Les distances sont arrondies à des repères que l'oreille retient, personne
n'estimant 87 mètres en courant.

C'est la voix d'iOS — aucune clé, aucun réseau —, qui continue écran verrouillé
et baisse la musique le temps de parler (`VoicePlugin.swift`). Le « maintenant »
d'un carrefour coupe la phrase en cours : une consigne périmée dite après le
carrefour est pire que rien. Une annonce, elle, attend que la phrase finisse —
elle vise un carrefour à une demi-minute. La musique remonte sur ce que la voix fait vraiment, et non sur un compte
de phrases : avec l'extension de synthèse d'avant, une seule fin de phrase
perdue — une consigne qui en coupait une autre — la laissait en sourdine
jusqu'au bout de la sortie.

**La voix se règle** dans « Mon compte › Pendant la sortie » (`voice.js`,
`voiceSettings`) : les kilomètres à chaque borne, une sur deux ou jamais ; ce
qu'ils disent — temps du kilomètre, allure moyenne, temps couru ; et l'annonce
d'un virage plus tôt (×1,5) ou plus tard (×0,6). Seul le confort se règle : le
« maintenant », les alertes de traversée et d'écart se disent toujours. Le débit
de la voix reste celui de `VoicePlugin.swift`, qui ne le reçoit pas encore.

### Une sortie entière, écoutée

La plainte n° 1 contre les apps de course, dans les avis de l'App Store : une
voix qui se tait au bout de quelques virages, écran verrouillé, ou qui annonce
un virage déjà passé. `LiveRun.voice.test.jsx` court des boucles réelles des
extraits de parité — Beaune, la Guillotière, les pentes de la Croix-Rousse (plus
de trente manœuvres en 5 km), deux tours à Beaune, un « 8 » de 16 km — à
allure de course : un relevé par seconde, la dérive lente d'un GPS de
téléphone, un reflet sur une façade donné pour précis toutes les minutes et
demie, des points que le téléphone sait douteux, et une demi-minute à quarante
mètres du tracé. Le coureur coupe les angles, comme tout le monde. Tout passe
par le vrai chemin — `LiveRun.jsx`, `guidance.js`, `voice.js`, `native.js` —
jusqu'à une synthèse simulée qui suit les règles de `VoicePlugin.swift` : une
phrase prend le temps de se dire, une consigne coupe celle en cours. On juge ce
qu'on **entend** : chaque manœuvre annoncée puis « maintenant », dans l'ordre,
jusqu'à la dernière, la direction entendue au plus tard en traversant le
carrefour ; aucune annonce sans carrefour devant soi, ni à une distance fausse ;
la fin de tour dite ; l'arrivée dite une fois, en entier ; les bornes au bon
kilomètre ; jamais de « Tu reviens sur tes pas » sans demi-tour ; la musique
jamais plus de trente secondes en sourdine.

Le premier passage a trouvé, et fait corriger :

- **La voix muette d'un bout à l'autre.** Le premier relevé était cherché sur
  tout le tracé, et sur une boucle qui revient par la rue du départ, il tombait
  sur la fin : toutes les consignes passaient pour faites. Une sortie commence
  désormais au début du tracé.
- **Un reflet qui taisait les consignes.** La recherche sur le tracé couvrait
  250 m de part et d'autre, une minute de course : un reflet y faisait
  « avancer » de 200 m, le relevé suivant passait pour un demi-tour, et la voix
  se taisait jusqu'à ce faux point. Elle ne couvre plus que ce qu'on a pu
  courir depuis le dernier relevé qui avançait sur le tracé (`locate`).
- **Les passages superposés.** Au demi-tour d'une impasse, dans les lacets
  d'une montée ou d'un escalier, deux passages du tracé sont à quelques mètres
  l'un de l'autre ; l'app suivait le mauvais, à reculons, et s'y perdait. Le cap
  du GPS — tiré de la vitesse, insensible aux reflets — départage désormais les
  passages, et seul un relevé qui avance comme on court sert d'ancre.
- **Une consigne coupée par la suivante.** L'annonce « Dans 100 mètres » du
  virage d'après coupait le « maintenant » du virage en cours, et le
  « maintenant » d'un virage dit « tout de suite » coupait la phrase qui le
  disait — au départ, on n'entendait jamais de quel côté partir. Une annonce, ou
  une consigne déjà dite, attend désormais la fin de la phrase en cours.
- **Après une fin de tour**, le premier virage n'était jamais annoncé : la
  phrase de tour le donnait pour dit sans le dire. Elle l'enchaîne maintenant.
- **« Arrivée. Sortie terminée. »** n'était jamais entendu : l'écran de course,
  refermé aussitôt, coupait la voix avant le premier mot.
- **Les bornes kilométriques** tombaient 30 % trop tôt : un reflet de soixante
  à cent mètres en une seconde comptait pour couru. Un saut n'est plus compté
  que si le temps l'explique.
- **Un écart, puis un retour** : la minute passée hors du tracé était comptée
  comme courue dessus, et le retour se plaçait cent vingt mètres plus loin.

Deux limites restent, connues. Trois virages en soixante mètres ne laissent pas
le temps de tout dire : la phrase du deuxième — « serre à gauche puis tout de
suite à droite dans la rue François Vernay, puis dans 30 mètres… » — est coupée
par le « maintenant » du troisième avant d'arriver à son annonce.

### L'arrivée

La boucle revient à sa porte, et la sortie s'arrête d'elle-même
(`arrival.js`) : l'arrivée s'arme à 70 m de la fin du tracé, puis se fixe au
**point le plus proche** — une fois qu'on s'en éloigne, ou qu'on y reste cinq
secondes. Trois réglages la rendent plus sûre :

- **Le cercle suit le GPS.** 14 m en terrain dégagé, jusqu'à 25 m quand le
  relevé du moment se dit imprécis : entre deux immeubles, le point le plus
  proche tombait à quinze ou dix-huit mètres d'une ligne pourtant franchie, et
  c'était au bouton de terminer.
- **On s'arrête à la porte.** La boucle part de la rue, devant le point choisi ;
  on finit souvent à la porte elle-même, vingt ou trente mètres plus loin.
  Arrêté à moins de 35 m de la fin, un quart de minute, tout au bout du
  parcours : c'est l'arrivée.
- **Le chrono s'arrête au point le plus proche**, pas au relevé qui le
  confirme : les quelques secondes et mètres d'après n'entrent ni dans le temps
  ni dans l'allure.

La voix donne alors le bilan — « Arrivée. Sortie terminée : 10,2 kilomètres en
58 minutes, allure moyenne 5 minutes 41. » —, l'écran de verrouillage le garde
un quart d'heure (drapeau à damier, temps et allure), et l'écran de fin s'ouvre
sur « Boucle bouclée ». S'il s'est déclenché trop tôt — un tour de plus, un
retour au calme —, « Pas fini ? Reprendre la sortie » repart sans rien perdre :
la sortie quitte l'historique et reprend ses chiffres, le temps passé devant le
bilan en moins.

En **course libre**, il n'y a pas de tracé : repassé à moins de 40 m de son
départ, un kilomètre au moins plus tard, l'app le dit et propose « Terminer ».
Elle ne termine pas d'elle-même — rien ne dit qu'on rentre plutôt qu'on passe
devant sa porte pour un second tour.

**Chaque kilomètre bouclé** s'affiche aussi à l'écran, huit secondes —
« Km 3 · 5:21 » —, pour qui court musique forte ou voix coupée.

**L'écran de fin** montre le croquis de la trace courue, qui se dessine, puis
la distance, le temps, l'allure, le D+ et les calories estimées ; un record — la
plus longue sortie, l'allure la plus rapide sur 3 km ou plus — passe devant ;
puis la comparaison aux passages d'avant sur le même chemin, les temps au
kilomètre, l'écart au prévu, et le cumul du mois. Partager, exporter en GPX, et
garder le parcours en favori se font de là.

**Le journal de la voix.** Chaque phrase dite pendant la sortie est gardée avec
elle — l'heure, la distance courue, la position, les mots — et se relit dans le
détail de la sortie, sous « Ce que la voix a dit ». C'est la vérification
d'une vraie sortie écran verrouillé : la voix s'est-elle tue, a-t-elle parlé
trop tard ? Il part avec la trace quand celle-ci n'est plus gardée.

**Les points d'eau**, quand ils sont cochés, s'annoncent cent
mètres avant — « Point d'eau dans cent mètres » —, une fois par kilomètre au
plus : à Paris, il y a une fontaine tous les deux cents mètres.

**Le départ se recale sur la position.** Pendant le décompte, si l'on est sur
la boucle à moins de 150 m de son repère de départ, elle tourne pour partir —
et arriver — là où l'on est : mêmes rues, même longueur (`restart.js`). Un
bout de rue pris à l'aller et au retour est coupé. Hors de la boucle, à tours
ou en « 8 », rien n'est touché. Et l'arrivée se déclenche aussi à l'endroit
d'où la sortie est vraiment partie, à 60 m au plus du départ du tracé.

**Deux repères**, dits avec les bornes kilométriques : « Mi-parcours » et « Il
reste mille mètres ». **Le signal perdu** se dit aussi, après 25 secondes sans
relevé utilisable, puis « Signal GPS retrouvé ».

**Le hors-parcours** se signale après trois relevés consécutifs à plus de 45 m
du tracé. Un point aberrant est banal entre deux immeubles ; trois de suite,
non. Le retour sur le tracé est annoncé aussi. Vingt secondes plus tard, un
nouveau chemin se calcule ; s'il n'y en a pas, l'app le dit **une fois** et
réessaie toutes les trente secondes en silence, le compte à rebours à l'écran —
redite à chaque essai, la phrase revenait des dizaines de fois à qui continuait
hors du tracé.

**Rentrer au départ** se propose en pause, à côté de « Terminer » : une
blessure, un orage, la nuit qui tombe, et la distance prévue ne compte plus. La
fin de la boucle est remplacée par le plus court chemin *sûr* jusqu'à la porte —
calculé sur le téléphone, avec les rues déjà chargées et le profil de la boucle,
rues signalées évitées (`engine/reroute.js`) —, puis guidée à la voix comme un
recalcul. Sans chemin, l'app le dit et garde la boucle.

**L'alerte de traversée** prévient 120 m avant chaque passage non protégé, avec
vibration. Elle revient à chaque passage : sur une boucle à tours ou un « 8 »
qui repasse par la porte, la même traversée se signale de nouveau une fois
500 m courus depuis l'alerte — assez loin pour qu'un recalcul fait à côté ne la
redise pas. Un recalcul au premier tour ne retire que les traversées déjà
passées, pas leur retour au tour suivant.

**Le bouton SOS** prépare un SMS vers un proche : position, distance parcourue,
temps écoulé. **L'app ne l'envoie pas** — elle ouvre l'application de messagerie,
c'est la personne qui appuie sur envoyer. Il s'arme par **appui maintenu** : un
bouton d'alerte posé à côté de « Terminer », sur un écran qu'on touche en
courant, part tout seul au premier frôlement. Le numéro reste sur l'appareil.

**Prévenir au départ et au retour** (« Mon compte → Sécurité », coupé par
défaut) : au « Démarrer », Messages s'ouvre vers ce même numéro avec la
distance, un lien vers le point de départ et l'heure prévue du retour — « Je
pars courir 10,2 km depuis ici : … Retour prévu vers 19:40. » Le compte à
rebours attend qu'on revienne dans l'app. À l'arrivée, l'écran de fin propose
« Prévenir que je suis de retour », jamais tout seul : « Terminer » peut venir
d'ailleurs que de la porte, et un « tout va bien » parti trop tôt rassurerait à
tort. Sans serveur, pas de suivi en direct à la LiveTrack ; ces deux SMS en
gardent l'essentiel (`contact.js`).

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

**Le départ d'une sortie, lui, garde la carte de son parcours tout seul**, en
fond pendant le compte à rebours. Le réseau tombe souvent là où l'on n'a jamais
regardé la carte de près — en forêt, en montagne — et c'est là qu'un trou noir
gêne le plus. Pour ne pas remplir le téléphone, seules les **cinq dernières
sorties** gardent la leur ainsi ; la sixième chasse celle qu'on a courue le
moins récemment. Une boucle de campagne pèse moins d'un mégaoctet : autour de
chez soi, quelques mégaoctets en tout. Les cartes gardées à la main ne partent
jamais. Une carte gardée se reprend au départ suivant **passé deux mois** — une
rue change rarement, la reprendre à chaque retour du réseau coûterait du forfait
pour rien — ou si l'on a changé de fond. Et un téléchargement dont aucune tuile
n'est arrivée n'est plus enregistré : il affichait « ✓ 0 o » sur une carte
noire.

**Le relief part avec la carte.** Sans réseau, l'IGN ne répond plus, et une
boucle cherchée dehors n'avait plus de D+. Garder la carte d'un parcours garde
aussi ses tuiles d'altitude (Terrain Tiles d'AWS, Mapzen / Copernicus EU-DEM, au
zoom 12), une de plus tout autour : environ un mégaoctet, de quoi chercher
d'autres boucles alentour. Le moteur les lit quand l'IGN se tait, au réglage
grossier du D+ (−1 % au total contre l'IGN), et ne range pas ces altitudes dans
son cache : le réseau revenu, l'IGN reprend la main.

Trois choses ont été apprises en mesurant, et chacune a changé le code :

**Le zoom 14 suffit — pour les fonds vectoriels.** La source OpenFreeMap
s'arrête au zoom 14 : au-delà, le moteur agrandit la même tuile au lieu d'en
demander d'autres. Garder du zoom 10 au zoom 14 donne donc, hors ligne, exactement
ce qu'on voit en ligne. Nature et Satellite, des images plus fines, ne se gardent
pas : hors ligne, la carte prend le fond Nuit, et « Mon compte » le dit.

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
