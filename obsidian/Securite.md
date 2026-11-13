---
type: categorie
tags: [securite, note]
---

# Sécurité : moteur et notes A, B, C

Retour : [[Accueil]] · Source : `docs/securite.md`

C'est le cœur du produit. Six couches, dans `backend/app/safety/` (et leur portage dans `frontend/src/engine/safety`, parité testée, voir [[Moteur]]).

**L'app ne garantit pas la sécurité.** Elle privilégie les voies protégées d'après OpenStreetMap, qui peut être incomplet ou en retard. Cette formulation doit rester dans l'interface.

## Les six couches

**L0 — Exclusion** (`exclusion.py`). Autoroutes, voies rapides, tunnels sans trottoir, chemins interdits aux piétons : **retirés** du graphe, pas pénalisés. Aucune pondération ne peut les faire revenir.
- Chemins disparus (`abandoned=yes`, `disused=yes`, `trail_visibility=horrible|no`) : exclus dans tous les modes. Mal tracés (`bad`, `informal=yes`, `impassable`) : exclus hors mode Sentier, sauf `impassable` à vélo.
- Mesuré autour de Guebwiller, Soultz, Buhl, Wuenheim et Lautenbach (boucles de 10 km, mode Mixte) : 6 boucles sur 25 empruntaient des chemins abandonnés (jusqu'à 1,9 km) ; aucune après, 18 notées A au lieu de 20.

**L1 — Risque** (`risk.py`) :

```
risque = ((v − 40) / 30)² × (1 − sep / 2)
```

Le seuil de 40 km/h est le calibrage central : en dessous, courir sur la chaussée est normal, et un détour systématique rendrait l'app inutilisable.

| Voie | Risque | Verdict |
|---|---|---|
| Rue à 30, ou trottoir | 0 | — |
| Rue à 50 sans trottoir | 0,11 | normal |
| Voie communale (comptée à 60) | 0,44 | pénalisée |
| Route à 70 sans trottoir | 1,00 | acceptable |
| Route à 80 avec accotement | 0,89 | acceptable |
| Route à 80 sans rien | 1,78 | **exposé** |
| Voie rapide | — | exclue en L0 |

- **Voies communales** (`unclassified`) : limitées à 80 mais comptées à 60 (étroites, sans marquage, desservent hameaux et vignes). Comptées à 80, la recherche à pied ne rendait que des tours de 2 km répétés ; à 60, cinq vraies boucles A ou B. Une limite taguée l'emporte toujours.
- **Séparation selon le sport** : un trottoir protège un coureur, pas un cycliste (il lui faut une bande ou une piste). Une piste cyclable protège les deux.
- **Droits d'accès à vélo** : lus sur `bicycle`, pas sur `foot`. Mesuré dans le centre de Lyon : 32 boucles vélo remontaient toutes un sens interdit (17 km) ; aucune après. Les sens uniques s'appliquent à vélo, sauf contresens cyclable.
- **Voies piétonnes** à vélo : coût quatre fois la longueur, sauf `bicycle=yes`.
- **Voies sans voitures d'abord** (case des filtres, cochée par défaut, propre à l'app) : pistes, chemins et allées coûtent 0,6 fois leur longueur. La route ne sert que là où il n'y a pas d'autre passage. Le bonus ne va qu'aux surfaces acceptées par le terrain choisi (un chemin de terre n'est pas une piste pour un vélo de route).

**L2 — Règle du doute** (`risk.py`). Le tag `sidewalk` manque sur la majorité des rues françaises. L'inférence est **asymétrique** : trottoir probable en zone bâtie à 50 km/h ou moins, aucun trottoir supposé ailleurs. En cas de doute, on pénalise.

**L3 — Portail** (`gate.py`). Une bonne pondération ne suffit pas : le routeur prendra 800 m de départementale s'il n'a pas mieux. Contrôle après génération, règles binaires, un candidat qui échoue est **jeté**.

| Critère (mode Sûr) | À pied | À vélo |
|---|---|---|
| Part du parcours exposée | > 3 % | > 8 % |
| Portion exposée continue | > 150 m | > 1 000 m |
| Traversées non protégées, sortie ≤ 10 km | > 2 | > 3 |
| … par tranche de 10 km au-delà | +4 | +5 |
| Tunnel sans trottoir | > 0 m | > 0 m |
| Écart de bouclage | > 50 m | > 50 m |
| Tracé parcouru deux fois | > 25 % | > 25 % |

