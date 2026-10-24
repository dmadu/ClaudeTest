import { expect, test } from '@playwright/test'
import { addRecord, deleteRecord, firstColumn, PNG_1, PNG_2, signInAs, uniqueUser } from './helpers.js'

test('visitor sees the public pages and is kept out of the dashboard', async ({ page }) => {
  await page.goto('/')
  const menu = page.getByRole('navigation', { name: 'Main' })
  for (const name of ['Home', 'About', 'Contact', 'Login']) {
    await expect(menu.getByRole('link', { name })).toBeVisible()
  }
  await expect(menu.getByRole('link', { name: 'Login' })).toHaveAttribute('href', '/api/auth/login')
  await menu.getByRole('link', { name: 'About' }).click()
  await expect(page.getByRole('heading', { name: 'About' })).toBeVisible()

  await page.goto('/dashboard')
  await expect(page).toHaveURL(/\/login\?error=required/)
  await expect(page.getByRole('alert')).toContainText('Please sign in to continue.')
})

test('contact form validates and sends', async ({ page }) => {
  await page.goto('/contact')
  await page.getByRole('button', { name: 'Send message' }).click()
  await expect(page.getByText('This field is required.')).toHaveCount(3)
  await page.getByLabel('Name').fill('E2E Tester')
  await page.getByLabel('Email').fill('e2e@example.test')
  await page.getByLabel('Message').fill('Sent by the end-to-end test.')
  await page.getByRole('button', { name: 'Send message' }).click()
  await expect(page.getByRole('status')).toContainText('Thank you')
})

test('full journey: login, add, sort, edit, delete, logout', async ({ page }) => {
  const user = uniqueUser()
  await signInAs(page, user)

  const menu = page.getByRole('navigation', { name: 'Main' })
  await expect(menu.getByRole('button', { name: 'Logout' })).toBeVisible()
  await expect(menu.getByRole('link', { name: 'Login' })).toHaveCount(0)
  await expect(page.getByText('You have no records yet.')).toBeVisible()

  await addRecord(page, { title: 'Beta site', site: 'Zeta', lat: '10.5', lon: '120' })
  await expect(page.getByText('You have 1 record.')).toBeVisible()
  await addRecord(page, { title: 'Alpha site', site: 'Omega', lat: '-20', lon: '130', image: PNG_2 })
  await expect(page.getByText('You have 2 records.')).toBeVisible()
  await expect(page.locator('tbody tr img').first()).toHaveJSProperty('complete', true)

  // newest first by default, then each sort direction
  await expect.poll(() => firstColumn(page)).toEqual(['Alpha site', 'Beta site'])
  await page.getByRole('button', { name: /^Title/ }).click()
  await expect(page).toHaveURL(/sort=title&order=asc/)
  await expect.poll(() => firstColumn(page)).toEqual(['Alpha site', 'Beta site'])
  await page.getByRole('button', { name: /^Title/ }).click()
  await expect.poll(() => firstColumn(page)).toEqual(['Beta site', 'Alpha site'])
  await page.getByRole('button', { name: /^Latitude/ }).click()
  await expect.poll(() => firstColumn(page)).toEqual(['Alpha site', 'Beta site'])

  // a refresh keeps the view
  await page.reload()
  await expect(page).toHaveURL(/sort=latitude&order=asc/)
  await expect.poll(() => firstColumn(page)).toEqual(['Alpha site', 'Beta site'])

  // edit: change text and replace the image
  const before = await page.locator('tbody tr', { hasText: 'Beta site' }).locator('img').getAttribute('src')
  await page.getByRole('link', { name: 'Edit Beta site' }).click()
  await expect(page.getByLabel('Title')).toHaveValue('Beta site')
  await page.getByLabel('Title').fill('Beta site (edited)')
  await page.getByLabel('Image').setInputFiles({ name: 'new.png', mimeType: 'image/png', buffer: PNG_2 })
  await page.getByRole('button', { name: 'Save changes' }).click()
  await expect(page.getByRole('status').filter({ hasText: 'Record updated.' })).toBeVisible()
  const row = page.locator('tbody tr', { hasText: 'Beta site (edited)' })
  await expect(row).toBeVisible()
  expect(await row.locator('img').getAttribute('src')).not.toBe(before)

  // cancelling a delete keeps the record, confirming removes it
  await page.getByRole('button', { name: 'Delete Alpha site' }).click()
  await page.getByRole('dialog').getByRole('button', { name: 'Cancel' }).click()
  await expect(page.getByText('Alpha site')).toBeVisible()
  await deleteRecord(page, 'Alpha site')
  await deleteRecord(page, 'Beta site (edited)')
  await expect(page.getByText('You have no records yet.')).toBeVisible()

  // logout ends the session
  await menu.getByRole('button', { name: 'Logout' }).click()
  await expect(menu.getByRole('link', { name: 'Login' })).toBeVisible()
  await page.goto('/dashboard')
  await expect(page).toHaveURL(/\/login\?error=required/)
})

