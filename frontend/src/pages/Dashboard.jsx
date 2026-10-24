import { useEffect, useState } from 'react'
import { Link, useLocation, useNavigate, useSearchParams } from 'react-router-dom'
import { del, getJson } from '../api/client.js'
import { useAuth } from '../auth/AuthContext.jsx'
import ConfirmDialog from '../components/ConfirmDialog.jsx'
import usePageTitle from '../lib/usePageTitle.js'

export const PAGE_SIZES = [10, 25, 50, 100]
const SORTABLE = ['title', 'site', 'latitude', 'longitude']
const COLUMNS = [
  { key: 'title', label: 'Title', sortable: true },
  { key: 'site', label: 'Site', sortable: true },
  { key: 'latitude', label: 'Latitude', sortable: true, numeric: true },
  { key: 'longitude', label: 'Longitude', sortable: true, numeric: true },
  { key: 'image', label: 'Image' },
  { key: 'actions', label: 'Actions' },
]

function readParams(params) {
  const page = Number.parseInt(params.get('page'), 10)
  const size = Number.parseInt(params.get('size'), 10)
  const sort = params.get('sort')
  return {
    page: page >= 1 ? page : 1,
    size: PAGE_SIZES.includes(size) ? size : PAGE_SIZES[0],
    sort: SORTABLE.includes(sort) ? sort : null,
    order: params.get('order') === 'desc' ? 'desc' : 'asc',
  }
}

