---
type: index
tags: [accueil]
---

# Lacet : accueil

Lacet propose des boucles de course qui reviennent à la porte, notées A, B ou C selon leur sécurité, puis guide à la voix pendant la sortie, écran verrouillé. Tout tourne sur le téléphone.

## Par catégorie

- [[Produit]] : ce que fait l'app, guidage, interface
- [[Moteur]] : boucles, graphe, Python ↔ JS, parité
- [[Securite]] : notes A, B, C et ce qui les fixe
- [[Donnees]] : OpenStreetMap, tuiles, archives de rues, altitudes
- [[iPhone]] : IPA, SideStore, AltStore, code natif
- [[Performances]] : appareil, robustesse, tailles
- [[Dev]] : commandes, tests, conventions
- [[Decisions]] : journal des choix et calibrages
- [[Limites]] : limites assumées et suite
- [[Taches]] : ce qui reste à faire, à vérifier sur iPhone, et ce qui est livré

## Où est la vérité

Ces notes résument et relient. Le détail vit dans le dépôt, et c'est lui qui fait foi :

- `CLAUDE.md` à la racine : architecture, commandes, règles de travail
- `docs/` : un fichier par thème (`securite.md`, `generation.md`, `guidage.md`…)
- `backend/app/` : moteur Python de référence, chaque seuil y est justifié

Si une note et le code divergent, c'est la note qui est fausse.
