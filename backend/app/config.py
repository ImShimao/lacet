"""Configuration — surchargeable par variables d'environnement ou fichier .env."""

from pathlib import Path

from pydantic_settings import BaseSettings, SettingsConfigDict

BACKEND_DIR = Path(__file__).resolve().parent.parent


class Settings(BaseSettings):
    model_config = SettingsConfigDict(
        env_file=BACKEND_DIR / ".env", env_prefix="LACET_", extra="ignore"
    )

    # Les API publiques utilisées (Overpass, IGN) exigent un agent identifiable.
    # Mets-y une adresse de contact valide avant tout déploiement.
    # ASCII uniquement : les en-têtes HTTP n'acceptent pas les accents.
    user_agent: str = "Lacet/0.1 (running route generator; contact@exemple.fr)"

    # --- Overpass (données OpenStreetMap) ---------------------------------
    # Plusieurs miroirs : on bascule sur le suivant si l'un est saturé. Ce sont
    # des ressources publiques et gratuites, régulièrement saturées aux heures
    # ouvrées européennes — en avoir plusieurs n'est pas du luxe, c'est la
    # différence entre « l'app marche » et « l'app marche parfois ».
    # Que des instances mondiales. (overpass.osm.jp a été retiré : son certificat
    # ne correspond plus à son nom de domaine, chaque appel échouait sur une
    # erreur TLS. overpass.osm.ch aussi : il ne contient que la Suisse et
    # répondait « HTTP 200, aucune rue » en deux dixièmes de seconde pour
    # l'Alsace — une réponse vite crue, et fausse, ce qui est pire qu'une panne.
    # Kumi et private.coffee aussi : « 500 » à toute requête le 10 octobre 2026,
    # plus aucune réponse le 12. Celle d'OpenStreetMap France les remplace ; elle
    # refuse les navigateurs, pas l'identifiant ci-dessous.)
    overpass_urls: list[str] = [
        "https://overpass-api.de/api/interpreter",
        "https://overpass.openstreetmap.fr/api/interpreter",
    ]
    overpass_timeout_s: int = 90

    # Tours complets de la liste des miroirs avant d'abandonner. Une saturation
    # dure rarement plus de quelques secondes ; réessayer coûte moins cher à
    # tout le monde qu'un échec renvoyé à l'utilisateur.
    overpass_rounds: int = 2

    # --- Élévation --------------------------------------------------------
    # "ign"           : Géoplateforme IGN, RGE ALTI 1 m — France uniquement, gratuit, sans clé
    # "opentopodata"  : couverture mondiale (SRTM 30 m), 1 requête/s
    # "none"          : pas de dénivelé (génération plus rapide)
    elevation_provider: str = "ign"
    elevation_fallback: str = "opentopodata"
    elevation_sample_m: int = 50  # un point tous les 50 m le long du tracé — voir `elevation.py`
    elevation_timeout_s: int = 20

    # Seuil de bruit du MNT fin (IGN) : une variation continue inférieure à ce
    # seuil n'est pas comptée dans le D+. Le lissage a déjà effacé l'essentiel
    # du tremblement — voir `elevation.py` ; le modèle grossier a le sien.
    ascent_threshold_m: float = 1.0

    # --- Cache ------------------------------------------------------------
    cache_dir: Path = BACKEND_DIR / ".cache"
    cache_ttl_days: int = 14

    # Plafonds du cache de graphes, en entrées et en nœuds. Compter les entrées
    # ne suffit pas : un extrait de village pèse dix mille nœuds, un centre-ville
    # deux cent mille, et trois de ces derniers dépassent le gigaoctet.
    #
    # Réglables parce que la bonne valeur dépend de la machine, pas du code :
    # mesuré à 568 Mo après une recherche sur Paris, ce qui tient largement sur
    # un poste de travail mais dépasse les 512 Mo d'un hébergeur gratuit. Là-bas,
    # `LACET_GRAPH_CACHE_NODES=120000` garde l'app vivante au prix d'une
    # reconstruction plus fréquente.
    graph_cache_entries: int = 4
    graph_cache_nodes: int = 320_000

    # --- Génération -------------------------------------------------------
    sectors: int = 16  # nombre de directions explorées autour du départ
    # Candidats bruts générés avant filtrage. Quatre formes × huit orientations
    # font trente-deux boucles possibles ; plafonner à douze, comme avant, en
    # jetait vingt sans les avoir regardées — et privait le choix final de la
    # matière dont il a besoin pour proposer des directions vraiment
    # différentes. Le portail L3 et le dédoublonnage en éliminent la moitié.
    max_candidates: int = 32


settings = Settings()
settings.cache_dir.mkdir(parents=True, exist_ok=True)
