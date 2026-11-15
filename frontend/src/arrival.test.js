import { describe, expect, it } from 'vitest'
import { arrivalWatcher } from './arrival'

/**
 * Terminer la sortie au bon endroit.
 *
 * Deux erreurs, très inégales. Terminer trop tard, c'est quelques secondes de
 * trop dans le chrono. Terminer trop tôt — au passage près du départ, à
 * mi-parcours —, c'est une sortie coupée en deux et un historique faux.
 */

/** Une approche : la distance à l'arrivée, relevé par relevé. */
function approche(watcher, distances, { planned = 10_000, from = 0, step = 1000 } = {}) {
  // Une approche commence de loin : c'est ce qui distingue une arrivée d'un
  // démarrage, et le module l'exige.
  watcher.push({ toFinish: 500, remaining: 500, covered: planned, planned, now: from - step })
  let out = null
  distances.forEach((toFinish, i) => {
    const r = watcher.push({
      toFinish,
      remaining: Math.max(0, toFinish),
      covered: planned,
      planned,
      now: from + i * step,
    })
    if (r && !out) out = { at: i, r }
  })
  return out
}

describe("l'arrivée", () => {
  it('termine au point le plus proche, pas au premier point sous le seuil', () => {
    // On arrive en courant : 60, 40, 20, 6, puis on repart. C'est à 6 m qu'on
    // était arrivé — et c'est le relevé d'après qui permet de le savoir.
    const w = arrivalWatcher()
    const out = approche(w, [60, 40, 20, 6, 15])
    expect(out).not.toBeNull()
    expect(out.at).toBe(4)
    expect(w.closest).toBe(6)
  })

  it('termine aussi quand on s’arrête sur place', () => {
    // Le cas le plus courant : on s'arrête sur la ligne, on souffle, et la
    // distance ne décroît plus. Personne n'a envie d'attendre.
    const w = arrivalWatcher()
    const out = approche(w, [50, 20, 5, 5.5, 6, 5.8, 6.2, 6])
    expect(out).not.toBeNull()
    // Cinq secondes après le relevé le plus proche — le troisième —, donc au
    // huitième. On ne compte pas depuis l'arrêt supposé : c'est le plus près
    // qui fait foi, et rien ne le battra plus.
    expect(out.at).toBe(7)
  })

  it('ne termine pas quand on passe à côté sans y aller', () => {
    // Vingt-cinq mètres, c'est la rue d'en face. Le bouton reste le seul à
    // décider : mieux vaut une sortie qu'on termine à la main qu'une sortie
    // coupée devant chez le voisin.
    const w = arrivalWatcher()
    expect(approche(w, [60, 40, 25, 28, 45, 80])).toBeNull()
  })

  it('ignore le passage près du départ à mi-parcours', () => {
    // Un aller-retour qui repasse devant le départ au cinquième kilomètre :
    // la distance à l'arrivée est nulle, mais il reste la moitié du tracé.
    const w = arrivalWatcher()
    const milieu = [30, 10, 2, 12, 40].map((toFinish, i) => ({
      toFinish,
      remaining: 5000,
      covered: 5000,
      planned: 10_000,
      now: i * 1000,
    }))
    for (const relevé of milieu) expect(w.push(relevé)).toBeNull()
    // Et l'approche réelle, une demi-heure plus tard, fonctionne quand même.
    expect(approche(w, [60, 30, 8, 20], { from: 1_800_000 })).not.toBeNull()
  })

  it('attend d’avoir vraiment couru la distance prévue', () => {
    // Un parcours abandonné au bout de deux kilomètres, qu'on ramène au
    // départ : le tracé restant dit qu'il reste huit kilomètres, et rien ne
    // doit se terminer tout seul.
    const w = arrivalWatcher()
    const out = [50, 20, 4, 30].map((toFinish, i) =>
      w.push({ toFinish, remaining: 8000, covered: 2000, planned: 10_000, now: i * 1000 }),
    )
    expect(out.every((r) => r === null)).toBe(true)
  })

  it('ne termine pas la sortie au moment même où on la lance', () => {
    // Le piège de la boucle : départ et arrivée sont le même point, et le
    // premier relevé peut se projeter à la fin du tracé. Sans garde, la sortie
    // se terminerait avant d'avoir commencé.
    const w = arrivalWatcher()
    const debut = [2, 3, 2.5, 4].map((toFinish, i) =>
      w.push({ toFinish, remaining: 20, covered: 9000, planned: 10_000, now: i * 1000 }),
    )
    expect(debut.every((r) => r === null)).toBe(true)
    // Puis on s'éloigne pour de bon, on revient : là, c'est une arrivée.
    w.push({ toFinish: 400, remaining: 9000, covered: 9000, planned: 10_000, now: 10_000 })
    expect(approche(w, [60, 10, 25], { from: 20_000 })).not.toBeNull()
  })

  it('termine même quand le GPS a sous-compté la distance', () => {
    // Un tunnel, un immeuble, une reprise de signal : les sauts de plus de cent
    // mètres ne sont pas comptés, et la distance cumulée finit en dessous du
    // parcours réel. Exiger quatre-vingts pour cent empêchait alors l'arrivée.
    const w = arrivalWatcher()
    w.push({ toFinish: 3000, remaining: 9000, covered: 100, planned: 10_000, now: 0 })
    const out = [60, 8, 20].map((toFinish, i) =>
      w.push({ toFinish, remaining: toFinish, covered: 6200, planned: 10_000, now: 10_000 + i * 1000 }),
    )
    expect(out).toContain('arrived')
  })

  it('ne se déclenche qu’une fois', () => {
    const w = arrivalWatcher()
    approche(w, [40, 5, 20])
    expect(approche(w, [3, 2, 30])).toBeNull()
  })

  it('supporte une sortie sans distance prévue', () => {
    // Un parcours importé, ou rouvert d'un favori sans longueur : le tracé
    // restant suffit alors à décider.
    const w = arrivalWatcher()
    const out = [900, 40, 6, 18].map((toFinish, i) =>
      w.push({ toFinish, remaining: toFinish, covered: 3000, planned: null, now: i * 1000 }),
    )
    expect(out).toContain('arrived')
  })
})

