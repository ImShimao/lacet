/**
 * Les captures du README (`docs/images/`), refaites d'un coup après une refonte.
 *
 * À taille d'iPhone (390 × 844, 3×), thème sombre, depuis Guebwiller : les rues
 * y sont livrées avec l'app, la recherche ne dépend pas d'Overpass. Le GPS, la
 * voix et le survol 3D n'existent pas dans un navigateur : « En course » et
 * « Le survol 3D » restent des captures du téléphone.
 *
 *   (cd frontend && npm run dev)            # dans un autre terminal
 *   (cd frontend && node scripts/captures.mjs)
 *
 * Les PNG sortent en 1170 px de large ; `scripts/captures.py` les réduit à
 * 780 px et 256 couleurs, comme le veut `CLAUDE.md`.
 */
import { mkdirSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { chromium } from '@playwright/test'

const OUT = join(dirname(fileURLToPath(import.meta.url)), '..', '..', 'docs', 'images', 'raw')
const BASE = process.env.LACET_URL ?? 'http://127.0.0.1:5173'
mkdirSync(OUT, { recursive: true })

const browser = await chromium.launch()
const context = await browser.newContext({
  viewport: { width: 390, height: 844 },
  deviceScaleFactor: 3,
  isMobile: true,
  hasTouch: true,
  locale: 'fr-FR',
  colorScheme: 'dark',
})
// Les captures montrent l'app, pas l'accueil de première ouverture.
await context.addInitScript(() => localStorage.setItem('lacet.accueil', 'oui'))
const page = await context.newPage()
const shot = async (name) => {
  // Le temps que les tuiles de la carte finissent d'arriver et les animations de s'arrêter.
  await page.waitForTimeout(2500)
  await page.screenshot({ path: join(OUT, `${name}.png`) })
  console.log(`${name}.png`)
}

await page.goto(BASE)
await page.locator('.launch').waitFor({ state: 'hidden', timeout: 15_000 })

// Le départ, puis les boucles.
await page.getByPlaceholder(/Chercher un lieu/).click()
await page.getByPlaceholder(/Chercher un lieu/).fill('Guebwiller')
await page.getByText('Guebwiller', { exact: true }).first().click()
await page.getByRole('button', { name: 'Trouver ma boucle' }).click()
await page.getByRole('button', { name: /Démarrer/ }).first().waitFor({ timeout: 120_000 })
await shot('1-boucles')

await page.getByRole('button', { name: /Détails/ }).first().click()
await shot('3-detail')
await page.keyboard.press('Escape')
await page.goto(BASE)
await page.locator('.launch').waitFor({ state: 'hidden', timeout: 15_000 })

// Les filtres.
await page.getByRole('button', { name: 'Explorer' }).first().click()
await page.getByRole('button', { name: /^Filtres/ }).click()
await shot('5-filtres')
await page.getByRole('button', { name: 'Annuler' }).click()

// Les réglages, en lignes : le guidage et la voix.
await page.getByRole('button', { name: 'Mon compte', exact: true }).first().click()
await page.getByRole('button', { name: /^Guidage et voix/ }).click()
await shot('6-reglages')

// Les fonds de carte.
await page.getByRole('button', { name: 'Mon compte', exact: true }).first().click()
await page.getByRole('button', { name: /^Apparence/ }).click()
await page.getByRole('button', { name: /^Style de carte/ }).click()
await page.waitForTimeout(8000)
await shot('7-fonds')

await browser.close()
