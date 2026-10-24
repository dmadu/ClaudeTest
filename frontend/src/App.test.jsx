import { screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { ADA, jsonResponse, mockApi, renderAt } from './testUtils.jsx'

afterEach(() => vi.restoreAllMocks())

const mainNav = () => screen.getByRole('navigation', { name: 'Main' })

describe('navigation (logged out)', () => {
  it('shows Home, About, Contact and Login', async () => {
    mockApi()
    renderAt('/about')
    const nav = mainNav()
    await within(nav).findByRole('link', { name: 'Login' })
    for (const label of ['Home', 'About', 'Contact', 'Login']) {
      expect(within(nav).getByRole('link', { name: label })).toBeInTheDocument()
    }
    expect(within(nav).queryByRole('link', { name: 'Dashboard' })).not.toBeInTheDocument()
  })

  it('Login starts the AAF flow', async () => {
    mockApi()
    renderAt('/')
    const link = await within(mainNav()).findByRole('link', { name: 'Login' })
    expect(link).toHaveAttribute('href', '/api/auth/login')
  })

  it('navigates between public pages', async () => {
    mockApi()
    renderAt('/')
    expect(screen.getByRole('heading', { name: 'Site Records' })).toBeInTheDocument()
    await userEvent.click(screen.getByRole('link', { name: 'About' }))
    expect(screen.getByRole('heading', { name: 'About' })).toBeInTheDocument()
    await userEvent.click(screen.getByRole('link', { name: 'Contact' }))
    expect(screen.getByRole('heading', { name: 'Contact' })).toBeInTheDocument()
  })
})

describe('navigation (logged in)', () => {
  it('replaces Login with the user name, Dashboard link and Logout', async () => {
    mockApi({ user: ADA })
    renderAt('/')
    const nav = mainNav()
    expect(await within(nav).findByText('Ada Lovelace')).toBeInTheDocument()
    expect(within(nav).getByRole('link', { name: 'Dashboard' })).toBeInTheDocument()
    expect(within(nav).getByRole('button', { name: 'Logout' })).toBeInTheDocument()
    expect(within(nav).queryByRole('link', { name: 'Login' })).not.toBeInTheDocument()
  })

  it('logout calls the API and returns to the logged-out menu', async () => {
    const fetchSpy = mockApi({ user: ADA })
    renderAt('/dashboard')
    await userEvent.click(await screen.findByRole('button', { name: 'Logout' }))
    expect(await within(mainNav()).findByRole('link', { name: 'Login' })).toBeInTheDocument()
    expect(fetchSpy).toHaveBeenCalledWith('/api/auth/logout', expect.objectContaining({ method: 'POST' }))
    expect(screen.getByRole('heading', { name: 'Site Records' })).toBeInTheDocument()
  })

  it('stays logged in and shows an error if logout fails', async () => {
    mockApi({ user: ADA, routes: { '/api/auth/logout': () => jsonResponse({ message: 'Boom' }, 500) } })
    renderAt('/')
    await userEvent.click(await screen.findByRole('button', { name: 'Logout' }))
    expect(await screen.findByRole('alert')).toHaveTextContent('Boom')
    expect(screen.getByRole('button', { name: 'Logout' })).toBeInTheDocument()
  })

  it('home links to the dashboard instead of login', async () => {
    mockApi({ user: ADA })
    renderAt('/')
    expect(await screen.findByRole('link', { name: 'Go to your dashboard' })).toBeInTheDocument()
  })
})

describe('protected dashboard', () => {
  it('redirects visitors to the login page with a message', async () => {
    mockApi()
    renderAt('/dashboard')
    expect(await screen.findByRole('heading', { name: 'Login' })).toBeInTheDocument()
    expect(screen.getByRole('alert')).toHaveTextContent('Please sign in to continue.')
  })

  it('shows the dashboard to a signed-in user', async () => {
    mockApi({ user: ADA })
    renderAt('/dashboard')
    expect(await screen.findByRole('heading', { name: 'Dashboard' })).toBeInTheDocument()
    expect(screen.getByText(/Welcome, Ada Lovelace/)).toBeInTheDocument()
  })

  it('treats a failed session check as logged out', async () => {
    vi.spyOn(globalThis, 'fetch').mockRejectedValue(new TypeError('network'))
    renderAt('/dashboard')
    expect(await screen.findByRole('heading', { name: 'Login' })).toBeInTheDocument()
  })
})

describe('login page', () => {
  it('has a button that starts AAF sign-in', async () => {
    mockApi()
    renderAt('/login')
    const link = await screen.findByRole('link', { name: 'Sign in with AAF' })
    expect(link).toHaveAttribute('href', '/api/auth/login')
    expect(screen.queryByRole('alert')).not.toBeInTheDocument()
  })

  it.each([
    ['invalid', 'We could not verify your sign-in. Please try again.'],
    ['unavailable', 'Sign-in is not available right now. Please try again later.'],
    ['ratelimited', 'Too many sign-in attempts. Please wait a minute and try again.'],
    ['something-else', 'Sign-in failed. Please try again.'],
  ])('shows a message for error=%s', async (code, message) => {
    mockApi()
    renderAt(`/login?error=${code}`)
    expect(await screen.findByRole('alert')).toHaveTextContent(message)
  })

  it('sends an already signed-in user to the dashboard', async () => {
    mockApi({ user: ADA })
    renderAt('/login')
    expect(await screen.findByRole('heading', { name: 'Dashboard' })).toBeInTheDocument()
  })
})

describe('contact form', () => {
  const fill = async () => {
    await userEvent.type(screen.getByLabelText('Name'), 'Ada')
    await userEvent.type(screen.getByLabelText('Email'), 'ada@example.com')
    await userEvent.type(screen.getByLabelText('Message'), 'Hello')
  }

  it('shows field errors and does not call the API when empty', async () => {
    const fetchSpy = mockApi()
    renderAt('/contact')
    await userEvent.click(screen.getByRole('button', { name: 'Send message' }))
    expect(screen.getAllByText('This field is required.')).toHaveLength(3)
    expect(fetchSpy).not.toHaveBeenCalledWith('/api/contact', expect.anything())
  })

  it('rejects an invalid email', async () => {
    mockApi()
    renderAt('/contact')
    await userEvent.type(screen.getByLabelText('Name'), 'Ada')
    await userEvent.type(screen.getByLabelText('Email'), 'nope')
    await userEvent.type(screen.getByLabelText('Message'), 'Hi')
    await userEvent.click(screen.getByRole('button', { name: 'Send message' }))
    expect(screen.getByText('Enter a valid email address.')).toBeInTheDocument()
  })

  it('submits and shows a success message', async () => {
    const fetchSpy = mockApi({ routes: { '/api/contact': () => jsonResponse({ message: 'ok' }, 201) } })
    renderAt('/contact')
    await fill()
    await userEvent.click(screen.getByRole('button', { name: 'Send message' }))

    await waitFor(() => expect(screen.getByRole('status')).toHaveTextContent('Thank you'))
    const [, init] = fetchSpy.mock.calls.find(([path]) => path === '/api/contact')
    expect(JSON.parse(init.body)).toEqual({ name: 'Ada', email: 'ada@example.com', message: 'Hello' })
    expect(screen.getByLabelText('Name')).toHaveValue('')
  })

  it('shows server-side field errors', async () => {
    mockApi({
      routes: {
        '/api/contact': () => jsonResponse({ errors: { email: 'Enter a valid email address.' } }, 400),
      },
    })
    renderAt('/contact')
    await fill()
    await userEvent.click(screen.getByRole('button', { name: 'Send message' }))
    expect(await screen.findByText('Enter a valid email address.')).toBeInTheDocument()
    expect(screen.getByRole('alert')).toBeInTheDocument()
  })

  it('shows a message when the server is unreachable', async () => {
    mockApi({
      routes: {
        '/api/contact': () => {
          throw new TypeError('network')
        },
      },
    })
    renderAt('/contact')
    await fill()
    await userEvent.click(screen.getByRole('button', { name: 'Send message' }))
    expect(await screen.findByRole('alert')).toHaveTextContent('Could not reach the server')
  })
})
