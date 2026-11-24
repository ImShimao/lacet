import { expect, test } from '@playwright/test'

/**
 * Ce qu'on voit, à taille d'iPhone. Chaque test reprend un défaut déjà vu sur
 * l'écran (le menu passé sous les lignes, la coupure des vignettes, l'allure
 * repliée) : si l'un revient, il casse ici avant le téléphone.
 */

// Le lancement dure 1,5 s, mais la première page d'un Vite à froid, sur la CI,
// arrive bien plus tard : 4 s y ont déjà manqué.
const LAUNCH_MS = 15_000

test('le lancement se joue puis disparaît', async ({ page }) => {
  await page.goto('/')
  await expect(page.locator('.launch')).toBeVisible()
  await expect(page.locator('.launch')).toBeHidden({ timeout: LAUNCH_MS })
})

test("l'allure reste ouverte dans les filtres", async ({ page }) => {
  await page.goto('/')
  await expect(page.locator('.launch')).toBeHidden({ timeout: LAUNCH_MS })
  await page.getByRole('button', { name: 'Explorer' }).first().click()
  await page.getByRole('button', { name: /^Filtres/ }).click()
  await expect(page.getByRole('button', { name: 'min/km' })).toBeVisible()
  await expect(page.getByRole('button', { name: 'km/h' })).toBeVisible()
})

test('un menu de réglage passe devant les lignes qui suivent', async ({ page }) => {
  await page.goto('/')
  await expect(page.locator('.launch')).toBeHidden({ timeout: LAUNCH_MS })
  await page.getByRole('button', { name: 'Mon compte', exact: true }).first().click()
  await page.getByRole('button', { name: /^Guidage et voix/ }).click()
  await page.getByRole('button', { name: /^Anticipation des instructions/ }).click()

  // Le menu ouvert doit être l'élément qu'on touche au centre de sa première option.
  const option = page.getByRole('option', { name: 'Tôt' })
  await expect(option).toBeVisible()
  const box = await option.boundingBox()
  const topmost = await page.evaluate(
    ({ x, y }) => document.elementFromPoint(x, y)?.closest('[role="option"]')?.textContent ?? null,
    { x: box.x + box.width / 2, y: box.y + box.height / 2 },
  )
  expect(topmost).toContain('Tôt')
})

test("les fonds de carte tiennent sur l'écran, sans défilement latéral", async ({ page }) => {
  await page.goto('/')
  await expect(page.locator('.launch')).toBeHidden({ timeout: LAUNCH_MS })
  await page.getByRole('button', { name: 'Mon compte', exact: true }).first().click()
  await page.getByRole('button', { name: /^Apparence/ }).click()
  await page.getByRole('button', { name: /^Style de carte/ }).click()

  // Six fonds toujours là, deux de plus quand une clé Mapbox est posée — la
  // CI n'en a pas : ce qui compte, c'est que tous tiennent à l'écran.
  await expect(page.locator('.mapsheet__tile').first()).toBeVisible()
  expect(await page.locator('.mapsheet__tile').count()).toBeGreaterThanOrEqual(6)
  for (const tile of await page.locator('.mapsheet__tile').all()) {
    await expect(tile).toBeInViewport()
  }
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth)
  expect(overflow).toBeLessThanOrEqual(0)
})
