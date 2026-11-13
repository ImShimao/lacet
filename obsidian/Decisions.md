---
type: journal
tags: [decisions]
---

# Journal des décisions

Retour : [[Accueil]]

Ajouter une entrée quand un choix a coûté du temps ou peut être remis en cause. Format : date, choix, pourquoi, et la mesure qui l'a tranché si elle existe.

## Calibrages

- **2026-10-04, dénivelé annoncé** : relevé tous les 50 m, noyau triangulaire de 60 m, seuil de 1 m. Avant : 100 m, moyenne sur 3 points, seuil 2 m, soit −10 % de total et 15 % d'écart moyen. Après : −1 % et 1,7 %. Hors de France (Valhalla) : noyau 100 m, seuil 3 m.
- **2026-10-04, D+ mesuré** : baromètre de l'iPhone, lissage 4 s, seuil 1 m compté depuis le creux. L'altitude GPS ne sert plus que de repli. **Pas encore testé sur une vraie sortie** : voir [[Taches]].
- **Seuil de la note A** : 1 % au contact du trafic et aucune traversée non protégée. Seuil de « au contact » : risque supérieur à 1,5 (route à 80 sans trottoir). Voir [[Securite]].
- **Seuil de vitesse du risque** : 40 km/h. En dessous, courir sur la chaussée est normal.
- **Voies communales** comptées à 60 km/h (et non 80) : à 80, la recherche à pied rendait des tours de 2 km répétés ; à 60, cinq vraies boucles A ou B.
- **Traversées** : le budget grandit au-delà de 10 km seulement. Mesuré : à Lyon à pied 0 par 10 km, semi en Bourgogne 5,7 à 11,4.
- **Un trottoir inféré** en zone bâtie à 50 km/h ou moins, aucun ailleurs (asymétrie : en rase campagne le faux positif est dangereux).
- **Distance de fusion des traversées** : 25 m (`CROSSING_MERGE_M`).

## Génération

- **Points de passage sur 180°, pas sur 360°** : le départ est un sommet, pas le centre. Sur 360°, la rondeur tombait à 0,03.
- **Tirages supplémentaires s'ajoutent**, ne remplacent pas : remplacé, le lot changeait du tout au tout (Guebwiller 5 km, −1,73 → −2,58).
- **Régénérer tourne d'une fraction du nombre d'or** : jamais le même angle deux fois.
- **Tours après les boucles entières** : un tour de plus ne retirait que 0,12 point, il doublait des boucles entières B.
- **Fourchettes de réglage** (plat, vallonné, côtes, terrain) : sortir d'une fourchette coûte plus que la variété ne rapporte. Réglage passe avant la note, de deux crans.
- **Vent** : poids 0,10, rien sous 12 km/h, échec silencieux. Un agrément ne doit jamais devenir un critère.
- **Bonus vert** : 25 % / 15 % (vert / balisé), meilleur compromis mesuré.
- **Formes allongées** : essayées, **pas gardées** (elles prenaient la place de boucles régulières mieux notées en plaine).
- **Pente payée en vallonné** : essayée, **pas gardée** (les chemins sont dans les côtes).

## Interface

- **2026-10-30, direction visuelle** : moins de violet, plus pro et lisible. Accent au choix, page Apparence.
- **Pas de zoom de page** : `maximum-scale=1` et champs ≥ 16 px. Sinon iOS zoome toute l'app au toucher de la recherche.
- **Aplats plutôt que dégradés**, gris ardoise neutres, une seule police (Inter) dont les chiffres à chasse fixe alignent les colonnes.
- **Couleurs de sécurité fixes** (vert, jaune, rouge) : distinguables en deutéranopie et protanopie. La note se lit aussi en lettre.
- **Carte** : le cadrage tient compte de tout ce qui flotte (`dockPadding`) pour que rien ne passe dessous.
- **Pas d'animation du tracé en course** ni quand l'iPhone demande de réduire les animations.

## Livraison

- **2026-10-19, installation** : SideStore remplace AltStore. Sideloadly ne signe pas l'extension (sans elle, l'activité en direct ne s'affiche pas, sans message).
- **2026-11-13, doc** : `docs/app-iphone.md` passe à SideStore (LocalDevVPN, iloader, couplage). Procédure tirée de guides tiers, à confirmer sur sidestore.io. `README.md` garde AltStore, à mettre à jour.
- **Sans HealthKit** : ni AltStore ni SideStore ne l'activent.
- **Strava retiré** (octobre 2026) : export GPX horodaté à la place, importé sur le site de Strava.
- **Voix native** via `VoicePlugin` : iOS, sans clé, sans réseau.
- **User-Agent « Lacet/1.0 »** : Overpass refuse les navigateurs depuis l'automne 2026.
- **Source AltStore servie depuis un lanceur au démarrage**, pas depuis une session Claude Code (le serveur mourait avec elle).

## Moteur (architecture)

- **JS = portage fidèle de Python.** Python reste la référence : il note la sécurité, et une erreur de portage ne se verrait pas à l'écran. Changer un calcul partagé = les deux + parité.
- **Arithmétique CPython** dans `engine/py.js` (modulo flottant, arrondi au pair).
- **Pas de serveur** : l'app calcule tout sur le téléphone. Python sert à la vérification.
- **Plus de cache sans fin** : plafond de 250 Mo, éviction des carreaux les moins récents.
- **Budget de chargement** : quarante secondes pour les rues, quinze pour le relief. Rien n'attend indéfiniment.

## Données

- **Archives `lacet-data`** : lues par plages d'octets via `raw.githubusercontent`. jsDelivr écarté : ses plages portent sur une version encodée.
- **Région livrée** : toute l'Alsace, débordée de six kilomètres (fusion avec les régions voisines), pour que la frontière ne laisse pas de trous.
- **Tuiles hors ligne** : zoom 14 pour les fonds vectoriels (la source déclare `maxzoom: 14`). Plafond réel 40 Mo, en octets.
- **Une seule clé de tuiles** : `tiles-a` à `tiles-d` tirés au hasard par le rendu. Sans cela, trois tuiles sur quatre manquent.

## Autonomie

- Le « oui » de l'utilisateur vaut jusqu'au push, à l'IPA et à la source AltStore. Voir la mémoire `lacet-autonomy`.
