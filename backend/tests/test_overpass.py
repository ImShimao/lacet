"""La stratégie d'interrogation des miroirs OpenStreetMap.

C'est le poste le plus coûteux de toute l'application — 89 secondes sur une
recherche mesurée à 103 — et c'était le seul module sans test. Or ce qu'il gère
ne se voit jamais en développement : un miroir qui répond au bout d'une minute
et demie, un autre qui rend un extrait vide sans le dire, un troisième qui coupe
la connexion. Tout marche très bien tant qu'on a de la chance.

Ce qui se vérifie ici :

* **un miroir en panne ne fait plus attendre les autres** — la panne observée
  coûtait 87 secondes avant qu'on essaie le suivant, qui répondait en sept ;
* **on ne double pas la charge pour rien** : un miroir qui répond normalement
  reste seul sollicité, parce que ces serveurs sont publics et gratuits ;
* **une réponse vide reste ambiguë** : c'est ce que rend un miroir qui a
  abandonné en route, mais c'est aussi la vérité en pleine mer.
"""

from __future__ import annotations

import asyncio
import time

import pytest

from app.osm import overpass


class FausseReponse:
    def __init__(self, payload: dict, status: int = 200) -> None:
        self._payload = payload
        self.status = status

    def raise_for_status(self) -> None:
        if self.status >= 400:
            raise RuntimeError(f"HTTP {self.status}")

    def json(self) -> dict:
        return self._payload


def extrait(n: int = 1) -> dict:
    return {"elements": [{"type": "way", "id": i} for i in range(n)]}


VIDE = {"elements": []}


class FauxMiroirs:
    """Un réseau de miroirs dont on décide, un par un, le comportement.

    `comportements` associe à chaque adresse un couple (délai, résultat), où le
    résultat est une charge utile ou une exception à lever.
    """

    def __init__(self, comportements: dict[str, tuple[float, object]]) -> None:
        self.comportements = comportements
        self.appeles: list[str] = []
        self.annules: list[str] = []

    async def post(self, url: str, data=None):  # noqa: ANN001 — signature d'httpx
        self.appeles.append(url)
        delai, resultat = self.comportements[url]
        try:
            await asyncio.sleep(delai)
        except asyncio.CancelledError:
            self.annules.append(url)
            raise
        if isinstance(resultat, Exception):
            raise resultat
        return FausseReponse(resultat)


@pytest.fixture(autouse=True)
def chevauchement_court(monkeypatch):
    """Le délai réel est de 15 s : les tests n'ont pas à le subir."""
    monkeypatch.setattr(overpass, "HEDGE_DELAY_S", 0.05)


# --- ce que la mesure a imposé -------------------------------------------


async def test_un_miroir_en_panne_ne_fait_plus_attendre_les_autres():
    # « en panne » ne veut pas dire « qui refuse » : il accepte la connexion et
    # ne répond jamais. C'est le cas coûteux, et le seul que la file d'attente
    # ne savait pas traiter.
    faux = FauxMiroirs({"muet": (30.0, extrait()), "vif": (0.0, extrait(3))})

    debut = time.perf_counter()
    payload = await overpass._hedged_round(faux, ["muet", "vif"], "requête")
    ecoule = time.perf_counter() - debut

    assert len(payload["elements"]) == 3
    assert ecoule < 1.0
    assert faux.appeles == ["muet", "vif"]


async def test_les_requetes_encore_en_vol_sont_annulees():
    # Les laisser courir tiendrait des connexions ouvertes sur des serveurs
    # partagés, longtemps après que leur réponse n'intéresse plus personne.
    faux = FauxMiroirs({"muet": (30.0, extrait()), "vif": (0.0, extrait())})

    await overpass._hedged_round(faux, ["muet", "vif"], "requête")
    await asyncio.sleep(0.05)  # laisse l'annulation se propager

    assert faux.annules == ["muet"]


async def test_un_miroir_qui_repond_reste_seul_sollicite():
    # Ce sont des serveurs publics et gratuits : interroger les quatre à chaque
    # recherche quadruplerait la charge qu'on leur impose, pour rien.
    faux = FauxMiroirs({"vif": (0.0, extrait()), "autre": (0.0, extrait())})

    await overpass._hedged_round(faux, ["vif", "autre"], "requête")

    assert faux.appeles == ["vif"]


# --- les réponses ambiguës ------------------------------------------------


async def test_une_reponse_vide_fait_interroger_les_autres():
    # Un miroir qui abandonne en cours de route rend un extrait vide et bien
    # formé. Le croire sur parole afficherait « aucune voie praticable » en
    # plein Paris.
    faux = FauxMiroirs({"bancal": (0.0, VIDE), "bon": (0.0, extrait(5))})

    payload = await overpass._hedged_round(faux, ["bancal", "bon"], "requête")

    assert len(payload["elements"]) == 5
    assert faux.appeles == ["bancal", "bon"]


async def test_si_tous_decrivent_le_vide_c_est_que_la_zone_est_vide():
    # En pleine mer ou en plein désert, le vide est la bonne réponse.
    faux = FauxMiroirs({"a": (0.0, VIDE), "b": (0.0, VIDE)})

    payload = await overpass._hedged_round(faux, ["a", "b"], "requête")

    assert payload == VIDE


async def test_une_reponse_sans_elements_est_traitee_comme_une_panne():
    # Une page d'erreur HTML servie en 200, ou un JSON d'un autre service :
    # accepter ça mettrait en cache un extrait qui n'en est pas un.
    faux = FauxMiroirs({"bavard": (0.0, {"remark": "erreur"}), "bon": (0.0, extrait())})

    payload = await overpass._hedged_round(faux, ["bavard", "bon"], "requête")

    assert payload["elements"]


# --- les pannes franches --------------------------------------------------


async def test_une_panne_franche_n_interrompt_pas_le_tour():
    faux = FauxMiroirs({"cassé": (0.0, RuntimeError("HTTP 504")), "bon": (0.0, extrait())})

    payload = await overpass._hedged_round(faux, ["cassé", "bon"], "requête")

    assert payload["elements"]


async def test_tous_en_panne_ne_rend_rien():
    # `None` et non une exception : l'appelant a encore une carte à jouer, un
    # extrait périmé sur le disque, qui vaut mieux qu'un message d'erreur.
    faux = FauxMiroirs({"a": (0.0, RuntimeError("boom")), "b": (0.0, RuntimeError("boom"))})

    assert await overpass._hedged_round(faux, ["a", "b"], "requête") is None


# --- le message d'erreur lui-même ----------------------------------------


def test_une_exception_sans_message_reste_lisible():
    # Une erreur de connexion ou de handshake TLS arrive régulièrement avec un
    # texte vide. Lire la première ligne d'une chaîne vide levait une
    # `IndexError` **depuis le bloc d'exception**, et cette erreur de
    # journalisation remplaçait l'erreur réseau jusqu'à l'utilisateur.
    assert overpass._short(ConnectionError()) == "ConnectionError"


def test_un_message_bavard_est_ramene_a_sa_premiere_ligne():
    # httpx en produit cinq, dont une URL de documentation.
    exc = RuntimeError("Server error '504'\nPour en savoir plus : https://example.com")
    assert overpass._short(exc) == "Server error '504'"
