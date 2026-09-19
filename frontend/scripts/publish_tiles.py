"""Dépose les rues préparées sur Hugging Face, et tient le catalogue à jour.

    HF_TOKEN=… HF_DATASET=utilisateur/lacet-cartes python scripts/publish_tiles.py pays out/france france
    HF_TOKEN=… HF_DATASET=utilisateur/lacet-cartes python scripts/publish_tiles.py catalogue

Pourquoi Hugging Face : l'app lit ces fichiers depuis son navigateur intégré,
par morceaux (requêtes « Range »). Il faut donc un hébergement qui accepte les
requêtes venues d'une autre origine — ce que GitHub refuse pour ses fichiers de
version —, qui serve les gros fichiers par un réseau de diffusion, et qui soit
gratuit pour des données publiques. Mesuré : Hugging Face rend un morceau d'un
fichier en 0,4 s, en-têtes d'origine croisée compris.

Les données sont celles d'OpenStreetMap, publiques et sous licence ODbL : le
jeu de données l'est aussi, avec l'attribution que la licence exige.
"""

from __future__ import annotations

import json
import os
import sys
import tempfile
import time
from pathlib import Path

from huggingface_hub import HfApi, hf_hub_download

README = """---
license: odbl
pretty_name: Lacet — rues OpenStreetMap par tuiles
---

# Rues OpenStreetMap, découpées en tuiles pour l'app Lacet

Données © contributeurs OpenStreetMap, disponibles sous licence ODbL :
https://www.openstreetmap.org/copyright

Extraits Geofabrik (https://download.geofabrik.de), préparés chaque mois.
Par pays : `tiles.bin` (tuiles de 0,05° compressées une à une, mises bout à
bout) et `index.json` (position et longueur de chaque tuile). `catalog.json`
liste les pays et leur emprise.
"""


def api_and_repo() -> tuple[HfApi, str]:
    token = os.environ.get("HF_TOKEN")
    repo = os.environ.get("HF_DATASET")
    if not token or not repo:
        sys.exit("HF_TOKEN et HF_DATASET sont nécessaires (secret et variable du dépôt GitHub).")
    return HfApi(token=token), repo


def publish_country(folder: Path, country: str) -> None:
    api, repo = api_and_repo()
    api.create_repo(repo, repo_type="dataset", exist_ok=True, private=False)
    # Plusieurs pays publient en même temps : un envoi qui tombe sur celui d'un
    # autre est simplement retenté un peu plus tard.
    for attempt in range(4):
        try:
            api.upload_folder(
                repo_id=repo,
                repo_type="dataset",
                folder_path=str(folder),
                path_in_repo=country,
                commit_message=f"{country} : rues du {time.strftime('%Y-%m-%d')}",
            )
            break
        except Exception as error:  # noqa: BLE001 — n'importe quelle erreur réseau
            if attempt == 3:
                raise
            print(f"Envoi refusé ({error}) — nouvel essai dans une minute")
            time.sleep(60)
    print(f"{country} publié dans {repo}")


def publish_catalogue() -> None:
    """Relit l'index de chaque pays publié et en tire le catalogue.

    L'emprise de chaque pays vient de ses tuiles : c'est ce que l'app regarde
    pour savoir quel index ouvrir. Les emprises se chevauchent (celle de la
    France englobe la Suisse) ; l'app tranche avec les index eux-mêmes.
    """
    api, repo = api_and_repo()
    countries = []
    for path in api.list_repo_files(repo, repo_type="dataset"):
        if not path.endswith("/index.json"):
            continue
        country = path.split("/")[0]
        local = hf_hub_download(repo, path, repo_type="dataset", token=api.token)
        data = json.loads(Path(local).read_text(encoding="utf-8"))
        deg = data["tileDeg"]
        keys = [tuple(int(v) for v in key.split("_")) for key in data["tiles"]]
        if not keys:
            continue
        xs = [k[0] for k in keys]
        ys = [k[1] for k in keys]
        countries.append(
            {
                "id": country,
                "name": data["name"],
                "builtAt": data["builtAt"],
                "tiles": len(keys),
                "bbox": [min(xs) * deg, min(ys) * deg, (max(xs) + 1) * deg, (max(ys) + 1) * deg],
            }
        )
    # Les plus petits d'abord : quand deux emprises contiennent une tuile, le
    # pays le plus petit est le plus probable, et son index le plus léger.
    countries.sort(key=lambda c: c["tiles"])
    catalog = {"v": 1, "tileDeg": 0.05, "builtAt": int(time.time() * 1000), "countries": countries}

    with tempfile.TemporaryDirectory() as tmp:
        (Path(tmp) / "catalog.json").write_text(json.dumps(catalog, ensure_ascii=False), encoding="utf-8")
        (Path(tmp) / "README.md").write_text(README, encoding="utf-8")
        api.upload_folder(repo_id=repo, repo_type="dataset", folder_path=tmp, commit_message="Catalogue des pays")
    print(f"Catalogue : {', '.join(c['name'] for c in countries)}")


if __name__ == "__main__":
    if len(sys.argv) >= 4 and sys.argv[1] == "pays":
        publish_country(Path(sys.argv[2]), sys.argv[3])
    elif len(sys.argv) == 2 and sys.argv[1] == "catalogue":
        publish_catalogue()
    else:
        sys.exit(__doc__)
