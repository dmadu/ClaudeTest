import { expect } from '@playwright/test'

// A 1x1 and a 2x2 PNG, so a replacement image is visibly a different file.
export const PNG_1 = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==',
  'base64',
)
export const PNG_2 = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAIAAAACCAIAAAD91JpzAAAAFElEQVR4nGP4z8DAAMIM////ZwAAHu8E/KPItPcAAAAASUVORK5CYII=',
  'base64',
)

let counter = 0
/** A unique throwaway user name the mock AAF login accepts (1-20 letters or digits). */
export const uniqueUser = () => `e2e${Date.now().toString(36)}${counter++}`.slice(0, 20)

export async function signInAs(page, name) {
  await page.goto(`/api/auth/mock-login?user=${name}`)
  await expect(page).toHaveURL(/\/dashboard$/)
  await expect(page.getByRole('heading', { name: 'Dashboard' })).toBeVisible()
}

export async function addRecord(page, { title, site = 'Test site', lat = '-35.2809', lon = '149.13', image = PNG_1 }) {
  await page.getByRole('link', { name: 'Add record' }).click()
  await page.getByLabel('Title').fill(title)
  await page.getByLabel('Site').fill(site)
  await page.getByLabel('Latitude').fill(lat)
  await page.getByLabel('Longitude').fill(lon)
  await page.getByLabel('Image').setInputFiles({ name: 'site.png', mimeType: 'image/png', buffer: image })
  await page.getByRole('button', { name: 'Add record' }).click()
  await expect(page.getByRole('status').filter({ hasText: 'Record added.' })).toBeVisible()
}

export async function deleteRecord(page, title) {
  await page.getByRole('button', { name: `Delete ${title}` }).click()
  await page.getByRole('dialog').getByRole('button', { name: 'Delete' }).click()
  await expect(page.getByRole('status').filter({ hasText: 'Record deleted.' })).toBeVisible()
}

export const firstColumn = (page) => page.locator('tbody tr td:first-child').allTextContents()
