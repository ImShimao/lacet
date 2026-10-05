import React from 'react'
import { createRoot } from 'react-dom/client'
// Les polices sont livrées avec l'app plutôt que demandées à Google à chaque
// ouverture : dehors, sans réseau, l'app gardait ses écrans mais perdait sa
// typographie — et chaque lancement signalait l'appareil à un tiers.
//
// La police mono n'est prise qu'en latin, qui couvre le français jusqu'à « œ ».
// Ses fichiers par jeu de caractères ne déclarent pas leur plage : en ajouter un
// second, le latin étendu, le faisait passer devant le premier pour *tous* les
// caractères, chiffres compris.
import '@fontsource-variable/bricolage-grotesque/opsz.css'
import '@fontsource/ibm-plex-mono/latin-400.css'
import '@fontsource/ibm-plex-mono/latin-500.css'
import '@fontsource/ibm-plex-mono/latin-600.css'
import 'maplibre-gl/dist/maplibre-gl.css'
import './styles/index.css'
import App from './App.jsx'
import ErrorBoundary from './ErrorBoundary.jsx'
import { isNative } from './platform'

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
if (isNative()) {
  document.documentElement.classList.add('native')
  import('./native').then((native) => native.bootNative())
}

// L'envoi vers Strava a été retiré de l'app (octobre 2026). Les jetons d'accès
// qu'une version précédente avait gardés ne servent plus à rien, et ce sont des
// clés : ils ne restent pas sur le téléphone.
try {
  localStorage.removeItem('lacet-strava')
  localStorage.removeItem('lacet-strava-state')
} catch {
  /* stockage refusé : rien à effacer */
}
