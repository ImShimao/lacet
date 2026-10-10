/** @vitest-environment jsdom */
import { act, cleanup, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

/**
 * La fin d'une sortie, et le signalement — les deux gestes qu'on ne fait pas.
 *
 * Le premier parce qu'on arrive essoufflé et qu'on oublie d'appuyer ; le second
 * parce qu'on ne va pas sortir le téléphone pour désigner une barrière. Ce sont
 * donc les deux qui doivent marcher sans qu'on y pense, et c'est ce qui se
 * vérifie ici : un GPS de laboratoire fait le tour de la boucle, et l'app doit
 * terminer d'elle-même en repassant sur le départ.
 */

let fixes = null
vi.mock('./position', () => ({
  watchPosition: (ok) => {
    fixes = ok
    return () => {
      fixes = null
    }
  },
}))
vi.mock('./voice', () => ({
  available: false,
  speak: vi.fn(),
  stop: vi.fn(),
  unlock: vi.fn(),
  setEnabled: vi.fn(),
  phrase: () => '',
}))
vi.mock('./platform', () => ({ isNative: () => false }))
vi.mock('./engine/client', () => ({ detourOnDevice: vi.fn() }))
vi.mock('./runState', () => ({ saveRun: vi.fn(), clearRun: vi.fn() }))

const LiveRun = (await import('./LiveRun.jsx')).default
const { activeReports } = await import('./reports')

/** Un carré de cent mètres de côté, refermé sur son départ. */
function carre(lon = 7.2, lat = 47.9, coteM = 100) {
  const kx = 111_320 * Math.cos((lat * Math.PI) / 180)
  const dx = coteM / kx
  const dy = coteM / 110_540
  const coins = [
    [lon, lat],
    [lon + dx, lat],
    [lon + dx, lat + dy],
    [lon, lat + dy],
    [lon, lat],
  ]
  // Un point tous les vingt mètres : ce que verrait un vrai relevé.
  const out = []
  for (let i = 1; i < coins.length; i += 1) {
    for (let t = 0; t < 5; t += 1) {
      out.push([
        coins[i - 1][0] + ((coins[i][0] - coins[i - 1][0]) * t) / 5,
        coins[i - 1][1] + ((coins[i][1] - coins[i - 1][1]) * t) / 5,
      ])
    }
  }
  out.push([lon, lat])
  return out
}

const geometry = carre()
const boucle = {
  id: 'test',
  name: 'Le tour du pâté',
  distance_m: 400,
  geometry,
  instructions: [],
  crossings: [],
  segments: [],
  elevation_profile: null,
}

/** Envoie un relevé GPS, comme le ferait le téléphone. */
async function relever(point, t) {
  await act(async () => {
    fixes({ coords: { longitude: point[0], latitude: point[1], accuracy: 6, altitude: null, speed: 3 }, timestamp: t })
    await Promise.resolve()
  })
}

describe('la sortie guidée', () => {
  beforeEach(() => {
    localStorage.clear()
    fixes = null
  })
  afterEach(() => {
    cleanup()
  })

  it("se termine d'elle-même en revenant au départ", async () => {
    const onStop = vi.fn()
    render(
      <LiveRun route={boucle} request={null} sport="run" stage={null} onPosition={() => {}} onStop={onStop} />,
    )
    expect(fixes).not.toBeNull()

    // Le tour complet, deux secondes entre chaque point.
    let t = Date.now()
    for (const point of geometry) {
      t += 2000
      await relever(point, t)
    }
    // Arrivé sur le départ, il faut encore le relevé qui s'en éloigne — c'est
    // lui qui dit que le point le plus proche est passé.
    expect(onStop).not.toHaveBeenCalled()
    t += 2000
    await relever([geometry[1][0], geometry[1][1]], t)

    expect(onStop).toHaveBeenCalledTimes(1)
    const bilan = onStop.mock.calls[0][0]
    // Ce qui est enregistré est bien la sortie faite : le tour du carré.
    expect(bilan.distance).toBeGreaterThan(350)
    expect(bilan.distance).toBeLessThan(500)
  })

  it('laisse ses huit secondes à une traversée qui suit de près la précédente', async () => {
    // Deux traversées : l'une au départ, l'autre au coin opposé du carré, hors
    // de portée d'alerte tant qu'on n'a pas fait un côté.
    const [lon, lat] = geometry[0]
    const loin = geometry[10]
    const route = {
      ...boucle,
      crossings: [
        { lon, lat, protected: true },
        { lon: loin[0], lat: loin[1], protected: false },
      ],
    }
    vi.useFakeTimers()
    try {
      render(<LiveRun route={route} request={null} sport="run" stage={null} onPosition={() => {}} onStop={() => {}} />)
      let t = Date.now()
      await relever(geometry[0], t)
      expect(screen.getByText(/passage protégé/)).toBeTruthy()

      // Cinq secondes plus tard, au premier coin : la seconde traversée.
      await act(async () => vi.advanceTimersByTime(5000))
      t += 5000
      await relever(geometry[5], t)
      expect(screen.getByText(/pas de passage protégé/)).toBeTruthy()

      // Le minuteur de la première tombe ici : il ne doit pas emporter la seconde.
      await act(async () => vi.advanceTimersByTime(4000))
      expect(screen.queryByText(/pas de passage protégé/)).not.toBeNull()

      await act(async () => vi.advanceTimersByTime(5000))
      expect(screen.queryByText(/Traversée dans/)).toBeNull()
    } finally {
      vi.useRealTimers()
    }
  })

  it('ne se termine pas au milieu du tour', async () => {
    const onStop = vi.fn()
    render(
      <LiveRun route={boucle} request={null} sport="run" stage={null} onPosition={() => {}} onStop={onStop} />,
    )
    let t = Date.now()
    for (const point of geometry.slice(0, 8)) {
      t += 2000
      await relever(point, t)
    }
    // Retour sur ses pas jusqu'au départ, sans avoir fait la boucle : on est
    // sur le point d'arrivée, mais la sortie n'est pas finie.
    for (const point of geometry.slice(0, 8).reverse()) {
      t += 2000
      await relever(point, t)
    }
    expect(onStop).not.toHaveBeenCalled()
  })

  it('dit chaque virage une fois, en entier, sans que le suivant le coupe', async () => {
    // Trois virages à cent mètres d'intervalle : l'annonce de chacun tombait
    // juste après le « maintenant » du précédent, et le coupait.
    const voice = await import('./voice')
    voice.speak.mockClear()
    const coin = (k) => ({ lon: geometry[5 * k][0], lat: geometry[5 * k][1] })
    const guidee = {
      ...boucle,
      instructions: [
        { dist_m: 0, turn: 'start', text: 'Départ — rejoins Rue du Moulin et pars à droite.', road: 'Rue du Moulin', caution: false, ...coin(0) },
        { dist_m: 100, turn: 'left', text: 'Tourne à gauche sur Rue Haute', road: 'Rue Haute', caution: false, ...coin(1) },
        { dist_m: 200, turn: 'left', text: 'Tourne à gauche sur Rue Basse', road: 'Rue Basse', caution: false, ...coin(2) },
        { dist_m: 300, turn: 'left', text: 'Tourne à gauche', road: null, caution: false, ...coin(3) },
        { dist_m: 400, turn: 'finish', text: 'Tu es revenu au point de départ. Boucle terminée.', road: null, caution: false, ...coin(0) },
      ],
    }
    render(<LiveRun route={guidee} request={null} sport="run" stage={null} onPosition={() => {}} onStop={vi.fn()} />)

    // À pied : vingt mètres toutes les six secondes.
    let t = Date.now()
    for (const point of geometry) {
      t += 6000
      await relever(point, t)
    }
    t += 6000
    await relever(geometry[1], t)

    const dit = voice.speak.mock.calls.map(([texte]) => texte)
    expect(dit.filter((d) => d.startsWith('Départ'))).toEqual([
      'Départ — rejoins Rue du Moulin et pars à droite, puis dans 100 mètres, à gauche dans la rue Haute.',
    ])
    expect(dit.filter((d) => d.startsWith('Maintenant'))).toEqual([
      'Maintenant, tourne à gauche sur Rue Haute, puis dans 100 mètres, à gauche dans la rue Basse.',
      'Maintenant, tourne à gauche sur Rue Basse, puis dans 100 mètres, à gauche.',
      'Maintenant, tourne à gauche, puis arrivée dans 100 mètres.',
    ])
    // Aucune annonce isolée : chacune a été dite avec le virage d'avant.
    expect(dit.filter((d) => d.startsWith('Dans'))).toEqual([])
    // Et l'arrivée n'est dite qu'une fois, en y arrivant.
    expect(dit.filter((d) => /arrivée|revenu/i.test(d) && !d.startsWith('Maintenant'))).toEqual(['Arrivée. Sortie terminée.'])
  })

  it('continue de guider pendant une pause automatique', async () => {
    // Arrêté à un feu vingt mètres avant le virage, puis reparti en marchant :
    // la pause tient encore — moins de quinze mètres, au pas —, et c'est là
    // qu'arrive le carrefour. Le guidage restait figé jusqu'à la reprise.
    const voice = await import('./voice')
    voice.speak.mockClear()
    const [lon, lat] = geometry[0]
    const kx = 111_320 * Math.cos((lat * Math.PI) / 180)
    const est = (m) => [lon + m / kx, lat]
    const guidee = {
      ...boucle,
      instructions: [
        { dist_m: 0, turn: 'start', text: 'Départ.', road: null, caution: false, lon, lat },
        { dist_m: 100, turn: 'left', text: 'Tourne à gauche sur Rue Haute', road: 'Rue Haute', caution: false, lon: est(100)[0], lat },
      ],
    }
    render(<LiveRun route={guidee} request={null} sport="run" stage={null} onPosition={() => {}} onStop={vi.fn()} />)

    let t = Date.now()
    const fix = async (m, speed) => {
      t += 1000
      await act(async () => {
        fixes({ coords: { longitude: est(m)[0], latitude: lat, accuracy: 5, altitude: null, speed }, timestamp: t })
        await Promise.resolve()
      })
    }
    for (let m = 0; m <= 80; m += 4) await fix(m, 4)
    for (let s = 0; s < 10; s += 1) await fix(80, 0)
    expect(voice.speak.mock.calls.map(([d]) => d)).toContain('Pause automatique.')
    voice.speak.mockClear()
    // Au pas, sous le seuil de reprise : toujours en pause.
    for (const m of [82, 84, 86, 88, 90]) await fix(m, 0.8)
    const dit = voice.speak.mock.calls.map(([d]) => d)
    expect(dit).not.toContain('Reprise.')
    expect(dit.some((d) => d.startsWith('Maintenant, tourne à gauche sur Rue Haute'))).toBe(true)
  })

  it('dit « demi-tour » à qui part du mauvais côté', async () => {
    // On sort de chez soi vers le nord, alors que la boucle part vers l'est et
    // revient par le nord : on court sa fin à rebours. L'app ne disait que
    // « Tu t'es écarté du parcours », sans dire de quel côté repartir.
    const voice = await import('./voice')
    voice.speak.mockClear()
    const grand = carre(7.2, 47.9, 300)
    const stage = document.createElement('div')
    document.body.appendChild(stage)
    render(
      <LiveRun
        route={{ ...boucle, geometry: grand, distance_m: 1200 }}
        request={null}
        sport="run"
        stage={stage}
        onPosition={() => {}}
        onStop={vi.fn()}
      />,
    )

    let t = Date.now()
    for (let m = 0; m <= 120; m += 20) {
      t += 6000
      await relever([grand[0][0], grand[0][1] + m / 110_540], t)
    }
    const dit = voice.speak.mock.calls.map(([d]) => d)
    expect(dit).toContain('Tu pars à contresens du parcours. Fais demi-tour.')
    expect(dit.some((d) => d.startsWith("Tu t'es écarté"))).toBe(false)
  })

  it('propose de signaler un passage fermé quand on rebrousse chemin', async () => {
    // Le portail fermé au bout de soixante mètres : on fait demi-tour sur le
    // tracé lui-même. Ce n'était pas « hors parcours », et l'app ne disait rien.
    const voice = await import('./voice')
    voice.speak.mockClear()
    const stage = document.createElement('div')
    document.body.appendChild(stage)
    render(<LiveRun route={boucle} request={null} sport="run" stage={stage} onPosition={() => {}} onStop={vi.fn()} />)

    let t = Date.now()
    const aller = geometry.slice(0, 4) // jusqu'à soixante mètres
    for (const point of aller) {
      t += 6000
      await relever(point, t)
    }
    for (const point of [...aller].reverse()) {
      t += 6000
      await relever(point, t)
    }
    expect(voice.speak.mock.calls.some(([d]) => d.startsWith('Tu reviens sur tes pas'))).toBe(true)

    await act(async () => {
      screen.getByText('Passage fermé').click()
    })
    // Le portail est signalé là où l'on a fait demi-tour, pas là où l'on est
    // soixante mètres plus loin.
    const [signale] = activeReports()
    expect(signale.kind).toBe('closed')
    expect(signale.lon).toBeCloseTo(aller.at(-1)[0], 5)
    expect(signale.lat).toBeCloseTo(aller.at(-1)[1], 5)
    expect(screen.getByText('Passage fermé signalé : il sera évité.')).toBeTruthy()
    stage.remove()
  })

  it('garde le signalement fait en courant', async () => {
    render(
      <LiveRun route={boucle} request={null} sport="run" stage={null} onPosition={() => {}} onStop={vi.fn()} />,
    )
    await relever(geometry[2], Date.now())

    await act(async () => {
      screen.getByText('Signaler un problème ici').click()
    })
    await act(async () => {
      screen.getByText('Passage fermé').click()
    })

    const gardes = activeReports()
    expect(gardes).toHaveLength(1)
    expect(gardes[0].kind).toBe('closed')
    // À l'endroit où l'on se trouvait, pas ailleurs.
    expect(gardes[0].lon).toBeCloseTo(geometry[2][0], 5)
  })
})

describe('la distance et les kilomètres', () => {
  beforeEach(() => {
    localStorage.clear()
    fixes = null
  })
  afterEach(() => {
    cleanup()
  })

  const [lon, lat] = [7.2, 47.9]
  const kx = 111_320 * Math.cos((lat * Math.PI) / 180)
  const est = (m) => [lon + m / kx, lat]
  let now = null
  beforeEach(() => {
    now = vi.spyOn(Date, 'now')
  })
  afterEach(() => {
    now.mockRestore()
  })

  /** Une course libre qu'on termine en pause, pour lire le bilan. */
  async function courir(relevés) {
    const onStop = vi.fn()
    now.mockReturnValue(relevés[0][1])
    render(<LiveRun route={null} request={null} sport="run" stage={null} onPosition={() => {}} onStop={onStop} />)
    for (const [m, t] of relevés) {
      // Le chrono suit l'horloge du téléphone : on la fait avancer avec les relevés.
      now.mockReturnValue(t)
      await act(async () => {
        fixes({ coords: { longitude: est(m)[0], latitude: lat, accuracy: 5, altitude: null, speed: 3 }, timestamp: t })
        await Promise.resolve()
      })
    }
    await act(async () => {
      screen.getByLabelText('Mettre en pause').click()
    })
    await act(async () => {
      screen.getByText('Terminer').click()
    })
    return onStop.mock.calls[0][0]
  }

  it('compte les mètres courus sous un tunnel, pas un saut du GPS', async () => {
    const t0 = 1_700_000_000_000
    // Trois cents mètres sans signal, en une minute et demie : c'est courable.
    const tunnel = await courir([[0, t0], [10, t0 + 3000], [310, t0 + 93_000], [320, t0 + 96_000]])
    expect(tunnel.distance).toBeGreaterThan(310)
    // Le même saut en une seconde, c'est le GPS qui s'égare.
    cleanup()
    const saut = await courir([[0, t0], [10, t0 + 3000], [310, t0 + 4000], [320, t0 + 7000]])
    expect(saut.distance).toBeLessThan(30)
  })

  it('dit le temps du kilomètre qui vient de passer', async () => {
    const voice = await import('./voice')
    voice.speak.mockClear()
    const t0 = 1_700_000_000_000
    // Quatre mètres par seconde : 250 secondes au kilomètre.
    const relevés = []
    for (let m = 0; m <= 1040; m += 20) relevés.push([m, t0 + m * 250])
    await courir(relevés)
    const dit = voice.speak.mock.calls.map(([d]) => d)
    // La borne tombe au relevé qui la franchit, un pas de vingt mètres plus loin.
    // Par son rang, pas « ce kilomètre » ; et sans moyenne au premier, qui
    // répéterait le même temps.
    expect(dit).toEqual([expect.stringMatching(/^Premier kilomètre à 4 minutes 1\d\.$/)])
  })

  it('dit les bornes suivantes par leur rang, avec la moyenne', async () => {
    const voice = await import('./voice')
    voice.speak.mockClear()
    const t0 = 1_700_000_000_000
    const relevés = []
    for (let m = 0; m <= 3040; m += 20) relevés.push([m, t0 + m * 250])
    await courir(relevés)
    const dit = voice.speak.mock.calls.map(([d]) => d)
    expect(dit).toEqual([
      expect.stringMatching(/^Premier kilomètre à 4 minutes 1\d\.$/),
      expect.stringMatching(/^Deuxième kilomètre à 4 minutes 1\d\. Allure moyenne 4 minutes 1\d\.$/),
      expect.stringMatching(/^Troisième kilomètre à 4 minutes 1\d\. Allure moyenne 4 minutes 1\d\.$/),
    ])
  })
})

describe('les arrêts en chemin', () => {
  beforeEach(() => {
    localStorage.clear()
    fixes = null
  })
  afterEach(() => cleanup())

  it("annonce le point d'eau à l'approche, une seule fois", async () => {
    const voice = await import('./voice')
    voice.speak.mockClear()
    // Un point d'eau sur le deuxième côté du carré, à 150 m du départ.
    const arrets = [{ kind: 'water', lat: geometry[7][1], lon: geometry[7][0], along: 150, off: 0 }]
    render(
      <LiveRun route={boucle} request={null} sport="run" stage={null} stops={arrets} onPosition={() => {}} onStop={() => {}} />,
    )
    let t = Date.now()
    for (const point of geometry.slice(0, 7)) {
      t += 2000
      await relever(point, t)
    }
    const dit = voice.speak.mock.calls.map(([d]) => d).filter((d) => d.startsWith("Point d'eau"))
    expect(dit).toHaveLength(1)
    expect(dit[0]).toMatch(/^Point d'eau dans \d+ mètres\.$/)
    // Et l'écran le montre, avec sa distance.
    expect(document.querySelector('.nextstops')?.textContent).toMatch(/Point d'eau dans/)
  })
})
