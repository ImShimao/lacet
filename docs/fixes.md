# Ce que les coureurs reprochent aux autres apps, et ce que Lacet en fait

Échantillon : **764 avis App Store** (États-Unis, France, Royaume-Uni), lus le 2026-10-18 par le flux
RSS officiel d'Apple : Komoot 232, Footpath 150, AllTrails 129, RunGo 109, Strava 65, RunnrZ 52,
Trail Router 20, Roovr 4, RunGen 3. Pour Strava, Komoot et AllTrails, seuls les avis qui parlent
d'itinéraire, de carte ou de guidage sont gardés. Une seule source (l'App Store) : Google Play,
Reddit et les forums ne sont pas lus — la fiche Play de Roovr était illisible.

Les comptes viennent de mots-clés (`themes.json`) : ils donnent un ordre de grandeur, pas une
mesure. Chaque citation est recopiée mot pour mot de `reviews.csv` ; le lien mène à la page d'avis de
l'app (le flux n'a pas de lien par avis).

## 1. Ce qu'ils détestent

| # | problème | avis (≤ 3★) | apps | Lacet aujourd'hui |
| --- | --- | --- | --- | --- |
| 1 | **Le guidage vocal lâche** : il se tait au bout de quelques virages, écran verrouillé, ou annonce des virages qui n'existent pas | 118 (55) | 8 | voix native, consignes filtrées — **non vérifié en course réelle** |
| 2 | **Fonctions passées en payant** — RunnrZ en 2026 : GPX, plus de 13 km, plus de 5 parcours | 140 (96) | 8 | gratuit, sans compte |
| 3 | **Envoyé sur un grand axe sans trottoir** | 36 (25) | 6 | c'est le cœur de Lacet : L0 + note A/B/C |
| 4 | **Hors parcours, pas de recalcul**, ou un recalcul qui ramène sur l'obstacle | 41 (22) | 6 | recalcul local qui tient la distance ; signalement qui écarte le point |
| 5 | **Chemins privés, fermés, ou qui n'existent plus**, surtout en forêt | 20 (14) | 5 | privé et portails fermés exclus ; **chemins fantômes non traités** |
| 6 | **Hors ligne qui plante**, « erreur réseau » en pleine 5G | 25 (13) | 6 | rues et fond de carte gardés, moteur sur le téléphone |
| 7 | **Suivi qui se fige** : widget d'écran de verrouillage gelé, course en pause seule | 17 (11) | 6 | activité en direct écrite pour « ne jamais rendre du vide » |

