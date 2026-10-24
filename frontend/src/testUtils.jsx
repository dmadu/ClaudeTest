import { render } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { vi } from 'vitest'
import App from './App.jsx'

export const jsonResponse = (body, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } })

/** Mocks fetch. `routes` maps a path to a handler returning a Response. */
export const CSRF = 'csrf-token-123'

export function mockApi({ user = null, routes = {} } = {}) {
  return vi.spyOn(globalThis, 'fetch').mockImplementation(async (path, init) => {
    const handler = routes[path] ?? routes[path.split('?')[0]]
    if (handler) return handler(init, path)
    if (path === '/api/auth/me') return jsonResponse({ user, csrf_token: user ? CSRF : null })
    if (path === '/api/auth/logout') return new Response(null, { status: 204 })
    throw new Error(`Unexpected request to ${path}`)
  })
}

export const renderAt = (path) =>
  render(
    <MemoryRouter initialEntries={[path]}>
      <App />
    </MemoryRouter>,
  )

export const ADA = { id: 1, name: 'Ada Lovelace', email: 'ada@uni.example.edu' }
