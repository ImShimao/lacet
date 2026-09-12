import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import basicSsl from '@vitejs/plugin-basic-ssl'

export default defineConfig(({ mode }) => {
  // `npm run dev:mobile` — expose le serveur sur le réseau local, en HTTPS.
  // Safari sur iOS refuse la géolocalisation hors « contexte sécurisé », et une
  // adresse http://192.168.x.x n'en est pas un. Le certificat est auto-signé :
  // le téléphone affichera un avertissement, qu'il faut accepter une fois.
  const mobile = mode === 'mobile'

  // L'API passe par le même serveur que la page. Sans ce proxy, le téléphone
  // appellerait 127.0.0.1:8000 — c'est-à-dire lui-même — et en HTTPS le
  // navigateur bloquerait de toute façon un appel en clair.
  const proxy = {
    '/api': {
      target: 'http://127.0.0.1:8000',
      changeOrigin: true,
      rewrite: (path) => path.replace(/^\/api/, ''),
    },
  }

  // Les adresses de tunnel (`cloudflared tunnel --url …`) sont autorisées.
  // Depuis sa version 6, Vite refuse toute requête dont le nom d'hôte lui est
  // inconnu — une protection contre le « DNS rebinding » — et répondait donc
  // « Blocked request » à l'adresse en `*.trycloudflare.com` que le README
  // conseillait d'ouvrir sur le téléphone. Seul ce domaine est ajouté : le reste
  // de la protection reste en place.
  const allowedHosts = ['.trycloudflare.com']

  return {
    plugins: [react(), ...(mobile ? [basicSsl()] : [])],
    server: {
      port: 5173,
      host: mobile ? true : '127.0.0.1',
      proxy,
      allowedHosts,
    },
    // `npm run preview` sert le build de production, et c'est le **seul** mode
    // où le service worker s'enregistre : c'est donc là, et nulle part ailleurs,
    // que se vérifient le hors ligne, la page de repli et les cartes gardées.
    // Sans le même proxy, ce mode ne saurait pas calculer d'itinéraire, et il
    // faudrait tester la moitié de l'app à un endroit et l'autre moitié ailleurs.
    preview: {
      port: 4173,
      host: true,
      proxy,
      allowedHosts,
    },
  }
})
