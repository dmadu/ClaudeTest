import { createRequire } from 'node:module'
import { expect, test } from '@playwright/test'
import { addRecord, deleteRecord, PNG_1, signInAs, uniqueUser } from './helpers.js'

const axePath = createRequire(import.meta.url).resolve('axe-core/axe.min.js')

async function violations(page) {
  await page.addScriptTag({ path: axePath })
  return page.evaluate(async () => {
    const results = await window.axe.run(document.body)
    return results.violations.map((v) => `${v.id} (${v.impact}): ${v.nodes.map((n) => n.target.join(' ')).join(' | ')}`)
  })
}

for (const scheme of ['light', 'dark']) {
  for (const viewport of [
    { name: 'desktop', width: 1280, height: 800 },
    { name: 'phone', width: 375, height: 800 },
  ]) {
    test(`no accessibility violations, including colour contrast (${scheme}, ${viewport.name})`, async ({ page }) => {
      await page.setViewportSize({ width: viewport.width, height: viewport.height })
      await page.emulateMedia({ colorScheme: scheme })

      for (const path of ['/', '/about', '/contact', '/login?error=invalid']) {
        await page.goto(path)
        await expect(page.getByRole('heading', { level: 1 })).toBeVisible()
        expect(await violations(page), path).toEqual([])
      }

      await page.goto('/contact')
      await page.getByRole('button', { name: 'Send message' }).click()
      await expect(page.getByText('This field is required.').first()).toBeVisible()
      expect(await violations(page), 'contact with errors').toEqual([])

      await signInAs(page, uniqueUser())
      await expect(page.getByText('You have no records yet.')).toBeVisible()
      expect(await violations(page), 'empty dashboard').toEqual([])

      await addRecord(page, { title: 'A11y record', image: PNG_1 })
      expect(await violations(page), 'dashboard with a record').toEqual([])

      await page.getByRole('link', { name: 'Edit A11y record' }).click()
      await expect(page.getByRole('heading', { name: 'Edit record' })).toBeVisible()
      expect(await violations(page), 'edit form').toEqual([])
      await page.getByLabel('Title').fill('')
      await page.getByRole('button', { name: 'Save changes' }).click()
      await expect(page.getByText('This field is required.')).toBeVisible()
      expect(await violations(page), 'edit form with errors').toEqual([])
      await page.getByRole('link', { name: 'Cancel' }).click()

      await page.getByRole('button', { name: 'Delete A11y record' }).click()
      await expect(page.getByRole('dialog')).toBeVisible()
      expect(await violations(page), 'delete dialog').toEqual([])
      await page.getByRole('dialog').getByRole('button', { name: 'Cancel' }).click()

      await deleteRecord(page, 'A11y record')
    })
  }
}

test('keyboard: skip link, tab order and dialog focus', async ({ page }) => {
  await signInAs(page, uniqueUser())
  await addRecord(page, { title: 'Keyboard record', image: PNG_1 })

  await page.goto('/dashboard')
  await page.keyboard.press('Tab')
  await expect(page.getByRole('link', { name: 'Skip to content' })).toBeFocused()
  await page.keyboard.press('Enter')
  await expect(page).toHaveURL(/#main$/)

  // open the delete dialog from the keyboard, Tab stays inside it, Escape returns focus
  const trigger = page.getByRole('button', { name: 'Delete Keyboard record' })
  await trigger.focus()
  await page.keyboard.press('Enter')
  const dialog = page.getByRole('dialog')
  await expect(dialog.getByRole('button', { name: 'Cancel' })).toBeFocused()
  for (let i = 0; i < 5; i++) {
    await page.keyboard.press('Tab')
    expect(await dialog.evaluate((el) => el.contains(document.activeElement))).toBe(true)
  }
  await page.keyboard.press('Escape')
  await expect(dialog).toHaveCount(0)
  await expect(trigger).toBeFocused()

  // every interactive control shows a visible focus ring
  const ringless = await page.evaluate(() => {
    const bad = []
    for (const el of document.querySelectorAll('a[href], button:not([disabled]), input, select, [tabindex="0"]')) {
      if (el.offsetParent === null) continue
      el.focus()
      const s = getComputedStyle(el)
      if (!(parseFloat(s.outlineWidth) > 0 && s.outlineStyle !== 'none')) bad.push(el.outerHTML.slice(0, 80))
    }
    return bad
  })
  expect(ringless).toEqual([])

  await deleteRecord(page, 'Keyboard record')
})
