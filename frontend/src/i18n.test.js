/** @vitest-environment jsdom */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

/**
 * La langue de l'app : le français sert de clé, l'anglais est un dictionnaire, et
 * une clé qui manque retombe sur le français. Ce fichier protège aussi le
 * dictionnaire lui-même — une variable `{nom}` inventée ou oubliée en anglais
 * s'afficherait telle quelle à l'écran.
 */

const { DICTIONARIES, dec, lang, locale, onLang, setLang, startLang, systemLang, t, tn, tx } = await import('./i18n')
const { load, wipe } = await import('./storage')
const { stepText, routeName, engineText } = await import('./stepText')
const { distanceWords } = await import('./guidance')

const placeholders = (s) => [...s.matchAll(/\{(\w+)\}/g)].map((m) => m[1])

const navigatorIs = (...languages) => {
  Object.defineProperty(globalThis.navigator, 'languages', { value: languages, configurable: true })
  Object.defineProperty(globalThis.navigator, 'language', { value: languages[0], configurable: true })
}

describe('la langue', () => {
  beforeEach(() => {
    wipe()
    navigatorIs('fr-FR')
    startLang()
  })
  afterEach(() => {
    wipe()
    navigatorIs('fr-FR')
    startLang()
  })

  it('suit la langue d’iOS tant qu’aucun choix n’est gardé', () => {
    navigatorIs('fr-CA')
    startLang()
    expect(lang()).toBe('fr')
    navigatorIs('en-US')
    startLang()
    expect(lang()).toBe('en')
    navigatorIs('de-DE')
    expect(systemLang()).toBe('en')
  })

  it('garde le choix avec les autres préférences, et il l’emporte sur iOS', () => {
    navigatorIs('en-US')
    startLang()
    setLang('fr')
    expect(load().language).toBe('fr')
    startLang()
    expect(lang()).toBe('fr')
  })

  it('prévient les abonnés, et ignore une langue inconnue', () => {
    const seen = vi.fn()
    const off = onLang(seen)
    setLang('en')
    setLang('klingon')
    expect(seen).toHaveBeenCalledTimes(1)
    expect(seen).toHaveBeenCalledWith('en')
    expect(lang()).toBe('en')
    off()
    setLang('fr')
    expect(seen).toHaveBeenCalledTimes(1)
  })

  it('traduit, remplace les variables et retombe sur le français quand la clé manque', () => {
    expect(t('Mes parcours')).toBe('Mes parcours')
    setLang('en')
    expect(t('Mes parcours')).toBe('My routes')
    expect(t('Poids {v1} kg{v2}', { v1: 70, v2: '' })).toBe('Weight 70 kg')
    expect(t('Une phrase que personne n’a traduite')).toBe('Une phrase que personne n’a traduite')
    // Une variable absente reste visible, avec ses accolades : on la verra, on la corrigera.
    expect(t('{length} évitement{v2}', {})).toContain('{length}')
    // « faux » et « rien » ne s'écrivent pas « false » à l'écran.
    expect(t('Sorties{v1}', { v1: false })).toBe('Runs')
    expect(tx(42)).toBe(42)
  })

  it('accorde le pluriel : 0 est singulier en français, pluriel en anglais', () => {
    expect(tn('{n} chat', '{n} chats', 0)).toBe('0 chat')
    expect(tn('{n} chat', '{n} chats', 2)).toBe('2 chats')
    setLang('en')
    expect(tn('{n} chat', '{n} chats', 0)).toBe('0 chats')
    expect(tn('{n} chat', '{n} chats', 1)).toBe('1 chat')
  })

  it('met les dates, les nombres et le séparateur décimal dans la langue', () => {
    expect(locale()).toBe('fr-FR')
    expect(dec()).toBe(',')
    setLang('en')
    expect(locale()).toBe('en-GB')
    expect(dec()).toBe('.')
    expect(document.documentElement.lang).toBe('en')
  })
})

describe('le dictionnaire anglais', () => {
  const entries = Object.entries(DICTIONARIES.en)

  it('n’est pas vide, et ne laisse aucune traduction vide', () => {
    expect(entries.length).toBeGreaterThan(500)
    for (const [key, value] of entries) expect(value, key).not.toBe('')
  })

  it('ne parle que des variables de sa clé française', () => {
    for (const [key, value] of entries) {
      const allowed = new Set(placeholders(key))
      for (const name of placeholders(value)) expect(allowed.has(name), `${name} dans « ${key.slice(0, 50)} »`).toBe(true)
    }
  })
})

describe('les consignes du moteur, dites en anglais', () => {
  beforeEach(() => setLang('en'))
  afterEach(() => {
    wipe()
    setLang('fr')
  })

  it('traduit la grammaire fermée des virages, rues comprises', () => {
    expect(stepText('Tourne à gauche dans la rue Pasteur')).toBe('Turn left on rue Pasteur')
    expect(stepText("Serre à droite sur l'avenue Foch")).toBe("Bear right on avenue Foch")
    expect(stepText('Tourne franchement à droite sur Ladhof')).toBe('Turn sharp right on Ladhof')
    expect(stepText('Tourne à droite puis tout de suite à gauche dans la rue X')).toBe('Turn right then right away left on rue X')
    expect(stepText('Départ — pars vers le nord-est sur Ladhof.')).toBe('Start — head northeast on Ladhof.')
    expect(stepText('Au rond-point, prends la deuxième sortie sur Foch')).toBe('At the roundabout, take the second exit on Foch')
    expect(stepText('Fin du premier tour. Dernier tour. Repars vers le sud.')).toBe('End of the first lap. Last lap. Head south.')
  })

  it('laisse le français tel quel en français', () => {
    setLang('fr')
    expect(stepText('Tourne à gauche dans la rue Pasteur')).toBe('Tourne à gauche dans la rue Pasteur')
  })

  it('traduit le nom d’une proposition et les notes de sécurité, pas les noms de rues', () => {
    expect(routeName('Boucle sud-ouest · Boulevard Arago')).toBe('Southwest loop · Boulevard Arago')
    expect(engineText('Aucune portion au contact direct du trafic.')).toBe('No stretch in direct contact with traffic.')
    expect(engineText('120 m au contact du trafic, dont 40 m d\'un seul tenant.')).toBe('120 m in contact with traffic, of which 40 m in one stretch.')
  })

  it('dit les distances en anglais', () => {
    expect(distanceWords(60)).toBe('60 meters')
    expect(distanceWords(1500)).toBe('1.5 kilometers')
    expect(distanceWords(1000)).toBe('1 kilometer')
  })
})
