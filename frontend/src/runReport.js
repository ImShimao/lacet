// Le rapport d'une sortie, pour la mettre au point depuis le PC.
//
// Ce que le téléphone seul voit — la précision réelle du GPS, ce que la voix a
// dit et où, chaque recalcul et sa durée, le baromètre — ne se retrouve pas dans
// l'aperçu. Un fichier JSON part par la feuille de partage d'iOS (Fichiers,
// OneDrive, AirDrop), et se relit au calme.
import { t } from './i18n'

// La clé de l'historique et des favoris : déjà dans `run`, et trop lourde.
const SKIPPED_KEYS = new Set(['lacet.v1'])
const MAX_VALUE_CHARS = 4000

/** Les réglages gardés sur le téléphone, sans l'historique. */
function settings(storage) {
  const out = {}
  try {
    for (let i = 0; i < storage.length; i += 1) {
      const key = storage.key(i)
      if (SKIPPED_KEYS.has(key)) continue
      const value = storage.getItem(key) ?? ''
      out[key] = value.length > MAX_VALUE_CHARS ? `${value.slice(0, MAX_VALUE_CHARS)}…` : value
    }
  } catch {
    // Un stockage refusé ne doit pas empêcher le rapport.
  }
  return out
}

/** Le texte JSON du rapport d'une sortie de l'historique. */
export function runReport(entry, { app = null, now = new Date(), env = globalThis } = {}) {
  const nav = env.navigator ?? {}
  return JSON.stringify(
    {
      lacet_report: 1,
      exported_at: now.toISOString(),
      app,
      device: {
        userAgent: nav.userAgent ?? null,
        language: nav.language ?? null,
        screen: env.screen ? [env.screen.width, env.screen.height] : null,
        pixelRatio: env.devicePixelRatio ?? null,
      },
      settings: env.localStorage ? settings(env.localStorage) : {},
      run: entry,
    },
    null,
    1,
  )
}

/** Le nom du fichier : la date de la sortie, lisible dans un dossier. */
export const reportFilename = (entry) => `lacet-rapport-${(entry.ranAt ?? new Date().toISOString()).slice(0, 16).replace(':', 'h')}.json`
