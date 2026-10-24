import { screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import axe from 'axe-core'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { ADA, jsonResponse, mockApi, renderAt } from './testUtils.jsx'

afterEach(() => vi.restoreAllMocks())

// jsdom has no layout, so colour contrast is checked separately in a real browser.
async function expectNoViolations() {
  const results = await axe.run(document.body, { rules: { 'color-contrast': { enabled: false } } })
  const summary = results.violations.map((v) => `${v.id}: ${v.nodes.map((n) => n.target.join(' ')).join(', ')}`)
  expect(summary).toEqual([])
}

const rec = (i) => ({
  id: i, title: `Survey ${i}`, site: `Site ${i}`, latitude: -30.5, longitude: 140.25,
  image_url: `/api/records/${i}/image?v=x`, created_at: '2025-01-01T00:00:00', updated_at: '2025-01-01T00:00:00',
})
const list = (records) => () =>
  jsonResponse({ records, total: records.length, page: 1, page_size: 10, pages: records.length ? 1 : 0 })

describe('accessibility checker', () => {
  it('actually reports problems (negative control)', async () => {
    document.body.innerHTML = '<main><img src="x.png"><button></button></main>'
    const results = await axe.run(document.body, { rules: { 'color-contrast': { enabled: false } } })
    expect(results.violations.map((v) => v.id)).toEqual(expect.arrayContaining(['image-alt', 'button-name']))
    document.body.innerHTML = ''
  })
})

describe('accessibility (axe)', () => {
  it.each([
    ['home', '/', 'Site Records'],
    ['about', '/about', 'About'],
    ['contact', '/contact', 'Contact'],
    ['login', '/login', 'Login'],
    ['login with an error', '/login?error=invalid', 'Login'],
    ['not found', '/nowhere', 'Page not found'],
  ])('%s page has no violations', async (_name, path, heading) => {
    mockApi()
    renderAt(path)
    await screen.findByRole('heading', { name: heading })
    await expectNoViolations()
  })

  it('signed-in menu has no violations', async () => {
    mockApi({ user: ADA })
    renderAt('/')
    await screen.findByText('Ada Lovelace')
    await expectNoViolations()
  })

  it('contact form with errors has no violations', async () => {
    mockApi()
    renderAt('/contact')
    await userEvent.click(screen.getByRole('button', { name: 'Send message' }))
    await screen.findAllByText('This field is required.')
    await expectNoViolations()
  })

  it('dashboard table has no violations', async () => {
    mockApi({ user: ADA, routes: { '/api/records': list([rec(1), rec(2)]) } })
    renderAt('/dashboard')
    await screen.findByText('Survey 1')
    await expectNoViolations()
  })

  it('empty dashboard has no violations', async () => {
    mockApi({ user: ADA, routes: { '/api/records': list([]) } })
    renderAt('/dashboard')
    await screen.findByText('You have no records yet.')
    await expectNoViolations()
  })

  it('delete dialog has no violations', async () => {
    mockApi({ user: ADA, routes: { '/api/records': list([rec(1)]) } })
    renderAt('/dashboard')
    await userEvent.click(await screen.findByRole('button', { name: 'Delete Survey 1' }))
    await screen.findByRole('dialog')
    await expectNoViolations()
  })

  it('add form has no violations, with and without errors', async () => {
    mockApi({ user: ADA })
    renderAt('/records/new')
    await screen.findByRole('heading', { name: 'Add record' })
    await expectNoViolations()
    await userEvent.click(screen.getByRole('button', { name: 'Add record' }))
    await screen.findAllByText('This field is required.')
    await expectNoViolations()
  })

  it('edit form has no violations', async () => {
    mockApi({ user: ADA, routes: { '/api/records/1': () => jsonResponse({ record: rec(1) }) } })
    renderAt('/records/1/edit')
    await screen.findByRole('heading', { name: 'Edit record' })
    await expectNoViolations()
  })
})

describe('keyboard use', () => {
  it('has a skip link as the first focusable element', async () => {
    mockApi()
    renderAt('/')
    await userEvent.tab()
    expect(screen.getByRole('link', { name: 'Skip to content' })).toHaveFocus()
  })

  it('table scroll area can be reached and the sort buttons work from the keyboard', async () => {
    mockApi({ user: ADA, routes: { '/api/records': list([rec(1), rec(2)]) } })
    renderAt('/dashboard')
    await screen.findByText('Survey 1')
    const region = screen.getByRole('region', { name: 'Your records' })
    expect(region).toHaveAttribute('tabindex', '0')
    const sortTitle = within(region).getByRole('button', { name: /Title/ })
    sortTitle.focus()
    await userEvent.keyboard('{Enter}')
    expect(await screen.findByRole('columnheader', { name: /Title/ })).toHaveAttribute('aria-sort', 'ascending')
  })

  it('every form field has an accessible name and hints are linked', async () => {
    mockApi({ user: ADA })
    renderAt('/records/new')
    await screen.findByRole('heading', { name: 'Add record' })
    expect(screen.getByLabelText('Latitude')).toHaveAccessibleDescription(/Between -90 and 90/)
    await userEvent.type(screen.getByLabelText('Latitude'), 'abc')
    await userEvent.click(screen.getByRole('button', { name: 'Add record' }))
    const description = screen.getByLabelText('Latitude')
    expect(description).toHaveAccessibleDescription(/Between -90 and 90.*Enter a number/)
  })
})
