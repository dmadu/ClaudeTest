export class ApiError extends Error {
  constructor(message, status, errors = {}) {
    super(message)
    this.status = status
    this.errors = errors
  }
}

// Sent on every state-changing request. Set after the app learns who is signed in.
let csrfToken = null
export const setCsrfToken = (token) => {
  csrfToken = token || null
}

async function request(path, init = {}) {
  const method = (init.method || 'GET').toUpperCase()
  const headers = { ...init.headers }
  if (csrfToken && method !== 'GET') headers['X-CSRF-Token'] = csrfToken

  let res
  try {
    res = await fetch(path, { credentials: 'same-origin', ...init, headers })
  } catch {
    throw new ApiError('Could not reach the server. Please try again.', 0)
  }

  const data = await res.json().catch(() => ({}))
  if (!res.ok) {
    const message =
      res.status === 403
        ? 'Your session is out of date. Please reload the page and try again.'
        : data.message || 'Something went wrong.'
    throw new ApiError(message, res.status, data.errors || {})
  }
  return data
}

export const getJson = (path) => request(path)

export const postJson = (path, body) =>
  request(path, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
  })

export const postForm = (path, form) => request(path, { method: 'POST', body: form })

export const putForm = (path, form) => request(path, { method: 'PUT', body: form })

export const del = (path) => request(path, { method: 'DELETE' })
