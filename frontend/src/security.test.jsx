import { screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { ADA, CSRF, jsonResponse, mockApi, renderAt } from './testUtils.jsx'

afterEach(() => vi.restoreAllMocks())

const rec = {
  id: 1, title: 'Survey 1', site: 'Site 1', latitude: -30, longitude: 140,
  image_url: '/api/records/1/image?v=x', created_at: '2025-01-01T00:00:00', updated_at: '2025-01-01T00:00:00',
}
const list = () => jsonResponse({ records: [rec], total: 1, page: 1, page_size: 10, pages: 1 })
const callsTo = (spy, path) => spy.mock.calls.filter(([p]) => p === path)

describe('CSRF token', () => {
  it('is sent on state-changing requests by a signed-in user', async () => {
    const spy = mockApi({
      user: ADA,
      routes: { '/api/records': list, '/api/records/1': () => new Response(null, { status: 204 }) },
    })
    renderAt('/dashboard')
    await userEvent.click(await screen.findByRole('button', { name: 'Delete Survey 1' }))
    await userEvent.click(within(screen.getByRole('dialog')).getByRole('button', { name: 'Delete' }))
    await screen.findByRole('status')
    const [, init] = callsTo(spy, '/api/records/1')[0]
    expect(init.headers['X-CSRF-Token']).toBe(CSRF)
  })

  it('is not sent on reads', async () => {
    const spy = mockApi({ user: ADA, routes: { '/api/records': list } })
    renderAt('/dashboard')
    await screen.findByText('Survey 1')
    for (const [, init] of callsTo(spy, '/api/records')) {
      expect(init?.headers?.['X-CSRF-Token']).toBeUndefined()
    }
  })

  it('is sent when logging out, and not afterwards', async () => {
    const spy = mockApi({
      user: ADA,
      routes: { '/api/contact': () => jsonResponse({ message: 'ok' }, 201) },
    })
    renderAt('/')
    await userEvent.click(await screen.findByRole('button', { name: 'Logout' }))
    await within(screen.getByRole('navigation', { name: 'Main' })).findByRole('link', { name: 'Login' })
    expect(callsTo(spy, '/api/auth/logout')[0][1].headers['X-CSRF-Token']).toBe(CSRF)

    await userEvent.click(screen.getByRole('link', { name: 'Contact' }))
    await userEvent.type(screen.getByLabelText('Name'), 'Ada')
    await userEvent.type(screen.getByLabelText('Email'), 'ada@example.com')
    await userEvent.type(screen.getByLabelText('Message'), 'Hello')
    await userEvent.click(screen.getByRole('button', { name: 'Send message' }))
    await screen.findByText('Thank you, your message has been sent.')
    expect(callsTo(spy, '/api/contact')[0][1].headers['X-CSRF-Token']).toBeUndefined()
  })

  it('is not held by a visitor', async () => {
    const spy = mockApi({ routes: { '/api/contact': () => jsonResponse({ message: 'ok' }, 201) } })
    renderAt('/contact')
    await userEvent.type(screen.getByLabelText('Name'), 'Ada')
    await userEvent.type(screen.getByLabelText('Email'), 'ada@example.com')
    await userEvent.type(screen.getByLabelText('Message'), 'Hello')
    await userEvent.click(screen.getByRole('button', { name: 'Send message' }))
    await screen.findByRole('status')
    expect(callsTo(spy, '/api/contact')[0][1].headers['X-CSRF-Token']).toBeUndefined()
  })

  it('shows a plain message when the server refuses the token', async () => {
    mockApi({
      user: ADA,
      routes: {
        '/api/records': list,
        '/api/records/1': () => jsonResponse({ message: 'Invalid or missing CSRF token.' }, 403),
      },
    })
    renderAt('/dashboard')
    await userEvent.click(await screen.findByRole('button', { name: 'Delete Survey 1' }))
    await userEvent.click(within(screen.getByRole('dialog')).getByRole('button', { name: 'Delete' }))
    const alert = await within(screen.getByRole('dialog')).findByRole('alert')
    expect(alert).toHaveTextContent('Your session is out of date. Please reload the page and try again.')
    expect(alert).not.toHaveTextContent('CSRF')
  })

  it('shows a rate-limit message from the server on the contact form', async () => {
    mockApi({
      routes: { '/api/contact': () => jsonResponse({ message: '5 per 1 minute' }, 429) },
    })
    renderAt('/contact')
    await userEvent.type(screen.getByLabelText('Name'), 'Ada')
    await userEvent.type(screen.getByLabelText('Email'), 'ada@example.com')
    await userEvent.type(screen.getByLabelText('Message'), 'Hello')
    await userEvent.click(screen.getByRole('button', { name: 'Send message' }))
    expect(await screen.findByRole('alert')).toHaveTextContent('5 per 1 minute')
  })
})

describe('page titles and focus', () => {
  it.each([
    ['/', 'Home'],
    ['/about', 'About'],
    ['/contact', 'Contact'],
    ['/login', 'Login'],
    ['/nowhere', 'Page not found'],
  ])('%s has the title %s', async (path, title) => {
    mockApi()
    renderAt(path)
    await screen.findByRole('heading', { level: 1 })
    expect(document.title).toBe(`${title} – Site Records`)
  })

  it('titles the signed-in pages', async () => {
    mockApi({ user: ADA, routes: { '/api/records': list } })
    renderAt('/dashboard')
    await screen.findByText('Survey 1')
    expect(document.title).toBe('Dashboard – Site Records')
    await userEvent.click(screen.getByRole('link', { name: 'Add record' }))
    await screen.findByRole('heading', { name: 'Add record' })
    expect(document.title).toBe('Add record – Site Records')
  })

  it('does not move focus on the first page load', async () => {
    mockApi()
    renderAt('/about')
    await screen.findByRole('heading', { name: 'About' })
    expect(screen.getByRole('heading', { name: 'About' })).not.toHaveFocus()
  })

  it('moves focus to the new page heading after navigating', async () => {
    mockApi()
    renderAt('/')
    await userEvent.click(screen.getByRole('link', { name: 'About' }))
    expect(await screen.findByRole('heading', { name: 'About' })).toHaveFocus()
  })

  it('waits for an edit page to load before focusing its heading', async () => {
    mockApi({
      user: ADA,
      routes: {
        '/api/records': list,
        '/api/records/1': () => jsonResponse({ record: rec }),
      },
    })
    renderAt('/dashboard')
    await userEvent.click(await screen.findByRole('link', { name: 'Edit Survey 1' }))
    expect(await screen.findByRole('heading', { name: 'Edit record' })).toHaveFocus()
    expect(document.title).toBe('Edit record – Site Records')
  })
})