export default function Dashboard() {
  const { user, expireSession } = useAuth()
  usePageTitle('Dashboard')
  const [params, setParams] = useSearchParams()
  const navigate = useNavigate()
  const location = useLocation()
  const { page, size, sort, order } = readParams(params)

  // A message passed by the form page after a save, shown once.
  const [flash, setFlash] = useState(location.state?.flash || '')
  useEffect(() => {
    if (location.state?.flash) navigate(`${location.pathname}${location.search}`, { replace: true, state: null })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const [toDelete, setToDelete] = useState(null)
  const [deleting, setDeleting] = useState(false)
  const [deleteError, setDeleteError] = useState('')

  const [attempt, setAttempt] = useState(0)
  // The latest answer, tagged with the request it answers. "Loading" is simply "the answer on
  // screen is for an older request", so the old table stays visible while a new one is fetched.
  const requestKey = `${page}:${size}:${sort}:${order}:${attempt}`
  const [result, setResult] = useState({ key: null, data: null, error: '' })
  const { data } = result
  const status = result.key !== requestKey ? 'loading' : result.error ? 'error' : 'ready'
  const error = result.error

  const update = (changes, { replace = false } = {}) => {
    const next = { page, size, sort, order, ...changes }
    const query = new URLSearchParams()
    if (next.page > 1) query.set('page', next.page)
    if (next.size !== PAGE_SIZES[0]) query.set('size', next.size)
    if (next.sort) {
      query.set('sort', next.sort)
      query.set('order', next.order)
    }
    setParams(query, { replace })
  }

  useEffect(() => {
    let cancelled = false
    const query = new URLSearchParams({ page, page_size: size })
    if (sort) {
      query.set('sort', sort)
      query.set('order', order)
    }
    getJson(`/api/records?${query}`)
      .then((body) => {
        if (cancelled) return
        if (body.pages > 0 && page > body.pages) {
          // The list shrank (or the URL was edited): go to the last page that exists.
          update({ page: body.pages }, { replace: true })
          return
        }
        setResult({ key: requestKey, data: body, error: '' })
      })
      .catch((err) => {
        if (cancelled) return
        if (err.status === 401) {
          expireSession()
          navigate('/login?error=required', { replace: true })
          return
        }
        setResult((previous) => ({ key: requestKey, data: previous.data, error: err.message }))
      })
    return () => {
      cancelled = true
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [requestKey])

  const onSort = (key) => {
    const nextOrder = sort === key && order === 'asc' ? 'desc' : 'asc'
    update({ sort: key, order: nextOrder, page: 1 })
  }

  const closeDialog = () => {
    setToDelete(null)
    setDeleteError('')
  }

  const confirmDelete = async () => {
    setDeleting(true)
    setDeleteError('')
    try {
      await del(`/api/records/${toDelete.id}`)
      closeDialog()
      setFlash('Record deleted.')
      setAttempt((a) => a + 1)
    } catch (err) {
      if (err.status === 401) {
        expireSession()
        navigate('/login?error=required', { replace: true })
      } else if (err.status === 404) {
        // Already gone (for example deleted in another tab): just refresh the list.
        closeDialog()
        setFlash('That record was already deleted.')
        setAttempt((a) => a + 1)
      } else {
        setDeleteError(err.message)
      }
    } finally {
      setDeleting(false)
    }
  }

  const total = data?.total
  const heading = user.name || user.email

  return (
    <section>
      <div className="page-header">
        <h1>Dashboard</h1>
        <Link className="button" to="/records/new">Add record</Link>
      </div>
      <p>Welcome, {heading}.</p>

      {flash && (
        <p className="notice success" role="status">{flash}</p>
      )}

      {status === 'error' && (
        <div className="notice danger" role="alert">
          {error}{' '}
          <button type="button" className="link-button" onClick={() => setAttempt((a) => a + 1)}>
            Try again
          </button>
        </div>
      )}

      {data && (
        <p aria-live="polite" className="record-count">
          {total === 0 ? 'You have no records yet.' : `You have ${total} ${total === 1 ? 'record' : 'records'}.`}
        </p>
      )}

      {status === 'loading' && !data && <p role="status">Loading…</p>}

      {data && total === 0 && (
        <p className="empty">
          Use the <strong>Add record</strong> button to create your first record.
        </p>
      )}

      {data && total > 0 && (
        <>
          <div
            className="table-wrap"
            role="region"
            aria-label="Your records"
            tabIndex={0}
            aria-busy={status === 'loading'}
          >
            <table className={status === 'loading' ? 'loading' : undefined}>
              <caption className="visually-hidden">Your records</caption>
              <thead>
                <tr>
                  {COLUMNS.map((col) => {
                    const active = sort === col.key
                    return (
                      <th
                        key={col.key}
                        scope="col"
                        className={col.numeric ? 'num' : undefined}
                        aria-sort={active ? (order === 'asc' ? 'ascending' : 'descending') : undefined}
                      >
                        {col.sortable ? (
                          <button type="button" className="sort-button" onClick={() => onSort(col.key)}>
                            {col.label}
                            <span aria-hidden="true" className="sort-icon">
                              {active ? (order === 'asc' ? '▲' : '▼') : '↕'}
                            </span>
                          </button>
                        ) : (
                          col.label
                        )}
                      </th>
                    )
                  })}
                </tr>
              </thead>
              <tbody>
                {data.records.map((r) => (
                  <tr key={r.id}>
                    <td>{r.title}</td>
                    <td>{r.site}</td>
                    <td className="num">{r.latitude.toFixed(6)}</td>
                    <td className="num">{r.longitude.toFixed(6)}</td>
                    <td>
                      <img
                        className="thumb"
                        src={r.image_url}
                        alt={`Image for ${r.title}`}
                        width="48"
                        height="48"
                        loading="lazy"
                      />
                    </td>
                    <td>
                      <div className="row-actions">
                      <Link className="button secondary small" to={`/records/${r.id}/edit`} aria-label={`Edit ${r.title}`}>
                        Edit
                      </Link>
                      <button
                        type="button"
                        className="button danger-outline small"
                        aria-label={`Delete ${r.title}`}
                        onClick={() => setToDelete(r)}
                      >
                        Delete
                      </button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <nav className="pager" aria-label="Pagination">
            <label>
              Rows per page{' '}
              <select value={size} onChange={(e) => update({ size: Number(e.target.value), page: 1 })}>
                {PAGE_SIZES.map((n) => (
                  <option key={n} value={n}>{n}</option>
                ))}
              </select>
            </label>
            <span className="pager-info">Page {data.page} of {data.pages}</span>
            <button
              type="button"
              className="button secondary"
              disabled={data.page <= 1}
              onClick={() => update({ page: data.page - 1 })}
            >
              Previous
            </button>
            <button
              type="button"
              className="button secondary"
              disabled={data.page >= data.pages}
              onClick={() => update({ page: data.page + 1 })}
            >
              Next
            </button>
          </nav>
        </>
      )}

      {toDelete && (
        <ConfirmDialog
          title="Delete record?"
          confirmLabel="Delete"
          busy={deleting}
          error={deleteError}
          onConfirm={confirmDelete}
          onCancel={closeDialog}
        >
          <p>
            This permanently deletes <strong>{toDelete.title}</strong> and its image. This cannot be undone.
          </p>
        </ConfirmDialog>
      )}
    </section>
  )
}
