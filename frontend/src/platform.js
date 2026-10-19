// Où tourne l'app.
//
// Lacet est une app iPhone. Ce test ne distingue plus deux versions : il sert
// seulement à ne pas appeler les modules natifs (écran de verrouillage,
// vibrations…) quand l'interface tourne ailleurs — dans les tests, ou dans
// l'aperçu de développement.

/** L'app native iPhone (Capacitor). */
export const isNative = () =>
  typeof window !== 'undefined' && window.Capacitor?.isNativePlatform?.() === true

/** Une vibration de l'iPhone (`tickHaptic`, `pulseHaptic`…) — rien ailleurs. */
export const haptic = (kind) => {
  if (isNative()) import('./native').then((n) => n[kind]())
}

/**
 * Enregistre un fichier texte là où l'utilisateur peut le reprendre : la
 * feuille de partage d'iOS — Fichiers, AirDrop, Strava, une montre…
 */
export async function saveTextFile(filename, text, mime) {
  const { shareTextFile } = await import('./native')
  return shareTextFile(filename, text, mime)
}
