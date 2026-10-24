import { screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { ADA, jsonResponse, mockApi, renderAt } from '../testUtils.jsx'

afterEach(() => vi.restoreAllMocks())

const rec = (i) => ({
  id: i, title: `Survey ${i}`, site: `Site ${i}`, latitude: -30, longitude: 140,
  image_url: `/api/records/${i}/image?v=x`, created_at: '2025-01-01T00:00:00', updated_at: '2025-01-01T00:00:00',
})
const list = (records) => jsonResponse({ records, total: records.length, page: 1, page_size: 10, pages: records.length ? 1 : 0 })

function setup({ records = [rec(1), rec(2)], onDelete } = {}) {
  let current = records
  const spy = mockApi({
    user: ADA,
    routes: {
      '/api/records': () => list(current),
      ...Object.fromEntries(
        records.map((r) => [
          `/api/records/${r.id}`,
          (init) => {
            if (init?.method !== 'DELETE') throw new Error('unexpected')
            const res = onDelete ? onDelete(r) : new Response(null, { status: 204 })
            if (res.ok) current = current.filter((x) => x.id !== r.id)
            return res
          },
        ]),
      ),
    },
  })
  renderAt('/dashboard')
  return spy
}

const deletes = (spy) => spy.mock.calls.filter(([, init]) => init?.method === 'DELETE')

describe('dashboard add and edit links', () => {
  it('has an Add record button that opens the form', async () => {
    setup()
    const add = await screen.findByRole('link', { name: 'Add record' })
    expect(add).toHaveAttribute('href', '/records/new')
    await userEvent.click(add)
    expect(await screen.findByRole('heading', { name: 'Add record' })).toBeInTheDocument()
  })

  it('has the Add button when there are no records, and the empty state points to it', async () => {
    setup({ records: [] })
    expect(await screen.findByText('You have no records yet.')).toBeInTheDocument()
    expect(screen.getByRole('link', { name: 'Add record' })).toBeInTheDocument()
    expect(screen.getByText(/button to create your first record/)).toBeInTheDocument()
  })

  it('each row has an Edit link to that record', async () => {
    setup()
    const link = await screen.findByRole('link', { name: 'Edit Survey 2' })
    expect(link).toHaveAttribute('href', '/records/2/edit')
  })
})

describe('delete', () => {
  it('asks for confirmation and names the record', async () => {
    const spy = setup()
    await userEvent.click(await screen.findByRole('button', { name: 'Delete Survey 1' }))
    const dialog = screen.getByRole('dialog', { name: 'Delete record?' })
    expect(within(dialog).getByText('Survey 1')).toBeInTheDocument()
    expect(within(dialog).getByRole('button', { name: 'Cancel' })).toHaveFocus()
    expect(deletes(spy)).toHaveLength(0)
  })

  it('cancel closes the dialog and deletes nothing', async () => {
    const spy = setup()
    const trigger = await screen.findByRole('button', { name: 'Delete Survey 1' })
    await userEvent.click(trigger)
    await userEvent.click(screen.getByRole('button', { name: 'Cancel' }))
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
    expect(deletes(spy)).toHaveLength(0)
    expect(trigger).toHaveFocus()
  })

  it('Escape closes the dialog', async () => {
    setup()
    await userEvent.click(await screen.findByRole('button', { name: 'Delete Survey 1' }))
    await userEvent.keyboard('{Escape}')
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
  })

  it('keeps Tab focus inside the dialog', async () => {
    setup()
    await userEvent.click(await screen.findByRole('button', { name: 'Delete Survey 1' }))
    const dialog = screen.getByRole('dialog')
    const confirm = within(dialog).getByRole('button', { name: 'Delete' })
    const cancel = within(dialog).getByRole('button', { name: 'Cancel' })
    expect(cancel).toHaveFocus()
    await userEvent.tab()
    expect(confirm).toHaveFocus()
    await userEvent.tab()
    expect(cancel).toHaveFocus()
    await userEvent.tab({ shift: true })
    expect(confirm).toHaveFocus()
  })

  it('confirming deletes, refreshes the table and shows a message', async () => {
    const spy = setup()
    await userEvent.click(await screen.findByRole('button', { name: 'Delete Survey 1' }))
    await userEvent.click(within(screen.getByRole('dialog')).getByRole('button', { name: 'Delete' }))

    expect(await screen.findByRole('status')).toHaveTextContent('Record deleted.')
    await waitFor(() => expect(screen.queryByText('Survey 1')).not.toBeInTheDocument())
    expect(screen.getByText('Survey 2')).toBeInTheDocument()
    expect(screen.getByText('You have 1 record.')).toBeInTheDocument()
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
    expect(deletes(spy).map(([p]) => p)).toEqual(['/api/records/1'])
  })

  it('shows the empty state after deleting the last record', async () => {
    setup({ records: [rec(1)] })
    await userEvent.click(await screen.findByRole('button', { name: 'Delete Survey 1' }))
    await userEvent.click(within(screen.getByRole('dialog')).getByRole('button', { name: 'Delete' }))
    expect(await screen.findByText('You have no records yet.')).toBeInTheDocument()
  })

  it('keeps the dialog open with an error when the delete fails', async () => {
    setup({ onDelete: () => jsonResponse({ message: 'Server exploded' }, 500) })
    await userEvent.click(await screen.findByRole('button', { name: 'Delete Survey 1' }))
    await userEvent.click(within(screen.getByRole('dialog')).getByRole('button', { name: 'Delete' }))
    expect(await within(screen.getByRole('dialog')).findByRole('alert')).toHaveTextContent('Server exploded')
    expect(within(screen.getByRole('table')).getByText('Survey 1')).toBeInTheDocument()
    expect(within(screen.getByRole('dialog')).getByRole('button', { name: 'Delete' })).toBeEnabled()
  })

  it('refreshes the list if the record was already deleted elsewhere', async () => {
    setup({ onDelete: () => jsonResponse({ message: 'Not found' }, 404) })
    await userEvent.click(await screen.findByRole('button', { name: 'Delete Survey 1' }))
    await userEvent.click(within(screen.getByRole('dialog')).getByRole('button', { name: 'Delete' }))
    expect(await screen.findByRole('status')).toHaveTextContent('already deleted')
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
  })

  it('sends the user to login if the session expired during delete', async () => {
    setup({ onDelete: () => jsonResponse({ message: 'Authentication required.' }, 401) })
    await userEvent.click(await screen.findByRole('button', { name: 'Delete Survey 1' }))
    await userEvent.click(within(screen.getByRole('dialog')).getByRole('button', { name: 'Delete' }))
    expect(await screen.findByRole('heading', { name: 'Login' })).toBeInTheDocument()
  })
})
