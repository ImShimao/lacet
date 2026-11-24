// Les tests décrivent l'app en français, sa langue de référence : sans cela,
// jsdom (« en-US ») la mettrait en anglais. Un test d'anglais appelle `setLang`.
try {
  Object.defineProperty(globalThis.navigator, 'language', { value: 'fr-FR', configurable: true })
  Object.defineProperty(globalThis.navigator, 'languages', { value: ['fr-FR'], configurable: true })
} catch {
  // Sans `navigator` (Node), la langue par défaut est déjà le français.
}
