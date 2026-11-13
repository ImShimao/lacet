---
type: suivi
tags: [taches, suivi]
---

# Tâches : ce qui reste

Retour : [[Accueil]] · Voir aussi [[Limites]] (limites assumées, pas des tâches) et [[Decisions]].

Relevé le 2026-11-13 à partir de `docs/`, du code (aucun `TODO` ni `FIXME` dans `frontend/src` ni `backend/app`) et de l'historique récent. Coche une case quand c'est fait, et date-la.

## À faire

- [ ] **Brancher le débit de la voix côté natif.** `docs/guidage.md` (l. 83) : le réglage de vitesse de la voix s'arrête côté JS, `VoicePlugin.swift` ne le reçoit pas encore.
- [ ] **Relief en un seul envoi, en phase de test.** Une requête IGN coûte ~3 s quel que soit le nombre de points (mille points = 3,1 s). C'est le plus gros poste restant une fois les rues sur l'appareil (`docs/performances.md` l. 116-122). À mesurer sur iPhone avant de toucher quoi que ce soit.
- [ ] **Refaire les captures de `docs/images/`** si l'écran de fin a changé (commit `2da772e` : trace coloriée, verdict, records, partage). Règle du projet : refaire quand l'écran montré change. À vérifier écran par écran.
- [ ] **Mesures autour de Guebwiller / Soultz** : la mémoire de travail le note comme en cours. Les chiffres de `docs/generation.md` datent de l'automne ; à relancer après les changements de la semaine.
- [ ] **Hébergement de production** : Overpass est partagé, les tuiles CARTO ne sont pas prévues pour une diffusion large. Décision à prendre avant toute diffusion publique (`docs/limites.md`).

## À vérifier sur iPhone (pas encore testé dans l'app installée)

- [ ] **Dénivelé au baromètre** : le calcul est en place (`AltimeterPlugin`, seuil d'un mètre, lissage de 4 s), mais pas encore validé sur une vraie sortie. Le calibrage (50 m, noyau 60 m, seuil 1 m) date du 2026-10-04 (`Decisions`).
- [ ] **Repli GPS du dénivelé** : quand « Mouvements et forme » est refusé, le bilan doit dire que c'est un ordre de grandeur. À vérifier dans l'app.
- [ ] **Voix sur une sortie entière, écran verrouillé** : les tests simulent une allure de course (`LiveRun.voice.test.jsx`), mais la vraie sortie reste la seule preuve. Vérifier le virage annoncé tôt et l'arrivée.
- [ ] **Cartes hors ligne** : le plafond de 40 Mo par parcours et le téléchargement lent sont à valider sur un trajet réel.
- [ ] **Installation SideStore** : la source doit répondre (`curl http://192.168.1.96:8765/source.json`) après chaque redémarrage du PC.

## Idées, pas engagées

- [ ] **Séance du jour** : « 6 × 400 m » → une boucle avec une ligne droite plate de 400 m près de chez l'utilisateur. Aucune app ne le fait bien aujourd'hui (`docs/limites.md`).
- [ ] **Partage live** d'une sortie en cours.
- [ ] **Couche communautaire** de signalements, avec seuil anti-abus.

## Fait récemment

Ces points sont livrés. Liste tirée de l'historique git, du plus récent au plus ancien.

- [x] Écran de fin : trace coloriée par allure, verdict, derniers mètres, profil, records 1, 5, 10 km, ressenti, partage en image (`2da772e`)
- [x] Voix : pas de « demi-tour puis à droite » pour un simple virage ; l'arrivée annoncée après le dernier virage (`955cd0b`)
- [x] Page d'accueil du dépôt avec six captures refaites à Annecy (`1610304`)
- [x] Favori renommé, retrait confirmé, couleurs suivent « Apparence » (`2a87e05`)
- [x] Détour qui ramène près du départ, filtré (`9467cbb`)
- [x] Filtres vélo : distances et durées d'un cycliste (`0c959eb`)
- [x] Page « Apparence » : couleur d'accent au choix (`e0c6061`)
- [x] Rond-point contourné à gauche dans l'app et côté moteur Python (`2438336`, `69c08c7`)
- [x] Réglage du côté de la route dans « Mon compte › Recherche » (`e78f40f`)
- [x] Zone à éviter posée sur la carte, déplaçable par sa poignée (`42138a2`, `4323756`)
- [x] Survol 3D avec pastille sur la boucle (`8cade67`)
- [x] Voix réglable dans « Pendant la sortie » (`74dfa70`)
- [x] Arrivée mieux détectée et fêtée (`3504b46`)

## Fichiers à ne pas oublier

- Après un changement du moteur : `parity_dump.py` puis `parity.test.js` ([[Moteur]]).
- Après un push qui touche `frontend/` : vérifier l'IPA sur GitHub ([[iPhone]]).
