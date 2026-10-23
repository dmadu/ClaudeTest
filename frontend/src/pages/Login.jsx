import { Navigate, useSearchParams } from 'react-router-dom'
import { LOGIN_URL, useAuth } from '../auth/AuthContext.jsx'

const MESSAGES = {
  required: 'Please sign in to continue.',
  invalid: 'We could not verify your sign-in. Please try again.',
  unavailable: 'Sign-in is not available right now. Please try again later.',
}

export default function Login() {
  const { user, loading } = useAuth()
  const [params] = useSearchParams()
  const error = params.get('error')

  if (!loading && user) return <Navigate to="/dashboard" replace />

  return (
    <section>
      <h1>Login</h1>
      {error && (
        <p className="notice danger" role="alert">
          {MESSAGES[error] || 'Sign-in failed. Please try again.'}
        </p>
      )}
      <p>Sign in with your institution through the Australian Access Federation (AAF).</p>
      <p><a className="button" href={LOGIN_URL}>Sign in with AAF</a></p>
    </section>
  )
}
