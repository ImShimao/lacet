import { afterEach, describe, expect, it, vi } from 'vitest'
import { generateLoops } from './api'

/**
 * Ce que l'app dit quand la requête échoue.
 *
 * C'est le seul texte que verra quelqu'un dont la sortie ne se passe pas comme
 * prévu, et il était écrit pour un développeur : « lance-le depuis le dossier
 * backend : python -m uvicorn… ». Sur un téléphone au milieu d'un chemin, la
 * personne n'a pas de serveur à lancer — elle a perdu le réseau, et ce qu'elle
 * veut savoir, c'est ce qui lui reste d'accessible.
 */

/** `navigator` n'existe pas hors navigateur : on ne stube que ce qu'on lit. */
function enLigne(valeur) {
  vi.stubGlobal('navigator', { onLine: valeur })
}

function reseauCoupe() {
  enLigne(false)
  vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new TypeError('Failed to fetch')))
}

function serveurInjoignable() {
  enLigne(true)
  vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new TypeError('Failed to fetch')))
}

function repond(status, body = null) {
  enLigne(true)
  vi.stubGlobal(
    'fetch',
    vi.fn().mockResolvedValue({
      ok: status >= 200 && status < 300,
      status,
      json: async () => {
        if (body === null) throw new SyntaxError('pas du JSON')
        return body
      },
    }),
  )
}

afterEach(() => {
  vi.unstubAllGlobals()
})

const requete = { lat: 48.85, lon: 2.35, distance_km: 10 }

describe('quand le réseau est coupé', () => {
  it('le dit, et ne parle pas de serveur', async () => {
    reseauCoupe()
    await expect(generateLoops(requete)).rejects.toThrow(/Pas de connexion/)
  })

  it('renvoie vers ce qui reste accessible', async () => {
    reseauCoupe()
    await expect(generateLoops(requete)).rejects.toThrow(/Mes parcours/)
  })

  it('se signale comme hors ligne, pour que l’interface s’adapte', async () => {
    // Hors ligne, « réessayer » ne sert à rien : l'interface doit proposer
    // autre chose, et elle a besoin de le savoir.
    reseauCoupe()
    await expect(generateLoops(requete)).rejects.toMatchObject({ offline: true })
  })

  it('ne donne aucune commande à taper', async () => {
    reseauCoupe()
    await expect(generateLoops(requete)).rejects.not.toThrow(/uvicorn/)
  })
})

describe('quand le serveur ne répond pas', () => {
  it('parle du serveur, pas du réseau', async () => {
    serveurInjoignable()
    await expect(generateLoops(requete)).rejects.toThrow(/serveur ne répond pas/)
  })

  it('ne se signale pas comme hors ligne', async () => {
    serveurInjoignable()
    await expect(generateLoops(requete)).rejects.toMatchObject({ offline: false })
  })

  it('traite un 5xx comme une panne de serveur', async () => {
    // En développement, le relais de Vite renvoie une erreur de passerelle au
    // lieu de laisser `fetch` échouer : sans ce cas, on affichait « Erreur 500 ».
    repond(502)
    await expect(generateLoops(requete)).rejects.toThrow(/serveur ne répond pas/)
  })
})

describe('quand le backend explique son refus', () => {
  it('c’est son message qui parle', async () => {
    const detail = "Ce point de départ est sur une portion de réseau isolée."
    repond(422, { detail })
    await expect(generateLoops(requete)).rejects.toThrow(detail)
  })

  it('même sur une erreur de service', async () => {
    const detail = "Aucun miroir OpenStreetMap n'a répondu."
    repond(503, { detail })
    await expect(generateLoops(requete)).rejects.toThrow(detail)
  })
})

describe('les autres codes', () => {
  it('un 429 invite à patienter', async () => {
    repond(429)
    await expect(generateLoops(requete)).rejects.toThrow(/Attends quelques secondes/)
  })

  it('un code inattendu reste lisible', async () => {
    repond(418)
    const erreur = await generateLoops(requete).catch((e) => e)
    expect(erreur.message).toContain('418')
    expect(erreur.message).not.toMatch(/^Erreur \d+$/)
  })
})

describe('quand tout va bien', () => {
  it('rend la réponse telle quelle', async () => {
    const payload = { routes: [{ id: 'r0' }], rejected: [], meta: {} }
    repond(200, payload)
    await expect(generateLoops(requete)).resolves.toEqual(payload)
  })
})
