import { createHmac } from 'node:crypto'
import { expect, test } from '@playwright/test'
import { addRecord, deleteRecord, PNG_1, PNG_2 } from '../e2e/helpers.js'

const SECRET = process.env.E2E_AAF_SECRET
const ISSUER = process.env.E2E_AAF_ISSUER || 'https://rapid.test.aaf.edu.au'
const AUDIENCE = process.env.E2E_AAF_AUDIENCE || 'https://localhost'
const RAPID_URL_START = process.env.E2E_AAF_URL_START || 'https://rapid.test.aaf.edu.au/'

test.beforeAll(() => {
  if (!SECRET) throw new Error('Set E2E_AAF_SECRET to the AAF shared secret of the deployment under test')
})

const b64url = (value) => Buffer.from(typeof value === 'string' ? value : JSON.stringify(value)).toString('base64url')

/** An assertion like the ones AAF Rapid Connect sends. */
function assertion(name, { secret = SECRET, jti, expiresIn = 60 } = {}) {
  const now = Math.floor(Date.now() / 1000)
  const head = b64url({ alg: 'HS256', typ: 'JWT' })
  const body = b64url({
    iss: ISSUER,
    aud: AUDIENCE,
    iat: now,
    nbf: now,
    exp: now + expiresIn,
    jti: jti || `smoke-${name}-${Date.now()}-${Math.random()}`,
    typ: 'authnresponse',
    sub: `smoke!${name}`,
    'https://aaf.edu.au/attributes': { displayname: `Smoke ${name}`, mail: `${name}@example.test` },
  })
  const signature = createHmac('sha256', secret).update(`${head}.${body}`).digest('base64url')
  return `${head}.${body}.${signature}`
}

let counter = 0
const uniqueName = () => `s${Date.now().toString(36)}${counter++}`

const callback = (page, token) =>
  page.request.post('/api/auth/callback', { form: { assertion: token }, maxRedirects: 0 })

async function signIn(page, name = uniqueName()) {
  const res = await callback(page, assertion(name))
  expect(res.status()).toBe(303)
  expect(res.headers().location).toBe('/dashboard')
  await page.goto('/dashboard')
  await expect(page.getByRole('heading', { name: 'Dashboard' })).toBeVisible()
  return name
}

test('serves the site over HTTPS with the security headers on pages and API', async ({ request }) => {
  const page = await request.get('/')
  expect(page.url().startsWith('https://')).toBe(true)
  const h = page.headers()
  expect(h['content-security-policy']).toContain("default-src 'self'")
  expect(h['content-security-policy']).toContain("frame-ancestors 'none'")
  expect(h['strict-transport-security']).toMatch(/^max-age=\d+/)
  expect(h['x-content-type-options']).toBe('nosniff')
  expect(h['x-frame-options']).toBe('DENY')
  expect(h['referrer-policy']).toBe('same-origin')
  expect(h.server).toBeUndefined()

  const api = await request.get('/api/health')
  expect(api.status()).toBe(200)
  expect(await api.json()).toEqual({ status: 'ok', database: 'ok' })
  expect(api.headers()['cache-control']).toBe('no-store')
  expect(api.headers()['content-security-policy']).toContain("default-src 'none'")
  expect(api.headers().server).toBeUndefined()
})

test('plain HTTP is redirected to HTTPS', async ({ request }) => {
  const url = new URL(process.env.E2E_BASE_URL || 'https://localhost')
  const res = await request.get(`http://${url.hostname}/some/page?x=1`, { maxRedirects: 0 })
  expect([301, 302, 307, 308]).toContain(res.status())
  expect(res.headers().location).toBe(`https://${url.hostname}/some/page?x=1`)
})

test('pages load directly and after a reload, and unknown pages show the app 404', async ({ page }) => {
  await page.goto('/about')
  await expect(page.getByRole('heading', { name: 'About' })).toBeVisible()
  await page.reload()
  await expect(page.getByRole('heading', { name: 'About' })).toBeVisible()
  await page.goto('/no/such/page')
  await expect(page.getByRole('heading', { name: 'Page not found' })).toBeVisible()
})

test('the page runs under its Content Security Policy without violations', async ({ page }) => {
  const problems = []
  page.on('console', (msg) => {
    if (/content security policy|refused to/i.test(msg.text())) problems.push(msg.text())
  })
  await signIn(page)
  await addRecord(page, { title: 'CSP check', image: PNG_1 })
  await page.getByRole('link', { name: 'Edit CSP check' }).click()
  await page.getByLabel('Image').setInputFiles({ name: 'n.png', mimeType: 'image/png', buffer: PNG_2 })
  await expect(page.getByAltText('Preview of the selected image')).toBeVisible() // a blob: preview
  await page.getByRole('link', { name: 'Cancel' }).click()
  await deleteRecord(page, 'CSP check')
  expect(problems).toEqual([])
})

