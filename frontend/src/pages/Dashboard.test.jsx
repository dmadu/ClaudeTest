import { screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { ADA, jsonResponse, mockApi, renderAt } from '../testUtils.jsx'

afterEach(() => vi.restoreAllMocks())

const record = (i, extra = {}) => ({
  id: i,
  title: `Survey ${i}`,
  site: `Site ${i}`,
  latitude: -30.5 - i,
  longitude: 140.25 + i,
  image_url: `/api/records/${i}/image`,
  created_at: '2025-01-01T00:00:00',
  updated_at: '2025-01-01T00:00:00',
  ...extra,
})

const listBody = (records, over = {}) => ({
  records,
  total: records.length,
  page: 1,
  page_size: 10,
  pages: records.length ? 1 : 0,
  ...over,
})

const recordsCalls = (spy) =>
  spy.mock.calls.map(([path]) => path).filter((p) => p.startsWith('/api/records'))

function setup(handler, path = '/dashboard') {
  const spy = mockApi({ user: ADA, routes: { '/api/records': (_init, url) => handler(new URLSearchParams(url.split('?')[1])) } })
  renderAt(path)
  return spy
}

describe('dashboard table', () => {
  it('shows the record count and a row per record', async () => {
    setup(() => jsonResponse(listBody([record(1), record(2)])))
    expect(await screen.findByText('You have 2 records.')).toBeInTheDocument()
    const rows = screen.getAllByRole('row')
    expect(rows).toHaveLength(3) // header + 2
    expect(within(rows[1]).getByText('Survey 1')).toBeInTheDocument()
    expect(within(rows[1]).getByText('-31.500000')).toBeInTheDocument()
    expect(within(rows[1]).getByRole('img', { name: 'Image for Survey 1' })).toHaveAttribute(
      'src',
      '/api/records/1/image',
    )
  })

  it('uses singular wording for one record', async () => {
    setup(() => jsonResponse(listBody([record(1)])))
    expect(await screen.findByText('You have 1 record.')).toBeInTheDocument()
  })

  it('has the expected columns', async () => {
    setup(() => jsonResponse(listBody([record(1)])))
    await screen.findByText('Survey 1')
    const headers = screen.getAllByRole('columnheader').map((h) => h.textContent.replace(/[▲▼↕]/g, '').trim())
    expect(headers).toEqual(['Title', 'Site', 'Latitude', 'Longitude', 'Image', 'Actions'])
  })

  it('shows an empty state', async () => {
    setup(() => jsonResponse(listBody([])))
    expect(await screen.findByText('You have no records yet.')).toBeInTheDocument()
    expect(screen.queryByRole('table')).not.toBeInTheDocument()
    expect(screen.queryByRole('navigation', { name: 'Pagination' })).not.toBeInTheDocument()
  })

  it('shows an error and retries', async () => {
    let calls = 0
    setup(() => (++calls === 1 ? jsonResponse({ message: 'Server exploded' }, 500) : jsonResponse(listBody([record(1)]))))
    expect(await screen.findByRole('alert')).toHaveTextContent('Server exploded')
    await userEvent.click(screen.getByRole('button', { name: 'Try again' }))
    expect(await screen.findByText('Survey 1')).toBeInTheDocument()
    expect(screen.queryByRole('alert')).not.toBeInTheDocument()
  })

  it('sends the user to login when the session has expired', async () => {
    setup(() => jsonResponse({ message: 'Authentication required.' }, 401))
    expect(await screen.findByRole('heading', { name: 'Login' })).toBeInTheDocument()
    expect(screen.getByRole('alert')).toHaveTextContent('Please sign in to continue.')
  })
})

describe('sorting', () => {
  const rows = () => listBody([record(1), record(2)])

  it('requests the default order first, with no sort column marked', async () => {
    const spy = setup(() => jsonResponse(rows()))
    await screen.findByText('Survey 1')
    expect(recordsCalls(spy)[0]).toBe('/api/records?page=1&page_size=10')
    expect(document.querySelector('[aria-sort]')).toBeNull()
  })

  it('sorts ascending, then descending, and shows the direction', async () => {
    const spy = setup(() => jsonResponse(rows()))
    await screen.findByText('Survey 1')

    await userEvent.click(screen.getByRole('button', { name: /Title/ }))
    await waitFor(() => expect(recordsCalls(spy).at(-1)).toContain('sort=title&order=asc'))
    expect(screen.getByRole('columnheader', { name: /Title/ })).toHaveAttribute('aria-sort', 'ascending')

    await userEvent.click(screen.getByRole('button', { name: /Title/ }))
    await waitFor(() => expect(recordsCalls(spy).at(-1)).toContain('sort=title&order=desc'))
    expect(screen.getByRole('columnheader', { name: /Title/ })).toHaveAttribute('aria-sort', 'descending')
  })

  it.each(['Site', 'Latitude', 'Longitude'])('can sort by %s', async (label) => {
    const spy = setup(() => jsonResponse(rows()))
    await screen.findByText('Survey 1')
    await userEvent.click(screen.getByRole('button', { name: new RegExp(label) }))
    await waitFor(() => expect(recordsCalls(spy).at(-1)).toContain(`sort=${label.toLowerCase()}&order=asc`))
  })

  it('starts on a new column in ascending order and goes back to page 1', async () => {
    const spy = setup(() => jsonResponse(listBody([record(1)], { page: 2, pages: 3, total: 21 })), '/dashboard?page=2&sort=title&order=desc')
    await screen.findByText('Survey 1')
    await userEvent.click(screen.getByRole('button', { name: /Site/ }))
    await waitFor(() => expect(recordsCalls(spy).at(-1)).toBe('/api/records?page=1&page_size=10&sort=site&order=asc'))
  })

  it('image has no sort button', async () => {
    setup(() => jsonResponse(rows()))
    await screen.findByText('Survey 1')
    expect(screen.queryByRole('button', { name: /Image/ })).not.toBeInTheDocument()
  })

  it('reads sort from the URL and ignores unknown values', async () => {
    const spy = setup(() => jsonResponse(rows()), '/dashboard?sort=password&order=weird&size=7&page=-3')
    await screen.findByText('Survey 1')
    expect(recordsCalls(spy)[0]).toBe('/api/records?page=1&page_size=10')
  })
})

describe('pagination', () => {
  const page = (n) =>
    jsonResponse(listBody([record(n)], { page: n, pages: 3, total: 25 }))

  it('shows the page position and moves between pages', async () => {
    const spy = setup((q) => page(Number(q.get('page'))))
    expect(await screen.findByText('Page 1 of 3')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Previous' })).toBeDisabled()

    await userEvent.click(screen.getByRole('button', { name: 'Next' }))
    expect(await screen.findByText('Page 2 of 3')).toBeInTheDocument()
    expect(recordsCalls(spy).at(-1)).toBe('/api/records?page=2&page_size=10')

    await userEvent.click(screen.getByRole('button', { name: 'Next' }))
    expect(await screen.findByText('Page 3 of 3')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Next' })).toBeDisabled()

    await userEvent.click(screen.getByRole('button', { name: 'Previous' }))
    expect(await screen.findByText('Page 2 of 3')).toBeInTheDocument()
  })

  it('keeps the sort when changing page', async () => {
    const spy = setup((q) => page(Number(q.get('page'))), '/dashboard?sort=site&order=desc')
    await screen.findByText('Page 1 of 3')
    await userEvent.click(screen.getByRole('button', { name: 'Next' }))
    await screen.findByText('Page 2 of 3')
    expect(recordsCalls(spy).at(-1)).toBe('/api/records?page=2&page_size=10&sort=site&order=desc')
  })

  it('changes the page size and returns to page 1', async () => {
    const spy = setup((q) => page(Number(q.get('page'))), '/dashboard?page=2')
    await screen.findByText('Page 2 of 3')
    await userEvent.selectOptions(screen.getByLabelText(/Rows per page/), '25')
    await waitFor(() => expect(recordsCalls(spy).at(-1)).toBe('/api/records?page=1&page_size=25'))
  })

  it('moves to the last page when the requested page is past the end', async () => {
    const spy = setup((q) => {
      const n = Number(q.get('page'))
      return n > 2 ? jsonResponse(listBody([], { page: n, pages: 2, total: 12 })) : page(n)
    }, '/dashboard?page=9')
    expect(await screen.findByText('Page 2 of 3')).toBeInTheDocument()
    expect(recordsCalls(spy).map((p) => p.match(/page=(\d+)/)[1])).toEqual(['9', '2'])
  })
})
