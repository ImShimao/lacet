/** @vitest-environment jsdom */
import { beforeEach, describe, expect, it, vi } from 'vitest'

/**
 * La voix, au plus près d'iOS : ce que `voice.js` transmet au module natif.
 *
 * Les sorties écoutées (`LiveRun.voice.test.jsx`) remplacent ce module tout
 * entier ; ici, on vérifie le dernier pas — qu'une phrase part avec la voix et
 * le débit réglés, qu'elle ne part pas hors sortie, et qu'une annonce de confort
 * ne coupe pas une consigne.
 */
const speakNative = vi.fn()
const stopSpeechNative = vi.fn()
vi.mock('./native', () => ({ speakNative, stopSpeechNative }))

const { LEAD, RATE, VOICE_DEFAULTS, preview, setEnabled, speak, voiceSettings } = await import('./voice')
const { save } = await import('./storage')
const { setLang } = await import('./i18n')

// Le module natif est importé à la demande : laisser passer la promesse.
const flush = () => new Promise((resolve) => setTimeout(resolve, 0))

describe('la voix', () => {
  beforeEach(async () => {
    localStorage.clear()
    setEnabled(false)
    await flush()
    speakNative.mockClear()
    stopSpeechNative.mockClear()
  })

  it('se tait hors sortie, et ne parle pas pour rien', async () => {
    expect(speak('Tourne à gauche')).toBe(false)
    setEnabled(true)
    expect(speak('')).toBe(false)
    await flush()
    expect(speakNative).not.toHaveBeenCalled()
  })

  it('dit une consigne avec la voix et le débit réglés', async () => {
    save({ voice: { voiceId: 'fr-FR.Thomas', rate: 'fast' } })
    setEnabled(true)
    expect(speak('Dans cent mètres, tourne à droite')).toBe(true)
    await flush()
    expect(speakNative).toHaveBeenCalledWith('Dans cent mètres, tourne à droite', { priority: true, voice: 'fr-FR.Thomas', rate: RATE.fast, lang: 'fr-FR' })
  })

  it('laisse finir une consigne quand l’annonce n’est que du confort', async () => {
    setEnabled(true)
    speak('Kilomètre 3', { priority: false })
    await flush()
    expect(speakNative.mock.calls[0][1].priority).toBe(false)
  })

  it('coupe la phrase en cours quand la sortie s’arrête', async () => {
    setEnabled(true)
    setEnabled(false)
    await flush()
    expect(stopSpeechNative).toHaveBeenCalledTimes(1)
  })

  it('fait écouter la voix dans les réglages, même hors sortie', async () => {
    save({ voice: { rate: 'slow' } })
    preview()
    await flush()
    expect(speakNative).toHaveBeenCalledWith(expect.stringMatching(/tourne à gauche/), { voice: null, rate: RATE.slow, lang: 'fr-FR' })
  })

  it('retombe sur les réglages d’origine, et sur un débit normal s’il est inconnu', async () => {
    expect(voiceSettings()).toEqual(VOICE_DEFAULTS)
    expect(LEAD[voiceSettings().lead]).toBe(1)
    save({ voice: { rate: 'turbo' } })
    setEnabled(true)
    speak('Allure 5:30')
    await flush()
    expect(speakNative.mock.calls[0][1].rate).toBe(1)
  })

  it('parle la langue de l’app : l’anglais demande une voix anglaise, et dit sa phrase d’essai', async () => {
    setLang('en')
    try {
      setEnabled(true)
      speak('In 100 meters, turn left.')
      await flush()
      preview()
      await flush()
      expect(speakNative.mock.calls[0][1].lang).toBe('en-GB')
      expect(speakNative.mock.calls[1][0]).toBe('In two hundred meters, turn left.')
      expect(speakNative.mock.calls[1][1].lang).toBe('en-GB')
    } finally {
      setLang('fr')
    }
  })
})
