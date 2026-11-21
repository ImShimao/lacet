import { expect, test } from '@playwright/test'

/**
 * Ce qu'on voit, à taille d'iPhone. Chaque test reprend un défaut déjà vu sur
 * l'écran (le menu passé sous les lignes, la coupure des vignettes, l'allure
 * repliée) : si l'un revient, il casse ici avant le téléphone.
 */

test('le lancement se joue puis disparaît', async ({ page }) => {
  await page.goto('/')
  await expect(page.locator('.launch')).toBeVisible()
  await expect(page.locator('.launch')).toBeHidden({ timeout: 4000 })
})

test("l'allure reste ouverte dans les filtres, comme la longueur", async ({ page }) => {
  await page.goto('/')
  await expect(page.locator('.launch')).toBeHidden({ timeout: 4000 })
  await page.getByRole('button', { name: 'Explorer' }).first().click()
  await page.getByRole('button', { name: /^Filtres/ }).click()
  await expect(page.getByRole('button', { name: 'min/km' })).toBeVisible()
  await expect(page.getByRole('button', { name: 'km/h' })).toBeVisible()
})

test('un menu de réglage passe devant les lignes qui suivent', async ({ page }) => {
  await page.goto('/')
  await expect(page.locator('.launch')).toBeHidden({ timeout: 4000 })
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
  await expect(page.locator('.launch')).toBeHidden({ timeout: 4000 })
  await page.getByRole('button', { name: 'Mon compte', exact: true }).first().click()
  await page.getByRole('button', { name: /^Apparence/ }).click()
  await page.getByRole('button', { name: /^Style de carte/ }).click()

  await expect(page.locator('.mapsheet__tile')).toHaveCount(8)
  for (const tile of await page.locator('.mapsheet__tile').all()) {
    await expect(tile).toBeInViewport()
  }
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth)
  expect(overflow).toBeLessThanOrEqual(0)
})