- Le seuil de **portion continue** est le plus important : traverser une départementale sur 20 m va, la longer sur 900 m non. Un critère en pourcentage seul laisse passer le second.
- **Pourquoi le seuil dépend du sport.** Un cycliste roule sur la chaussée par définition : sur 80 km au départ de Lyon, aucun itinéraire ne s'en passe. Avec les seuils de la course, le mode Sûr rejetait **tout** (11 candidats sur 15 pour ce seul motif).
- **Pourquoi le budget de traversées grandit avec la distance.** Mesuré : Lyon 10 km à pied, 0 ; Lyon 30 km à vélo, 0 à 1 ; semi en Bourgogne, 5,7 à 11,4 ; 80 km à vélo, 4,4 à 12,2 (par 10 km). Le supplément ne démarre qu'au-delà de 10 km : une sortie urbaine garde les seuils d'origine.
- **Une traversée en décalé compte une fois** : deux traversées à moins de 25 m le long du parcours n'en font qu'une (`CROSSING_MERGE_M`). Les tours, qui repassent au même endroit, comptent chacun.

**L4 — Nuit** (`night.py`). Modèle distinct, qui inverse le premier : de jour on s'éloigne du trafic, de nuit un sentier isolé devient le pire choix. Facteur `night_factor`, longueur sans éclairage `unlit_length`.

**L5 — Forme** (`geo.roundness`). Le quotient isopérimétrique `4πA/P²` distingue une boucle d'un aller-retour dont le retour passe par la rue parallèle.

## Le côté de la route

Code de la route, article R412-36 : hors agglomération et sans trottoir praticable, le piéton marche **sur le bord gauche**, face aux voitures. C'est le défaut de l'app (`side`, dans « Mon compte › Recherche »). Droite ou indifférent sont possibles. Le tracé en tient compte là où les données le permettent (tour des ronds-points, voir [[Moteur]]). Ailleurs, OSM dit rarement de quel côté est le trottoir (3 à 4 % des rues autour de Guebwiller ont un tag `sidewalk`), et le côté se choisit sur place. À vélo, on roule à droite et le réglage ne change rien.

## La note A, B, C

La lettre résume **la sécurité du tracé, et elle seule** : ni beauté, ni longueur, ni dénivelé.

| Note | Condition |
|---|---|
| **A** | Au plus 1 % du parcours au contact direct du trafic, **et aucune** traversée non protégée. |
| **B** | Au plus 3 % au contact du trafic. Aussi : une boucle sans exposition qui traverse une voie rapide sans passage protégé. |
| **C** | Au-delà. N'apparaît qu'en mode Standard : le portail du mode Sûr rejette ces tracés. |

- **« Au contact du trafic »** : un tronçon dont le risque dépasse 1,5, soit une route à 80 km/h ou plus sans trottoir ni accotement. Une rue à 50 et une route à 70 n'y entrent pas, sinon tout serait C.
- **En mode Sûr à pied**, l'exposition est plafonnée à 3 % : un B signale donc presque toujours une **traversée**, pas une portion longée. Le détail sous la proposition dit lequel.
- Une boucle entièrement sur trottoirs qui coupe une départementale sans passage piéton est B : ces quelques secondes sont le vrai risque d'une sortie à la campagne, et l'app prévient 120 m avant.
- **Le pourcentage de la carte** (« 64 % hors chaussée ») ne compte que trottoirs et chemins **connus d'OSM**. Le vert de la bande se nomme « voie calme ou protégée ».

**Classement** : d'abord les propositions qui tiennent le dénivelé et le terrain demandés, puis, à réglages tenus, une A passe toujours devant une B. Avant, les traversées comptaient dans la note sans compter dans le score, et l'app affichait un B en tête suivi de A.

## Points de vigilance

- Une traversée non protégée est traitée à part (`tunnel_is_unprotected` pour les tunnels).
- La nuit, le tronçon sans éclairage pèse dans la note.
- La mention « la sécurité n'est pas garantie » ne se retire pas.
- Changer un seuil : Python d'abord, justification notée dans [[Decisions]], puis parité.

## Liens

[[Moteur]] · [[Donnees]] (ce qu'OSM apporte ou oublie) · [[Limites]] · [[Taches]]
