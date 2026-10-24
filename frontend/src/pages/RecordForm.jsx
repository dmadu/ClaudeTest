import { useEffect, useRef, useState } from 'react'
import { Link, useNavigate, useParams } from 'react-router-dom'
import { ApiError, getJson, postForm, putForm } from '../api/client.js'
import { useAuth } from '../auth/AuthContext.jsx'
import usePageTitle from '../lib/usePageTitle.js'
import { validateRecord } from '../lib/validateRecord.js'

const EMPTY = { title: '', site: '', latitude: '', longitude: '' }
const FIELD_ORDER = ['title', 'site', 'latitude', 'longitude', 'image']

// Remount when the record changes, so every piece of form state starts clean.
export default function RecordFormPage() {
  const { id } = useParams()
  return <RecordForm key={id ?? 'new'} id={id} />
}

function RecordForm({ id }) {
  const editing = Boolean(id)
  const navigate = useNavigate()
  const { expireSession } = useAuth()

  const [values, setValues] = useState(EMPTY)
  const [current, setCurrent] = useState(null) // the saved record, when editing
  const [file, setFile] = useState(null)
  const [preview, setPreview] = useState('')
  const [errors, setErrors] = useState({})
  const [formError, setFormError] = useState('')
  const [load, setLoad] = useState(editing ? 'loading' : 'ready') // loading | ready | missing | failed
  const [saving, setSaving] = useState(false)
  const fileInput = useRef(null)
  const previewUrl = useRef('')

  useEffect(() => {
    if (!editing) return undefined
    let cancelled = false
    getJson(`/api/records/${id}`)
      .then(({ record }) => {
        if (cancelled) return
        setCurrent(record)
        setValues({
          title: record.title,
          site: record.site,
          latitude: String(record.latitude),
          longitude: String(record.longitude),
        })
        setLoad('ready')
      })
      .catch((err) => {
        if (cancelled) return
        if (err.status === 401) {
          expireSession()
          navigate('/login?error=required', { replace: true })
        } else {
          setLoad(err.status === 404 ? 'missing' : 'failed')
          setFormError(err.message)
        }
      })
    return () => {
      cancelled = true
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id])

  // Release the preview's memory when the page goes away.
  useEffect(
    () => () => {
      if (previewUrl.current) URL.revokeObjectURL?.(previewUrl.current)
    },
    [],
  )

  const onChange = (e) => setValues((v) => ({ ...v, [e.target.name]: e.target.value }))

  const onFile = (e) => {
    const chosen = e.target.files[0] || null
    setFile(chosen)
    // Show the chosen file before it is uploaded.
    if (previewUrl.current) URL.revokeObjectURL?.(previewUrl.current)
    previewUrl.current = chosen && URL.createObjectURL ? URL.createObjectURL(chosen) : ''
    setPreview(previewUrl.current)
    setErrors((prev) => ({ ...prev, image: undefined }))
  }

  const focusFirst = (found) => {
    const first = FIELD_ORDER.find((name) => found[name])
    if (first) document.getElementById(first)?.focus()
  }

  const onSubmit = async (e) => {
    e.preventDefault()
    setFormError('')
    const found = validateRecord(values, file, { imageRequired: !editing })
    setErrors(found)
    if (Object.keys(found).length) {
      focusFirst(found)
      return
    }

    const body = new FormData()
    for (const [name, value] of Object.entries(values)) body.append(name, value.trim())
    if (file) body.append('image', file)

    setSaving(true)
    try {
      if (editing) await putForm(`/api/records/${id}`, body)
      else await postForm('/api/records', body)
      navigate('/dashboard', { state: { flash: editing ? 'Record updated.' : 'Record added.' } })
    } catch (err) {
      setSaving(false)
      if (err.status === 401) {
        expireSession()
        navigate('/login?error=required', { replace: true })
      } else if (err instanceof ApiError && Object.keys(err.errors).length) {
        setErrors(err.errors)
        setFormError('Please correct the highlighted fields.')
        focusFirst(err.errors)
      } else {
        setFormError(err.message)
      }
    }
  }

  const title = editing ? 'Edit record' : 'Add record'
  usePageTitle(title, load !== 'loading')

  if (load === 'loading') return <p role="status">Loading…</p>
  if (load === 'missing' || load === 'failed') {
    return (
      <section>
        <h1>{title}</h1>
        <p className="notice danger" role="alert">
          {load === 'missing' ? 'This record could not be found.' : formError}
        </p>
        <p><Link to="/dashboard">Back to dashboard</Link></p>
      </section>
    )
  }

  const textField = (name, label, props = {}) => (
    <div className="field">
      <label htmlFor={name}>{label}</label>
      <input
        id={name}
        name={name}
        type="text"
        value={values[name]}
        onChange={onChange}
        aria-invalid={Boolean(errors[name])}
        aria-describedby={[props.hintId, errors[name] && `${name}-error`].filter(Boolean).join(' ') || undefined}
        {...props.input}
      />
      {props.hint && <p className="hint" id={props.hintId}>{props.hint}</p>}
      {errors[name] && <p className="error" id={`${name}-error`}>{errors[name]}</p>}
    </div>
  )

  return (
    <section>
      <h1>{title}</h1>

      {formError && <p className="notice danger" role="alert">{formError}</p>}

      <form onSubmit={onSubmit} noValidate>
        {textField('title', 'Title', { input: { maxLength: 400, autoComplete: 'off' } })}
        {textField('site', 'Site', { input: { maxLength: 400, autoComplete: 'off' } })}
        {textField('latitude', 'Latitude', {
          input: { inputMode: 'decimal', autoComplete: 'off' },
          hint: 'Between -90 and 90, for example -35.2809.',
          hintId: 'latitude-hint',
        })}
        {textField('longitude', 'Longitude', {
          input: { inputMode: 'decimal', autoComplete: 'off' },
          hint: 'Between -180 and 180, for example 149.13.',
          hintId: 'longitude-hint',
        })}

        <div className="field">
          <label htmlFor="image">Image</label>
          {(preview || current) && (
            <img
              className="form-preview"
              src={preview || current.image_url}
              alt={preview ? 'Preview of the selected image' : `Current image for ${current.title}`}
            />
          )}
          <input
            ref={fileInput}
            id="image"
            name="image"
            type="file"
            accept="image/jpeg,image/png"
            onChange={onFile}
            aria-invalid={Boolean(errors.image)}
            aria-describedby={errors.image ? 'image-hint image-error' : 'image-hint'}
          />
          <p className="hint" id="image-hint">
            {editing
              ? 'Leave empty to keep the current image. JPEG or PNG, up to 5 MB.'
              : 'JPEG or PNG, up to 5 MB.'}
          </p>
          {errors.image && <p className="error" id="image-error">{errors.image}</p>}
        </div>

        <div className="form-actions">
          <button type="submit" className="button" disabled={saving}>
            {saving ? 'Saving…' : editing ? 'Save changes' : 'Add record'}
          </button>
          <Link className="button secondary" to="/dashboard">Cancel</Link>
        </div>
      </form>
    </section>
  )
}
