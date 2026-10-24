import { screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { validateRecord } from '../lib/validateRecord.js'
import { ADA, jsonResponse, mockApi, renderAt } from '../testUtils.jsx'

afterEach(() => vi.restoreAllMocks())

const png = (name = 'site.png', size = 100) => new File([new Uint8Array(size)], name, { type: 'image/png' })

const SAVED = {
  id: 7,
  title: 'Lake survey',
  site: 'Lake Burley Griffin',
  latitude: -35.2809,
  longitude: 149.13,
  image_url: '/api/records/7/image?v=abc',
}

const emptyList = () => jsonResponse({ records: [], total: 0, page: 1, page_size: 10, pages: 0 })

async function fillText(over = {}) {
  const v = { title: 'Lake survey', site: 'Lake Burley Griffin', latitude: '-35.2809', longitude: '149.13', ...over }
  for (const [label, value] of [
    ['Title', v.title],
    ['Site', v.site],
    ['Latitude', v.latitude],
    ['Longitude', v.longitude],
  ]) {
    await userEvent.type(screen.getByLabelText(label), value)
  }
}

const submit = (name) => userEvent.click(screen.getByRole('button', { name }))
const sentTo = (spy, path, method) => spy.mock.calls.find(([p, init]) => p === path && init?.method === method)
const openForm = async (path = '/records/new', heading = 'Add record') => {
  renderAt(path)
  await screen.findByRole('heading', { name: heading })
}

describe('validateRecord', () => {
  const good = { title: 'a', site: 'b', latitude: '-35.2', longitude: '149' }

  it('accepts a valid record', () => {
    expect(validateRecord(good, png(), { imageRequired: true })).toEqual({})
  })

  it.each([
    ['latitude', '91'],
    ['latitude', '-90.5'],
    ['latitude', 'abc'],
    ['latitude', '1e2'],
    ['latitude', ''],
    ['longitude', '180.5'],
    ['longitude', '-181'],
    ['title', '   '],
    ['title', 'x'.repeat(201)],
    ['site', ''],
  ])('rejects %s = %j', (field, value) => {
    expect(validateRecord({ ...good, [field]: value }, png(), { imageRequired: true })[field]).toBeTruthy()
  })

  it('accepts the limits', () => {
    const edge = { ...good, latitude: '90', longitude: '-180', title: 'x'.repeat(200) }
    expect(validateRecord(edge, png(), { imageRequired: true })).toEqual({})
  })

  it('requires an image only when asked', () => {
    expect(validateRecord(good, null, { imageRequired: true }).image).toBeTruthy()
    expect(validateRecord(good, null, { imageRequired: false })).toEqual({})
  })

  it.each([
    [new File(['x'], 'a.gif', { type: 'image/gif' }), 'JPEG or PNG'],
    [new File(['x'], 'a.svg', { type: 'image/svg+xml' }), 'JPEG or PNG'],
    [new File([], 'a.png', { type: 'image/png' }), 'empty'],
    [new File([new Uint8Array(5 * 1024 * 1024 + 1)], 'a.png', { type: 'image/png' }), '5 MB'],
  ])('rejects a bad image (%#)', (file, text) => {
    expect(validateRecord(good, file, { imageRequired: true }).image).toContain(text)
  })

  it('accepts a JPEG and an image of exactly 5 MB', () => {
    const jpeg = new File(['x'], 'a.jpg', { type: 'image/jpeg' })
    const exact = new File([new Uint8Array(5 * 1024 * 1024)], 'a.png', { type: 'image/png' })
    expect(validateRecord(good, jpeg, { imageRequired: true })).toEqual({})
    expect(validateRecord(good, exact, { imageRequired: true })).toEqual({})
  })
})

describe('add record', () => {
  it('shows the form fields', async () => {
    mockApi({ user: ADA })
    await openForm()
    for (const label of ['Title', 'Site', 'Latitude', 'Longitude', 'Image']) {
      expect(screen.getByLabelText(label)).toBeInTheDocument()
    }
  })

  it('shows an error under every empty field and does not call the API', async () => {
    const spy = mockApi({ user: ADA })
    await openForm()
    await submit('Add record')
    expect(screen.getAllByText('This field is required.')).toHaveLength(5)
    expect(screen.getByLabelText('Title')).toHaveFocus()
    expect(screen.getByLabelText('Title')).toHaveAttribute('aria-invalid', 'true')
    expect(sentTo(spy, '/api/records', 'POST')).toBeUndefined()
  })

  it('rejects an out-of-range latitude', async () => {
    mockApi({ user: ADA })
    await openForm()
    await fillText({ latitude: '95' })
    await userEvent.upload(screen.getByLabelText('Image'), png())
    await submit('Add record')
    expect(screen.getByText('Must be between -90 and 90.')).toBeInTheDocument()
  })

  it('rejects a file that is not JPEG or PNG', async () => {
    mockApi({ user: ADA })
    await openForm()
    await fillText()
    const gif = new File(['x'], 'a.gif', { type: 'image/gif' })
    await userEvent.upload(screen.getByLabelText('Image'), gif, { applyAccept: false })
    await submit('Add record')
    expect(screen.getByText('Image must be a JPEG or PNG file.')).toBeInTheDocument()
  })

  it('submits the form data, goes back to the dashboard and confirms', async () => {
    const spy = mockApi({
      user: ADA,
      routes: {
        '/api/records': (init) => (init?.method === 'POST' ? jsonResponse({ record: SAVED }, 201) : emptyList()),
      },
    })
    await openForm()
    await fillText()
    await userEvent.type(screen.getByLabelText('Title'), '   ')
    await userEvent.upload(screen.getByLabelText('Image'), png('lake.png'))
    await submit('Add record')

    expect(await screen.findByRole('heading', { name: 'Dashboard' })).toBeInTheDocument()
    expect(screen.getByRole('status')).toHaveTextContent('Record added.')

    const [, init] = sentTo(spy, '/api/records', 'POST')
    expect(init.body).toBeInstanceOf(FormData)
    expect(init.body.get('title')).toBe('Lake survey')
    expect(init.body.get('site')).toBe('Lake Burley Griffin')
    expect(init.body.get('latitude')).toBe('-35.2809')
    expect(init.body.get('longitude')).toBe('149.13')
    expect(init.body.get('image').name).toBe('lake.png')
    // the browser must set the multipart boundary itself
    expect(init.headers?.['Content-Type']).toBeUndefined()
  })

  it('shows server-side field errors and stays on the form', async () => {
    mockApi({
      user: ADA,
      routes: { '/api/records': () => jsonResponse({ errors: { image: 'Image must be a JPEG or PNG file.' } }, 400) },
    })
    await openForm()
    await fillText()
    await userEvent.upload(screen.getByLabelText('Image'), png())
    await submit('Add record')
    expect(await screen.findByText('Image must be a JPEG or PNG file.')).toBeInTheDocument()
    expect(screen.getByRole('alert')).toHaveTextContent('Please correct the highlighted fields.')
    expect(screen.getByLabelText('Title')).toHaveValue('Lake survey')
    expect(screen.getByRole('button', { name: 'Add record' })).toBeEnabled()
  })

  it('shows a message when the server cannot be reached', async () => {
    mockApi({
      user: ADA,
      routes: {
        '/api/records': () => {
          throw new TypeError('network')
        },
      },
    })
    await openForm()
    await fillText()
    await userEvent.upload(screen.getByLabelText('Image'), png())
    await submit('Add record')
    expect(await screen.findByRole('alert')).toHaveTextContent('Could not reach the server')
  })

  it('cancel returns to the dashboard without saving', async () => {
    const spy = mockApi({ user: ADA, routes: { '/api/records': () => emptyList() } })
    await openForm()
    await userEvent.click(screen.getByRole('link', { name: 'Cancel' }))
    expect(await screen.findByRole('heading', { name: 'Dashboard' })).toBeInTheDocument()
    expect(sentTo(spy, '/api/records', 'POST')).toBeUndefined()
  })

  it('redirects a visitor to login', async () => {
    mockApi()
    renderAt('/records/new')
    expect(await screen.findByRole('heading', { name: 'Login' })).toBeInTheDocument()
  })
})

describe('edit record', () => {
  const editRoutes = (extra = {}) => ({
    '/api/records/7': () => jsonResponse({ record: SAVED }),
    '/api/records': () => emptyList(),
    ...extra,
  })

  it('loads the record into the form and shows the current image', async () => {
    mockApi({ user: ADA, routes: editRoutes() })
    await openForm('/records/7/edit', 'Edit record')
    expect(screen.getByLabelText('Title')).toHaveValue('Lake survey')
    expect(screen.getByLabelText('Site')).toHaveValue('Lake Burley Griffin')
    expect(screen.getByLabelText('Latitude')).toHaveValue('-35.2809')
    expect(screen.getByLabelText('Longitude')).toHaveValue('149.13')
    expect(screen.getByRole('img', { name: 'Current image for Lake survey' })).toHaveAttribute('src', SAVED.image_url)
  })

  it('saves changes without a new image, which keeps the existing one', async () => {
    const spy = mockApi({ user: ADA, routes: editRoutes() })
    await openForm('/records/7/edit', 'Edit record')
    await userEvent.clear(screen.getByLabelText('Title'))
    await userEvent.type(screen.getByLabelText('Title'), 'Renamed')
    await submit('Save changes')

    expect(await screen.findByRole('status')).toHaveTextContent('Record updated.')
    const [, init] = sentTo(spy, '/api/records/7', 'PUT')
    expect(init.body.get('title')).toBe('Renamed')
    expect(init.body.has('image')).toBe(false)
  })

  it('sends a replacement image when one is chosen', async () => {
    const spy = mockApi({ user: ADA, routes: editRoutes() })
    await openForm('/records/7/edit', 'Edit record')
    await userEvent.upload(screen.getByLabelText('Image'), png('new.png'))
    await submit('Save changes')
    await screen.findByRole('status')
    expect(sentTo(spy, '/api/records/7', 'PUT')[1].body.get('image').name).toBe('new.png')
  })

  it('applies the same validation as add', async () => {
    const spy = mockApi({ user: ADA, routes: editRoutes() })
    await openForm('/records/7/edit', 'Edit record')
    await userEvent.clear(screen.getByLabelText('Longitude'))
    await userEvent.type(screen.getByLabelText('Longitude'), '500')
    await submit('Save changes')
    expect(screen.getByText('Must be between -180 and 180.')).toBeInTheDocument()
    expect(sentTo(spy, '/api/records/7', 'PUT')).toBeUndefined()
  })

  it('says so when the record does not exist', async () => {
    mockApi({ user: ADA, routes: { '/api/records/99': () => jsonResponse({ message: 'Not found' }, 404) } })
    renderAt('/records/99/edit')
    expect(await screen.findByRole('alert')).toHaveTextContent('This record could not be found.')
    expect(screen.getByRole('link', { name: 'Back to dashboard' })).toBeInTheDocument()
  })

  it('sends the user to login if the session has expired', async () => {
    mockApi({ user: ADA, routes: { '/api/records/7': () => jsonResponse({ message: 'Authentication required.' }, 401) } })
    renderAt('/records/7/edit')
    expect(await screen.findByRole('heading', { name: 'Login' })).toBeInTheDocument()
  })
})
