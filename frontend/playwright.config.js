import { defineConfig } from '@playwright/test'

/**
 * Les parcours dans un vrai navigateur, à taille d'iPhone. Vitest (jsdom) ne voit
 * ni la mise en page ni le z-index : ces tests-ci attrapent ce qui se voit à
 * l'écran (un menu passé sous une ligne, une feuille qui déborde). Les fichiers
 * se nomment `*.e2e.js` pour que Vitest ne les prenne pas.
 *
 *     npx playwright test
 */
export default defineConfig({
  testDir: 'e2e',
  testMatch: '**/*.e2e.js',
  timeout: 30_000,
  use: {
    baseURL: 'http://127.0.0.1:5173',
    locale: 'fr-FR',
    // Chromium à la taille d'un iPhone 13 : le moteur de Safari n'est pas installé ici.
    browserName: 'chromium',
    viewport: { width: 390, height: 844 },
    deviceScaleFactor: 3,
    isMobile: true,
    hasTouch: true,
  },
  webServer: {
    command: 'npx vite --port 5173 --strictPort',
    url: 'http://127.0.0.1:5173',
    reuseExistingServer: true,
    timeout: 60_000,
  },
})