test('the form rejects bad input in the browser and on the server', async ({ page }) => {
  await signInAs(page, uniqueUser())
  await page.getByRole('link', { name: 'Add record' }).click()

  await page.getByRole('button', { name: 'Add record' }).click()
  await expect(page.getByText('This field is required.')).toHaveCount(5)
  await expect(page.getByLabel('Title')).toBeFocused()

  await page.getByLabel('Title').fill('Bad input')
  await page.getByLabel('Site').fill('Somewhere')
  await page.getByLabel('Latitude').fill('95')
  await page.getByLabel('Longitude').fill('200')
  await page.getByLabel('Image').setInputFiles({ name: 'a.gif', mimeType: 'image/gif', buffer: Buffer.from('GIF89a') })
  await page.getByRole('button', { name: 'Add record' }).click()
  await expect(page.getByText('Must be between -90 and 90.')).toBeVisible()
  await expect(page.getByText('Must be between -180 and 180.')).toBeVisible()
  await expect(page.getByText('Image must be a JPEG or PNG file.')).toBeVisible()

  // Passes the browser's checks (claims to be a PNG) but is not an image: the server refuses it.
  await page.getByLabel('Latitude').fill('-35')
  await page.getByLabel('Longitude').fill('149')
  await page.getByLabel('Image').setInputFiles({ name: 'fake.png', mimeType: 'image/png', buffer: Buffer.from('<html>not an image</html>') })
  await page.getByRole('button', { name: 'Add record' }).click()
  await expect(page.getByText('Image must be a JPEG or PNG file.')).toBeVisible()
  await expect(page).toHaveURL(/\/records\/new$/)
})

test("users cannot see or open each other's records", async ({ browser }) => {
  const alice = await (await browser.newContext()).newPage()
  const bob = await (await browser.newContext()).newPage()
  await signInAs(alice, uniqueUser())
  await signInAs(bob, uniqueUser())

  await addRecord(alice, { title: 'Alice private', image: PNG_1 })
  const editHref = await alice.getByRole('link', { name: 'Edit Alice private' }).getAttribute('href')
  const imageSrc = await alice.locator('tbody tr img').first().getAttribute('src')

  await expect(bob.getByText('You have no records yet.')).toBeVisible()
  await expect(bob.getByText('Alice private')).toHaveCount(0)

  await bob.goto(editHref)
  await expect(bob.getByRole('alert')).toContainText('could not be found')
  const image = await bob.request.get(imageSrc)
  expect(image.status()).toBe(404)

  // Bob cannot delete it either, even with his valid session and token
  const id = editHref.split('/')[2]
  const status = await bob.evaluate(async (recordId) => {
    const me = await (await fetch('/api/auth/me')).json()
    const res = await fetch(`/api/records/${recordId}`, { method: 'DELETE', headers: { 'X-CSRF-Token': me.csrf_token } })
    return res.status
  }, id)
  expect(status).toBe(404)

  await alice.goto('/dashboard')
  await deleteRecord(alice, 'Alice private')
  await alice.context().close()
  await bob.context().close()
})

test('a signed-in write without the CSRF token is refused', async ({ page }) => {
  await signInAs(page, uniqueUser())
  const status = await page.evaluate(async () => {
    const res = await fetch('/api/auth/logout', { method: 'POST' })
    return res.status
  })
  expect(status).toBe(403)
  await page.reload()
  await expect(page.getByRole('heading', { name: 'Dashboard' })).toBeVisible() // still signed in
})