test('built files are cached for a long time and the page itself is not', async ({ request }) => {
  const html = await (await request.get('/')).text()
  const asset = html.match(/\/assets\/[^"']+\.js/)[0]
  expect((await request.get('/')).headers()['cache-control']).toBe('no-cache')
  const res = await request.get(asset)
  expect(res.status()).toBe(200)
  expect(res.headers()['cache-control']).toContain('immutable')
  expect(res.headers()['content-encoding']).toMatch(/zstd|gzip|br/)
})

test('the mock login does not exist and Login goes to AAF', async ({ request }) => {
  expect((await request.get('/api/auth/mock-login', { maxRedirects: 0 })).status()).toBe(404)
  const res = await request.get('/api/auth/login', { maxRedirects: 0 })
  expect(res.status()).toBe(302)
  expect(res.headers().location.startsWith(RAPID_URL_START)).toBe(true)
})

test('AAF sign-in sets a Secure, HttpOnly, SameSite=Lax session cookie', async ({ page }) => {
  await signIn(page)
  const cookies = (await page.context().cookies()).filter((c) => c.name === 'session')
  expect(cookies).toHaveLength(1)
  expect(cookies[0]).toMatchObject({ secure: true, httpOnly: true, sameSite: 'Lax' })
})

test('bad or reused assertions are refused', async ({ page }) => {
  const name = uniqueName()
  const bad = await callback(page, assertion(name, { secret: 'not-the-shared-secret-at-all-0123456789' }))
  expect(bad.headers().location).toBe('/login?error=invalid')
  const expired = await callback(page, assertion(name, { expiresIn: -3600 }))
  expect(expired.headers().location).toBe('/login?error=invalid')

  const token = assertion(name)
  expect((await callback(page, token)).headers().location).toBe('/dashboard')
  expect((await callback(page, token)).headers().location).toBe('/login?error=invalid') // replay
})

test('full journey in the production build: add, edit, delete, logout', async ({ page }) => {
  await signIn(page)
  await addRecord(page, { title: 'Prod record', site: 'Prod site' })
  await expect(page.getByText('You have 1 record.')).toBeVisible()
  await expect(page.locator('tbody tr img').first()).toHaveJSProperty('complete', true)

  await page.getByRole('link', { name: 'Edit Prod record' }).click()
  await page.getByLabel('Title').fill('Prod record (edited)')
  await page.getByRole('button', { name: 'Save changes' }).click()
  await expect(page.getByRole('status').filter({ hasText: 'Record updated.' })).toBeVisible()

  await deleteRecord(page, 'Prod record (edited)')
  await page.getByRole('button', { name: 'Logout' }).click()
  await expect(page.getByRole('navigation', { name: 'Main' }).getByRole('link', { name: 'Login' })).toBeVisible()
})

test('the proxy refuses an oversized upload with a clear JSON message', async ({ page }) => {
  await signIn(page)
  const { csrf_token: csrf } = await (await page.request.get('/api/auth/me')).json()
  const res = await page.request.post('/api/records', {
    headers: { 'X-CSRF-Token': csrf },
    multipart: {
      title: 'Too big',
      site: 'x',
      latitude: '1',
      longitude: '2',
      image: { name: 'huge.png', mimeType: 'image/png', buffer: Buffer.alloc(8 * 1024 * 1024) },
    },
  })
  expect(res.status()).toBe(413)
  expect((await res.json()).errors.image).toBe('Image must be 5 MB or smaller.')
})

test('a write without the CSRF token is refused', async ({ page }) => {
  await signIn(page)
  expect((await page.request.post('/api/auth/logout')).status()).toBe(403)
})

test('rate limits count the real client and ignore a forged X-Forwarded-For (keep this test last)', async ({ request }) => {
  const codes = []
  for (let i = 0; i < 7; i++) {
    const res = await request.post('/api/contact', {
      headers: { 'X-Forwarded-For': `10.9.8.${i}` },
      data: { name: 'Smoke', email: 'smoke@example.test', message: 'rate limit check' },
    })
    codes.push(res.status())
  }
  expect(codes).toEqual([201, 201, 201, 201, 201, 429, 429])
})