Citations :
- RunnrZ, 4★ — après un signalement de chemin privé, « elle tenait à me faire passer par ce chemin »
  ([avis](https://apps.apple.com/fr/app/id1599120893?see-all=reviews)).
- Trail Router, 3★ — la voix : « intermittent at best, usually slow, and often silent all together »
  ([avis](https://apps.apple.com/us/app/id1500479574?see-all=reviews)).
- RunGo, 1★ — « If you go off course just once the entire mapping is done »
  ([avis](https://apps.apple.com/us/app/id712628644?see-all=reviews)).
- Footpath, 1★ — « The app puts me on roads where there is no footpath »
  ([avis](https://apps.apple.com/gb/app/id634845718?see-all=reviews)).
- Komoot, 3★ — « Aucun itinéraire de substitution n’est proposé »
  ([avis](https://apps.apple.com/fr/app/id447374873?see-all=reviews)).
- RunnrZ, 3★ — le guidage : « me dise d’aller à droite pour aller tout droit »
  ([avis](https://apps.apple.com/fr/app/id1599120893?see-all=reviews)).
- RunGo, 2★ — la voix se coupe, il faut « keep your phone unlocked for the duration the run »
  ([avis](https://apps.apple.com/gb/app/id712628644?see-all=reviews)).

## 2. Ce qui manque (demandé par son nom)

| # | demande | avis | apps | qui l'a déjà | Lacet |
| --- | --- | --- | --- | --- | --- |
| 1 | **Points de passage** (« passer par ») | 58 sur le contrôle du tracé | 8 | RunnrZ 2.3, Apple Plans, Komoot, Footpath | non |
| 2 | **Choisir son dénivelé, en mètres** | 31 | 7 | Roovr, Strava (plat/vallonné) | trois fourchettes, pas de chiffre |
| 3 | **Rentrer maintenant** (blessure, météo) | thin : 1 avis | 1 | RunnrZ 2.4 « parcours retour » | non |
| 4 | **Marquer une rue comme dangereuse ou impraticable** | thin : 5 avis | 2 | — | oui (« Danger », « Passage fermé », sur l'appareil) |
| 5 | **Apple Watch** | 47 mentions, souvent pour se plaindre du lien montre–téléphone | 6 | Strava, Komoot, RunGo | non |
| 6 | **Choisir la direction** | 0 avis (offre, pas demande) | — | Roovr, Garmin | non |

- RunnrZ, 5★ — « on ne peut pas demander un D+ en particulier »
  ([avis](https://apps.apple.com/fr/app/id1599120893?see-all=reviews)).
- Trail Router, 3★ — « Without the ability to set waypoints, all it can do is suggesting some random
  routes » ([avis](https://apps.apple.com/us/app/id1500479574?see-all=reviews)).
- Footpath, 4★ — devoir tout recréer pour rentrer : « this is a huge safety flaw »
  ([avis](https://apps.apple.com/us/app/id634845718?see-all=reviews)).
- Trail Router, 4★ — « Is there a way to mark streets as unsafe? »
  ([avis](https://apps.apple.com/us/app/id1500479574?see-all=reviews)).

## 3. Ce que personne ne résout

1. **La sécurité calculée dans un générateur de boucles.** Les générateurs (RunnrZ, Roovr, Trail
   Router) disent « rues calmes », sans note ni garantie ; les apps de sécurité (LIT Run, Walkable,
   SafeRoute) notent sans générer. Komoot, 3★ : « Tells me nothing about car traffic on the route »
   ([avis](https://apps.apple.com/us/app/id447374873?see-all=reviews)). C'est la place de Lacet.
2. **Le terrain réel n'est pas la carte.** Chemins fermés, privés, disparus : tout le monde fait
   confiance à OSM et laisse le coureur se débrouiller. Lacet a déjà la moitié de la réponse — le
   signalement qui recalcule ; la suite, ce sont les chemins fantômes.
3. **Une boucle pour une séance** (« 6 × 400 m sur du plat ») : aucune app trouvée ne le fait — déjà
   noté dans `docs/limites.md`.

## 4. Le plan pour Lacet

Classé par preuve × coût. Chaque point est une ligne `no` ou `partial` de `features.csv`.

| # | quoi | taille | où | preuve |
| --- | --- | --- | --- | --- |
| 1 | **Rentrer maintenant** : un bouton en pause, « Rentrer au départ », qui trace le plus court chemin *sûr* jusqu'à la porte et le guide à la voix. Le moteur a les pièces : un Dijkstra depuis la position, avec le profil de la boucle, comme `planRejoin`. | S | `reroute.js`, `LiveRun.jsx`, `RunPanel.jsx` | Footpath (« huge safety flaw »), RunnrZ l'a livré en 2.4 ; preuve mince, mais c'est le geste de sécurité le plus simple |
| 2 | **Prouver la voix sur une sortie entière** : un test qui rejoue une trace GPS sur toute une boucle et exige chaque manœuvre dite deux fois, puis une vraie sortie écran verrouillé avec le journal des consignes dites. Les concurrents meurent de ce défaut. | S | `LiveRun.test.jsx`, `guidance.js`, `voice.js` | 118 avis sur 8 apps, plainte n° 1 |
| 3 | **Écarter les chemins fantômes** : `trail_visibility=bad/horrible/no`, `abandoned:highway`, `disused:highway`, `smoothness=impassable`, `informal=yes` hors mode Sentier. Python **et** JS, puis `parity_dump.py`. À vérifier : que les archives (`pack_tiles.py`, dépôt lacet-data) gardent ces balises. | S | `safety/exclusion.py`, `engine/safety.js` | 20 avis sur 5 apps, plainte n° 1 chez RunnrZ |
| 4 | **Partir vers…** : une ligne des filtres, « Direction : Auto · N · NE … », qui garde les polygones orientés à ± 45° de ce cap. Le classement sait déjà pénaliser des caps (`selectVaried`, `avoidBearings`) ; ici on les préfère. Propre à l'app, la parité le coupe comme `WIDEN_ROUNDS`. | S–M | `FiltersSheet.jsx`, `engine/service.js` | Roovr et Garmin l'offrent ; Lacet affiche déjà la direction de chaque boucle |
| 5 | **D+ visé** : « environ 150 m » remplace la cible de la fourchette (m/km = D+ / distance), la fourchette se centre dessus. | S–M | `service.py`, `service.js`, `FiltersSheet.jsx` | RunnrZ (3 avis), 31 avis sur le dénivelé |
| 6 | **Prévenir un proche** : au départ, un SMS préparé (« Je pars courir 10 km, retour vers 19 h 40 » + lien carte) ; à l'arrivée, « Bien rentré ». Même chemin que le SOS, sans serveur. | S | `SosButton.jsx`, `LiveRun.jsx` | LIT Run, Strava Beacon, Garmin LiveTrack, Komoot ; `docs/limites.md` |
| 7 | **Passer par un point** : un appui long sur la carte, « Passer par ici » ; le point devient un sommet du polygone, les autres se placent autour. La boucle reste une boucle, notée comme les autres. | M | `engine/loops.js`, `service.js`, `MapView.jsx` | 58 avis sur le contrôle, 8 apps ; RunnrZ 2.3 |
| 8 | **Survol 3D** de la boucle choisie, carte inclinée qui suit le tracé. Plaisir, pas sécurité : en dernier. | M | `MapView.jsx` | Roovr, cité dans 1 avis sur 4 |

Pas retenus : l'Apple Watch — la demande est réelle (47 mentions, 6 apps), mais c'est une app
watchOS native et une signature AltStore de plus : L, à revoir avec un compte développeur, le suivi en direct (il faut un serveur), la heatmap (données propriétaires), les
sorties de rond-point (vélo seulement).

Ce que Lacet ne doit **pas** perdre, parce que c'est là que les autres sont punis : pas de compte,
pas de paywall sur le GPX ni sur la distance, le hors ligne, et le refus des routes exposées.

## 5. L'angle

```
A. Pour les coureurs qu'une app a déjà envoyés sur une départementale sans trottoir,
   Lacet note chaque boucle A, B ou C et refuse les routes exposées.
   Preuve : routes dangereuses, 36 avis (25 à 3★ ou moins) sur 6 apps ; aucun générateur ne note.

B. Pour ceux que l'app a lâchés au premier chemin fermé,
   Lacet recalcule sur le téléphone, sans réseau, en tenant la distance.
   Preuve : hors parcours 41 avis, chemins fermés 20, hors ligne 25, sur 5 à 6 apps.

C. Pour ceux qui ont vu leur app de boucles devenir payante,
   Lacet est gratuit, sans compte, et ne met ni le GPX ni la distance derrière un abonnement.
   Preuve : 140 avis sur le prix, dont la bascule payante de RunnrZ en 2026.
```

**Recommandé : A**, avec B comme preuve. C'est ce que Lacet fait déjà mieux que tous, et la seule
promesse qu'aucun concurrent ne peut copier sans refaire son moteur. C est fragile : une app gratuite
peut le dire aussi (Roovr le dit).
