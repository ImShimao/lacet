/** @vitest-environment jsdom */
import { act, cleanup, render } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'

/**
 * Les trois règles de la recherche.
 *
 * Elles vivaient au milieu d'App.jsx et n'avaient aucun test — alors que
 * chacune vient d'un défaut observé : des boucles affichées pour un réglage
 * qu'on venait de changer, un écran vide à ±2,5 %, et un repère qui semblait
 * finir à côté de sa propre boucle.
 */

let repondre = null
vi.mock('./api', () => ({
  generateLoops: (request) => repondre(request),
}))
vi.mock('./engine/client', () => ({ prefetchOnDevice: vi.fn() }))

const useSearch = (await import('./useSearch')).default

let api = null
function Sonde() {
  api = useSearch()
  return null
}

const boucle = (id, geometry = [[7.2, 47.9]]) => ({ id, name: 'Boucle ' + id, bearing: 90, geometry })
const reponse = (routes, meta = {}) => ({ routes, rejected: [], meta })

describe('la recherche', () => {
  afterEach(cleanup)

  it('n’affiche que la dernière demande, pas la plus lente', async () => {
    // Deux recherches se chevauchent, la première met plus longtemps : c'est la
    // seconde qui doit gagner, sinon l'écran montre les boucles d'un réglage
    // qu'on a déjà changé.
    render(<Sonde />)
    const attentes = []
    repondre = () => new Promise((resolve) => attentes.push(resolve))

    let lente
    let rapide
    await act(async () => {
      lente = api.run({ distance_km: 5 })
      rapide = api.run({ distance_km: 10 })
    })
    await act(async () => {
      attentes[1](reponse([boucle('rapide')]))
      await rapide
      attentes[0](reponse([boucle('lente')]))
      await lente
    })
    expect(api.result.routes[0].id).toBe('rapide')
    expect(api.busy).toBe(false)
  })

  it('élargit plutôt que de rendre un écran vide', async () => {
    render(<Sonde />)
    const vues = []
    repondre = async (request) => {
      vues.push(request.tolerance)
      return reponse(request.tolerance ? [] : [boucle('large')])
    }
    await act(async () => {
      await api.run({ distance_km: 20, tolerance: 0.025 })
    })
    // La seconde demande est faite sans tolérance, et le dit.
    expect(vues).toEqual([0.025, undefined])
    expect(api.result.routes[0].id).toBe('large')
    expect(api.result.meta.relaxed).toBe(true)
    expect(api.result.meta.message).toContain('±10')
  })

  it('fait rejoindre la rue au repère, et ne le dit que si ça se voit', async () => {
    render(<Sonde />)
    // La boucle commence à cent vingt mètres du point posé : sur la chaussée.
    repondre = async () => reponse([boucle('a', [[7.2016, 47.9]])])
    const poses = []
    await act(async () => {
      await api.run({ distance_km: 5 }, { from: { lat: 47.9, lon: 7.2 }, onStart: (p) => poses.push(p) })
    })
    expect(poses).toHaveLength(1)
    expect(poses[0].lon).toBeCloseTo(7.2016, 4)
    expect(api.snapped).toBeGreaterThan(50)

    // Trois mètres : le repère bouge de l'épaisseur d'un doigt, on se tait.
    await act(async () => {
      repondre = async () => reponse([boucle('b', [[7.20004, 47.9]])])
      await api.run({ distance_km: 5 }, { from: { lat: 47.9, lon: 7.2 }, onStart: (p) => poses.push(p) })
    })
    expect(api.snapped).toBeNull()
  })

  it('garde la demande avec le résultat, pour le recalcul en course', async () => {
    render(<Sonde />)
    repondre = async () => reponse([boucle('a')])
    await act(async () => {
      await api.run({ distance_km: 5, sport: 'run' })
    })
    expect(api.result.request).toMatchObject({ distance_km: 5, sport: 'run' })
  })

  it('rend l’erreur telle quelle, hors ligne compris', async () => {
    render(<Sonde />)
    repondre = async () => {
      const err = new Error('Pas de réseau')
      err.offline = true
      throw err
    }
    await act(async () => {
      await api.run({ distance_km: 5 })
    })
    expect(api.error).toEqual({ message: 'Pas de réseau', offline: true })
    expect(api.busy).toBe(false)
  })

  it('oublie les propositions quand le départ bouge', async () => {
    render(<Sonde />)
    repondre = async () => reponse([boucle('a')])
    await act(async () => {
      await api.run({ distance_km: 5 })
    })
    act(() => api.forget())
    expect(api.result).toBeNull()
    expect(api.selected).toBeNull()
  })
})
