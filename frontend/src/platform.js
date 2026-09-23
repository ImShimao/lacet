// Où tourne l'app.
//
// Il y a eu deux versions — « préparation » sur ordinateur, « complète » sur
// téléphone —, et un réglage pour forcer l'une ou l'autre quand la détection se
// trompait. Un réglage de plus à comprendre, pour cacher des boutons que
// personne ne demandait à cacher : l'app est désormais complète partout, et
// c'est à la personne de décider si elle lance une sortie depuis son ordinateur.

/** L'app native iPhone (Capacitor), par opposition au navigateur. */
export const isNative = () =>
  typeof window !== 'undefined' && window.Capacitor?.isNativePlatform?.() === true

/**
 * Enregistre un fichier texte là où l'utilisateur peut le reprendre.
 *
 * Dans un navigateur, un lien de téléchargement suffit. Dans l'app native, ce
 * lien ne fait rien — WebKit ignore l'attribut `download` — et c'est la feuille
 * de partage d'iOS qui prend le relais : Fichiers, AirDrop, Strava, une montre…
 */
export async function saveTextFile(filename, text, mime) {
  if (isNative()) {
    const { shareTextFile } = await import('./native')
    return shareTextFile(filename, text, mime)
  }
  const blob = new Blob([text], { type: mime })
  const url = URL.createObjectURL(blob)
  const link = document.createElement('a')
  link.href = url
  link.download = filename
  document.body.appendChild(link)
  link.click()
  link.remove()
  setTimeout(() => URL.revokeObjectURL(url), 1000)
}
