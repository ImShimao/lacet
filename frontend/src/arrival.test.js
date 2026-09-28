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

  it('ne se déclenche qu’une fois', () => {
    const w = arrivalWatcher()
    approche(w, [40, 5, 20])
    expect(approche(w, [3, 2, 30])).toBeNull()
  })

  it('supporte une sortie sans distance prévue', () => {
    // Un parcours importé, ou rouvert d'un favori sans longueur : le tracé
    // restant suffit alors à décider.
    const w = arrivalWatcher()
    const out = [40, 6, 18].map((toFinish, i) =>
      w.push({ toFinish, remaining: toFinish, covered: 3000, planned: null, now: i * 1000 }),
    )
    expect(out).toContain('arrived')
  })
})
