# La sécurité

[← Lacet](../README.md) · [Toute la documentation](README.md)

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
| Voie communale sans limite taguée (comptée à 60) | 0,44 | pénalisée |
| Route à 70 sans trottoir | 1,00 | acceptable |
| Route à 80 avec accotement | 0,89 | acceptable |
| Route à 80 sans rien | 1,78 | **exposé** |
| Voie rapide | — | exclue en L0 |

Les voies communales (`unclassified`) sont limitées à 80, mais on n'y roule pas
à 80 : étroites, sans marquage, elles desservent des hameaux et des vignes.
Comptées à 80, elles valaient une départementale, et autour de Meursault la
recherche à pied ne rendait que des tours de 2 km répétés quatre fois ; comptées
à 60, cinq vraies boucles notées A ou B. Une limite taguée l'emporte toujours.

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
pas « dans l'autre sens ». Les voies piétonnes — trottoirs, rues piétonnes — se
roulent au pas : elles coûtent quatre fois leur longueur à vélo, sauf ouvertes
aux vélos (`bicycle=yes`). Les rues piétonnes y échappaient jusqu'ici, faute de
voitures, et les boucles traversaient le centre piéton comme une piste.

**Voies sans voitures d'abord** — une case des filtres, cochée par défaut, propre
à l'app (`engine/weights.js`). La sécurité seule ne départage pas une piste d'une
rue à 30 : le moteur prenait la plus courte, et longeait une zone commerciale à
Guebwiller plutôt que la piste cyclable d'à côté. Pistes, chemins et allées
coûtent désormais 0,6 fois leur longueur ; la route ne sert que là où il n'y a
pas d'autre passage, ou pour varier les boucles. Sur cet exemple : 890 m sur la
piste au lieu de 197, pour 78 m de plus. Le trottoir dessiné à part ne compte
pas — il longe la rue. Et le bonus ne va qu'aux surfaces que le terrain choisi
accepte : un chemin de terre n'est pas une piste pour un vélo de route. Sans
cette borne, une boucle vélo « Route » de 30 km autour de Meursault passait à
31 % dans les vignes ; autour de Guebwiller, la part goudronnée des boucles
« Route » passe de 50 à 60 % à pied, de 71 à 77 % à vélo.

**Régénérer montre d'autres boucles.** Tourner les polygones change les sommets
visés, pas les meilleures rues : une régénération sur deux remontrait une boucle
déjà vue. Le moteur garde les boucles montrées depuis la dernière recherche
ordinaire et fait passer les neuves devant ; sur Beaune et Lyon, les boucles
régénérées déjà vues à plus de moitié passent de 67 sur 165 à 21 — celles qui
restent, c'est que le coin n'en offre pas d'autres. Valider les filtres sans
rien y changer régénère aussi.

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

**Les propositions sont classées par réglages, puis par note.** D'abord celles
qui tiennent le dénivelé et le terrain demandés — une demande de plat ou de
sentier est un réglage, et toute proposition a passé le portail du mode choisi
(voir [la génération](generation.md#la-préférence-de-terrain)). Puis, à
réglages tenus, une A passe toujours devant une B, même si la B est plus ronde,
mieux calibrée ou dans une direction plus originale. Ce n'était pas le cas à
l'origine : les traversées non protégées comptaient dans la note sans compter
dans le score, et l'app pouvait afficher un B en tête suivi de A — se
contredisant sous les yeux de l'utilisateur. À note égale, le score départage :
distance, exposition fine, forme, variété, dénivelé.
