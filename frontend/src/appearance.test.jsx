/** @vitest-environment jsdom */
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

/**
 * La page « Apparence » et ce qu'elle pose sur `<html>`.
 *
 * Le choix doit agir tout de suite (les jetons de `01-base.css` lisent les
 * attributs), survivre à un relancement, suivre iOS en automatique, et partir
 * avec « Tout effacer » comme le reste des réglages.
 */

vi.mock('./platform', () => ({ isNative: () => false, saveTextFile: vi.fn() }))

// L'iPhone en mode clair, et de quoi le faire passer en sombre.
let osLight = true
const media = new Set()
window.matchMedia = () => ({
  get matches() {
    return osLight
  },
  addEventListener: (_type, fn) => media.add(fn),
})
const setOs = (light) => {
  osLight = light
  for (const fn of media) fn()
}

const Account = (await import('./Account.jsx')).default
const { DEFAULTS } = await import('./FiltersSheet.jsx')
const { load, wipe } = await import('./storage')
const { startAppearance } = await import('./appearance')

const root = document.documentElement

function page(key) {
  return render(
    <div className="side__body">
      <Account
        page={key}
        onPage={() => {}}
        params={DEFAULTS}
        geo={{ status: 'idle' }}
        history={[]}
        poiPrefs={{}}
        onPoiPrefs={() => {}}
        onProfile={() => {}}
        onClearData={async () => {}}
        onRestored={() => {}}
      />
    </div>,
  )
}

/** Une ligne de réglage ouvre son menu ; on y touche le choix. */
function choisir(ligne, choix) {
  fireEvent.click(screen.getByRole('button', { name: new RegExp('^' + ligne) }))
  fireEvent.click(screen.getByRole('option', { name: choix }))
}

describe('Apparence', () => {
  beforeEach(() => {
    wipe()
    setOs(true)
    startAppearance()
  })
  afterEach(() => cleanup())

  it("part de l'accent bleu, du thème de l'iPhone et du texte normal", () => {
    expect(root.dataset.accent).toBe('blue')
    expect(root.dataset.theme).toBe('light')
    expect(root.dataset.text).toBe('normal')
    page(null)
    expect(screen.getByText('Bleu · Thème auto · Texte normal')).toBeTruthy()
  })

  it('applique chaque choix au toucher et le garde', () => {
    page('appearance')
    choisir('Thème', 'Sombre')
    choisir("Couleur d'accent", 'Violet')
    choisir('Taille du texte', 'Grande')

    expect(root.dataset.theme).toBe('dark')
    expect(root.dataset.accent).toBe('violet')
    expect(root.dataset.text).toBe('large')
    fireEvent.click(screen.getByRole('button', { name: /^Couleur d'accent/ }))
    expect(screen.getByRole('option', { name: 'Violet' }).getAttribute('aria-selected')).toBe('true')
    expect(load().appearance).toEqual({ accent: 'violet', theme: 'dark', text: 'large' })

    // Au lancement suivant, le choix revient du magasin.
    root.removeAttribute('data-accent')
    startAppearance()
    expect(root.dataset.accent).toBe('violet')
  })

  it("suit iOS en automatique, et seulement en automatique", () => {
    setOs(false)
    expect(root.dataset.theme).toBe('dark')
    setOs(true)
    expect(root.dataset.theme).toBe('light')

    page('appearance')
    choisir('Thème', 'Sombre')
    setOs(true)
    expect(root.dataset.theme).toBe('dark')
  })

  it('repart à zéro avec « Tout effacer »', () => {
    page('appearance')
    choisir("Couleur d'accent", 'Vert')
    expect(root.dataset.accent).toBe('green')

    wipe()
    startAppearance()
    expect(root.dataset.accent).toBe('blue')
    expect(load().appearance).toBeUndefined()
  })
})