describe("l'arrivée, au plus juste", () => {
  it('élargit le cercle quand le GPS est imprécis', () => {
    // Entre deux immeubles, à vingt mètres près : passé à dix-huit mètres de la
    // ligne, on l'a franchie.
    const w = arrivalWatcher()
    w.push({ toFinish: 500, remaining: 500, covered: 10_000, planned: 10_000, now: 0 })
    let out = null
    ;[60, 35, 18, 30].forEach((toFinish, i) => {
      out ??= w.push({ toFinish, remaining: toFinish, covered: 10_000, planned: 10_000, accuracy: 20, now: 1000 * (i + 1) })
    })
    expect(out).toBe('arrived')
  })

  it('termine quand on s’arrête à la porte, un peu à côté du tracé', () => {
    // La boucle finit sur la rue ; on s'arrête à la porte, vingt-huit mètres
    // plus loin, et on n'y bouge plus.
    const w = arrivalWatcher()
    expect(approche(w, [60, 40, ...Array(9).fill(28)])).toBeNull()
    expect(approche(arrivalWatcher(), [60, 40, ...Array(18).fill(28)])?.at).toBe(12)
  })

  it('retient le point le plus proche, pas le relevé qui le prouve', () => {
    const w = arrivalWatcher()
    w.push({ toFinish: 500, remaining: 500, covered: 9500, planned: 10_000, now: 0 })
    ;[40, 12, 5, 9, 14].forEach((toFinish, i) => {
      w.push({ toFinish, remaining: toFinish, covered: 10_000 + i, planned: 10_000, at: { covered: 10_000 + i }, now: 1000 * (i + 1) })
    })
    expect(w.mark).toEqual({ covered: 10_002 })
  })
})
