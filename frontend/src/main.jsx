import React from 'react'
import { createRoot } from 'react-dom/client'
// La police est livrée avec l'app plutôt que demandée à Google à chaque
// ouverture : dehors, sans réseau, l'app gardait ses écrans mais perdait sa
// typographie — et chaque lancement signalait l'appareil à un tiers.
//
// Inter, une seule famille pour tout : ses chiffres à chasse fixe alignent
// les colonnes sans recourir à une police mono, et son axe de taille optique
// resserre d'elle-même les grands chiffres de course. Les fichiers déclarent
// leur jeu de caractères : seul le latin se charge.
import '@fontsource-variable/inter/opsz.css'
import 'maplibre-gl/dist/maplibre-gl.css'
import './styles/index.css'
import App from './App.jsx'
import ErrorBoundary from './ErrorBoundary.jsx'
import { isNative } from './platform'
import { mirrorTo, restoreFrom } from './storage'
import { getAppearance, onAppearance, startAppearance } from './appearance'

// Le thème, l'accent et la taille du texte, posés avant tout rendu : l'app
// s'ouvre dans ses couleurs, sans passer d'abord par celles d'origine.
startAppearance()

async function start() {
  const native = isNative() ? await import('./native').catch(() => null) : null
  if (native) {
    // Avant le premier rendu : `App` lit le magasin en se créant, et doit y
    // trouver ce que la copie a gardé si iOS a vidé le stockage — voir
    // `storage.js`. Le fichier n'est lu que dans ce cas-là — et l'apparence se
    // relit quand il l'a été.
    if (await restoreFrom(native.readStoreCopy)) startAppearance()
    mirrorTo(native.writeStoreCopy)
    // La barre d'état d'iOS suit le thème : texte clair sur le sombre, et l'inverse.
    native.setStatusBarTheme(getAppearance().resolved)
    onAppearance((look) => native.setStatusBarTheme(look.resolved))
  }

  createRoot(document.getElementById('root')).render(
    <React.StrictMode>
      <ErrorBoundary>
        <App />
      </ErrorBoundary>
    </React.StrictMode>,
  )

  // Dans l'app, rien ne se sélectionne : un appui long faisait surgir le menu
  // « Copier / Rechercher / Traduire » d'iOS par-dessus la carte, au moment
  // précis où l'on garde le doigt sur l'écran pour lire. Le style s'accroche à
  // cette classe (`styles/04-buttons.css`).
  if (native) {
    document.documentElement.classList.add('native')
    native.bootNative()
  }
}

start()

// L'envoi vers Strava a été retiré de l'app (octobre 2026). Les jetons d'accès
// qu'une version précédente avait gardés ne servent plus à rien, et ce sont des
// clés : ils ne restent pas sur le téléphone.
try {
  localStorage.removeItem('lacet-strava')
  localStorage.removeItem('lacet-strava-state')
} catch {
  /* stockage refusé : rien à effacer */
}
