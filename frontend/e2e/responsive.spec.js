import { expect, test } from '@playwright/test'
import { addRecord, PNG_1, signInAs, uniqueUser } from './helpers.js'

const WIDTHS = [320, 375, 768, 1280]

const overflows = (page) =>
  page.evaluate(() => document.documentElement.scrollWidth > document.documentElement.clientWidth)

for (const width of WIDTHS) {
  test(`no sideways page scroll at ${width}px`, async ({ page }) => {
    await page.setViewportSize({ width, height: 800 })

    for (const path of ['/', '/about', '/contact', '/login']) {
      await page.goto(path)
      await expect(page.getByRole('heading', { level: 1 })).toBeVisible()
      expect(await overflows(page), path).toBe(false)
    }

    await signInAs(page, uniqueUser())
    await addRecord(page, { title: 'Responsive record with a fairly long title to stretch the table', image: PNG_1 })
    expect(await overflows(page), 'dashboard').toBe(false)

    await page.getByRole('link', { name: /^Edit / }).click()
    await expect(page.getByRole('heading', { name: 'Edit record' })).toBeVisible()
    expect(await overflows(page), 'edit form').toBe(false)
    await page.getByRole('link', { name: 'Cancel' }).click()

    await page.getByRole('button', { name: /^Delete / }).click()
    expect(await overflows(page), 'delete dialog').toBe(false)
    const box = await page.getByRole('dialog').boundingBox()
    expect(box.x).toBeGreaterThanOrEqual(0)
    expect(box.x + box.width).toBeLessThanOrEqual(width)
    await page.getByRole('dialog').getByRole('button', { name: 'Cancel' }).click()

    await page.getByRole('button', { name: /^Delete / }).click()
    await page.getByRole('dialog').getByRole('button', { name: 'Delete' }).click()
    await expect(page.getByRole('status').filter({ hasText: 'Record deleted.' })).toBeVisible()
  })
}

test('the phone menu opens, closes after a choice, and stays usable', async ({ page }) => {
  await page.setViewportSize({ width: 375, height: 800 })
  await page.goto('/')
  const toggle = page.getByRole('button', { name: 'Menu' })
  await expect(toggle).toBeVisible()
  await expect(page.getByRole('link', { name: 'About' })).toBeHidden()
  await toggle.click()
  await expect(toggle).toHaveAttribute('aria-expanded', 'true')
  await page.getByRole('link', { name: 'About' }).click()
  await expect(page.getByRole('heading', { name: 'About' })).toBeVisible()
  await expect(page.getByRole('link', { name: 'Contact' })).toBeHidden()
})

test('the desktop menu needs no toggle', async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 800 })
  await page.goto('/')
  await expect(page.getByRole('button', { name: 'Menu' })).toBeHidden()
  await expect(page.getByRole('link', { name: 'About' })).toBeVisible()
})
