import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// Lacet est une app iPhone : `npm run build` produit le dossier `dist` que
// Capacitor emballe (voir `.github/workflows/ios.yml`). `npm run dev` ne sert
// qu'à développer l'interface — à taille de téléphone, sans GPS ni voix, qui
// n'existent que dans l'app.
export default defineConfig({
  plugins: [react()],
  // Les tests partent du français : voir `src/test-setup.js`.
  test: { setupFiles: ['./src/test-setup.js'] },
  server: {
    port: 5173,
    host: '127.0.0.1',
  },
})
