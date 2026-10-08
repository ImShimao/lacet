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
