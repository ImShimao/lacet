"""L4 — le modèle de nuit.

Ce n'est pas un réglage du modèle de jour, c'est un modèle **distinct** qui
l'inverse en partie. De jour, on cherche à s'éloigner du trafic : parcs, chemins,
bords de rivière. De nuit, un sentier isolé dans un bois devient le pire choix
possible — le risque n'est plus routier, il est humain.

Le risque routier de L1 reste appliqué : il ne disparaît pas la nuit, il s'ajoute.
"""

from __future__ import annotations

from .risk import EdgeSafety

# Voies isolées quand elles sortent de la zone bâtie.
_REMOTE_HIGHWAY = {"path", "track", "bridleway", "footway"}


def night_factor(safety: EdgeSafety) -> float:
    """Multiplicateur appliqué au poids de routage en mode nuit."""
    factor = 1.0

    # Éclairage — le signal principal.
    if safety.lit is True:
        factor *= 0.70
    elif safety.lit is False:
        factor *= 1.80
    else:
        # Non renseigné. En zone bâtie l'éclairage est probable, hors bâti non.
        factor *= 1.15 if safety.in_builtup else 1.60

    # Isolement — un chemin en pleine campagne, de nuit, est à éviter même s'il
    # est parfaitement sûr du point de vue de la circulation.
    if safety.highway in _REMOTE_HIGHWAY and not safety.in_builtup:
        factor *= 2.20

    # La rue bordée de bâti reste le meilleur compromis : du monde, de la lumière,
    # des façades. On la favorise légèrement.
    if safety.highway in {"residential", "living_street"} and safety.in_builtup:
        factor *= 0.90

    return factor


def unlit_length(safety: EdgeSafety, length_m: float) -> float:
    """Longueur à compter comme non éclairée. `lit` absent n'est pas `lit=no`."""
    return length_m if safety.lit is False else 0.0
