import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

/**
 * Ce que l'app dit quand la recherche échoue.
 *
 * Il n'y a plus de serveur : le calcul se fait sur l'appareil. Mais c'est
 * toujours le seul texte que verra quelqu'un dont la sortie ne se passe pas
 * comme prévu, et les exigences n'ont pas changé. Un refus du moteur dit déjà
 * quoi faire : il doit passer tel quel. Une perte de réseau ne doit pas se
 * présenter comme une panne de serveurs — la personne veut savoir ce qui lui
 * reste d'accessible.
 */

vi.mock('./engine/client', () => ({ planOnDevice: vi.fn() }))

const { planOnDevice } = await import('./engine/client')
const { generateLoops } = await import('./api')

const erreur = (name, message) => Object.assign(new Error(message), { name })

function enLigne(valeur) {
  vi.stubGlobal('navigator', { onLine: valeur })
}

beforeEach(() => {
  planOnDevice.mockReset()
})

afterEach(() => {
  vi.unstubAllGlobals()
})

const requete = { lat: 48.85, lon: 2.35, distance_km: 10 }

describe('quand le moteur refuse', () => {
  it('c’est son message qui parle', async () => {
    enLigne(true)
    const detail = 'Ce point de départ est sur une portion de réseau isolée.'
    planOnDevice.mockRejectedValue(erreur('PlanningError', detail))
    await expect(generateLoops(requete)).rejects.toThrow(detail)
  })

  it('même hors ligne : un refus métier n’a rien à voir avec le réseau', async () => {
    enLigne(false)
    planOnDevice.mockRejectedValue(erreur('PlanningError', 'Vise au moins 500 m.'))
    await expect(generateLoops(requete)).rejects.toMatchObject({ message: 'Vise au moins 500 m.', offline: false })
  })
})

describe('quand le réseau est coupé', () => {
  beforeEach(() => {
    enLigne(false)
    planOnDevice.mockRejectedValue(erreur('OverpassError', "Aucun miroir OpenStreetMap n'a répondu."))
  })

  it('le dit, et ne parle pas de serveurs saturés', async () => {
    const e = await generateLoops(requete).catch((x) => x)
    expect(e.message).toMatch(/Pas de connexion/)
    expect(e.message).not.toMatch(/miroir|saturent/)
  })

  it('dit que les zones déjà explorées restent calculables', async () => {
    // C'est vrai depuis que le moteur tourne sur l'appareil : les rues d'une
    // zone déjà visitée sont gardées, et le calcul n'a plus besoin du réseau.
    await expect(generateLoops(requete)).rejects.toThrow(/hors ligne/)
  })

  it('renvoie vers ce qui reste accessible', async () => {
    await expect(generateLoops(requete)).rejects.toThrow(/Mes parcours/)
  })

  it('se signale comme hors ligne, pour que l’interface s’adapte', async () => {
    await expect(generateLoops(requete)).rejects.toMatchObject({ offline: true })
  })

  it('ne donne aucune commande à taper', async () => {
    await expect(generateLoops(requete)).rejects.not.toThrow(/uvicorn|python/)
  })
})

describe('quand OpenStreetMap ne répond pas', () => {
  it('explique que les serveurs sont publics et saturent', async () => {
    enLigne(true)
    const detail = "Aucun miroir OpenStreetMap n'a répondu. Vérifie ta connexion, ou réessaie dans une minute."
    planOnDevice.mockRejectedValue(erreur('OverpassError', detail))
    await expect(generateLoops(requete)).rejects.toMatchObject({ message: detail, offline: false })
  })
})

describe('quand le calcul plante', () => {
  it('propose une sortie de secours plutôt qu’un message technique', async () => {
    enLigne(true)
    planOnDevice.mockRejectedValue(erreur('EngineCrash', "Le calcul s'est interrompu. Essaie une distance plus courte."))
    await expect(generateLoops(requete)).rejects.toThrow(/distance plus courte/)
  })

  it('une erreur inattendue reste lisible', async () => {
    enLigne(true)
    planOnDevice.mockRejectedValue(new TypeError('x is undefined'))
    const e = await generateLoops(requete).catch((x) => x)
    expect(e.message).toMatch(/^La recherche a échoué/)
  })
})

describe('quand tout va bien', () => {
  it('rend la réponse du moteur telle quelle', async () => {
    const payload = { routes: [{ id: 'r0' }], rejected: [], meta: {} }
    planOnDevice.mockResolvedValue(payload)
    await expect(generateLoops(requete)).resolves.toEqual(payload)
  })

  it('transmet la progression à l’interface', async () => {
    planOnDevice.mockImplementation(async (_params, onProgress) => {
      onProgress('data', 0.5)
      return { routes: [], rejected: [], meta: {} }
    })
    const vus = []
    await generateLoops(requete, (etape, fraction) => vus.push([etape, fraction]))
    expect(vus).toEqual([['data', 0.5]])
  })
})
