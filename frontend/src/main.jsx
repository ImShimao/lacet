import React from 'react'
import { createRoot } from 'react-dom/client'
import 'maplibre-gl/dist/maplibre-gl.css'
import './styles.css'
import App from './App.jsx'
import ErrorBoundary from './ErrorBoundary.jsx'
import { startOrientationLock } from './orientation'

// Avant le rendu : téléphone couché, l'app doit s'ouvrir déjà dans le bon sens
// plutôt que de pivoter sous les yeux après coup.
startOrientationLock()

createRoot(document.getElementById('root')).render(
  <React.StrictMode>
    <ErrorBoundary>
      <App />
    </ErrorBoundary>
  </React.StrictMode>,
)

// Le service worker n'est enregistré qu'en production. En développement, il
// mettrait en cache des modules que Vite recompile à chaque frappe, et on
// passerait la journée à se demander pourquoi une modification ne s'affiche pas.
if (import.meta.env.PROD && 'serviceWorker' in navigator) {
  // Après `load` : l'enregistrement lance des téléchargements, et les faire
  // concurrencer ceux de la page retarde le premier affichage.
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('/sw.js').catch((error) => {
      // Refusé en contexte non sécurisé, ou par les réglages du navigateur.
      // L'app fonctionne sans — elle ne s'ouvrira simplement pas hors ligne.
      console.info('Lacet — hors ligne indisponible :', error.message)
    })
  })
}
