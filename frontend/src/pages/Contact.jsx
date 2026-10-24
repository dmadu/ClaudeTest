import { useState } from 'react'
import { ApiError, postJson } from '../api/client.js'
import usePageTitle from '../lib/usePageTitle.js'

const EMPTY = { name: '', email: '', message: '' }
const LIMITS = { name: 100, email: 255, message: 2000 }
const EMAIL_RE = /^[^@\s]+@[^@\s]+\.[^@\s]+$/

export function validate(values) {
  const errors = {}
  for (const field of Object.keys(EMPTY)) {
    const value = values[field].trim()
    if (!value) errors[field] = 'This field is required.'
    else if (value.length > LIMITS[field]) errors[field] = `Must be at most ${LIMITS[field]} characters.`
  }
  if (!errors.email && !EMAIL_RE.test(values.email.trim())) errors.email = 'Enter a valid email address.'
  return errors
}

export default function Contact() {
  usePageTitle('Contact')
  const [values, setValues] = useState(EMPTY)
  const [errors, setErrors] = useState({})
  const [status, setStatus] = useState('idle') // idle | sending | sent | failed
  const [failure, setFailure] = useState('')

  const onChange = (e) => setValues((v) => ({ ...v, [e.target.name]: e.target.value }))

  const onSubmit = async (e) => {
    e.preventDefault()
    const found = validate(values)
    setErrors(found)
    if (Object.keys(found).length) return

    setStatus('sending')
    setFailure('')
    try {
      await postJson('/api/contact', {
        name: values.name.trim(),
        email: values.email.trim(),
        message: values.message.trim(),
      })
      setValues(EMPTY)
      setStatus('sent')
    } catch (err) {
      if (err instanceof ApiError && err.status === 400) {
        setErrors(err.errors)
        setFailure('Please correct the highlighted fields.')
      } else {
        setFailure(err.message)
      }
      setStatus('failed')
    }
  }

  const field = (name, label, props = {}) => (
    <div className="field">
      <label htmlFor={name}>{label}</label>
      {props.as === 'textarea' ? (
        <textarea
          id={name}
          name={name}
          rows={6}
          value={values[name]}
          onChange={onChange}
          aria-invalid={Boolean(errors[name])}
          aria-describedby={errors[name] ? `${name}-error` : undefined}
        />
      ) : (
        <input
          id={name}
          name={name}
          type={props.type || 'text'}
          autoComplete={props.autoComplete}
          value={values[name]}
          onChange={onChange}
          aria-invalid={Boolean(errors[name])}
          aria-describedby={errors[name] ? `${name}-error` : undefined}
        />
      )}
      {errors[name] && (
        <p className="error" id={`${name}-error`}>{errors[name]}</p>
      )}
    </div>
  )

  return (
    <section>
      <h1>Contact</h1>
      <p>Send us a message and we will get back to you.</p>

      {status === 'sent' && (
        <p className="notice success" role="status">Thank you, your message has been sent.</p>
      )}
      {status === 'failed' && failure && (
        <p className="notice danger" role="alert">{failure}</p>
      )}

      <form onSubmit={onSubmit} noValidate>
        {field('name', 'Name', { autoComplete: 'name' })}
        {field('email', 'Email', { type: 'email', autoComplete: 'email' })}
        {field('message', 'Message', { as: 'textarea' })}
        <button type="submit" className="button" disabled={status === 'sending'}>
          {status === 'sending' ? 'Sending…' : 'Send message'}
        </button>
      </form>
    </section>
  )
}
