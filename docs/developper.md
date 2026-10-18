# Développer

[← Lacet](../README.md) · [Toute la documentation](README.md)

## Démarrer (première fois)

```bash
cd frontend
npm install
```

Et pour le moteur de référence Python, une fois :

```bash
cd backend
python -m venv .venv
.venv\Scripts\python.exe -m pip install -r requirements-dev.txt
```

## Lancer

```powershell
cd frontend; npm run dev
```

Puis **http://127.0.0.1:5173**, à la taille d'un téléphone (les outils de
développement du navigateur, ou l'aperçu de l'éditeur). C'est l'interface, pour
la développer — pas l'app : le GPS, la voix, l'écran de verrouillage, le
baromètre et les vibrations n'existent que dans l'app installée. La position y est donc
toujours « indisponible », et l'app retombe sur le dernier départ choisi.

Le moteur de référence Python n'a plus de serveur : l'app calcule tout sur le
téléphone. Il s'interroge par ses tests, par `scripts/smoke.py` (plus bas), et
par `scripts/parity_dump.py`, qui écrit la réponse que le moteur de l'app doit
reproduire.

## Tester dans VS Code

**Débogage** — `F5`, puis choisis une configuration :

| Configuration | Ce qu'elle fait |
|---|---|
| Backend — tests | Lance pytest en mode debug. |
| Backend — test réel sur une ville | Génère de vraies boucles sur Paris et affiche le résultat dans le terminal. |
| Front — Chrome | Ouvre Chrome attaché au débogueur, points d'arrêt dans le JSX. |

**Tests** — la suite Python du moteur de référence, et 544 côté app (moteur
JavaScript et interface). `Ctrl+Shift+P → Exécuter la tâche → Lacet — tous les
tests` lance les deux ; l'onglet « Test » permet de rejouer un cas à la fois. En
ligne de commande :

```powershell
cd backend; .venv\Scripts\python.exe -m pytest
```

```powershell
cd frontend; npm test
```

GitHub les relance à chaque envoi (`.github/workflows/tests.yml`), avec
`scripts/parity_dump.py --check` : un changement du moteur Python dont l'oracle
de parité n'a pas été refait fait échouer la vérification, au lieu de laisser le
JavaScript se comparer à l'ancienne réponse.

Les tests d'interface portent sur ce qui tourne **pendant** la sortie, sans
personne pour le regarder : le suivi de position sur le tracé, la formulation
des consignes vocales, et ce qu'on garde d'un parcours enregistré. Ce sont les
seuls endroits où une erreur ne se voit pas tout de suite — elle se vit sur le
terrain, à un carrefour.

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

**Compter les boucles distinctes** — combien de vraies boucles entières une
recherche rend, combien de tours, de quasi-doublons, en combien de temps — sur
les rues livrées avec l'app, sans réseau une fois le relief gardé :

```powershell
cd frontend; npx vite-node scripts/measure_loops.mjs -- --heading
```

96 recherches autour de Soultz et de Guebwiller, plus seize avec une direction
(`--heading`). `--region` désigne le dossier des tuiles quand il n'est pas dans
`frontend/public/region/` (un worktree n'en a pas), `--only soultz` restreint
les départs, `--out` garde le détail en JSON. Le relief vient de l'IGN la
première fois, puis de `frontend/scripts/.cache/`. C'est ce script qui a mesuré
les tableaux de [la génération](generation.md#quand-la-distance-ne-tient-pas--les-tours).
