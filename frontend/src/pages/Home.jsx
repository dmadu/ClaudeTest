import { Link } from 'react-router-dom'
import { LOGIN_URL, useAuth } from '../auth/AuthContext.jsx'

export default function Home() {
  const { user, loading } = useAuth()

  return (
    <section>
      <h1>Site Records</h1>
      <p className="lead">
        Keep a record of your sites in one place. Store a title, the site name, its coordinates and
        a photo, then find, update or remove any record from your dashboard.
      </p>
      {user ? (
        <p><Link className="button" to="/dashboard">Go to your dashboard</Link></p>
      ) : (
        <>
          <p>Sign in with your institution through AAF to get started.</p>
          {!loading && <p><a className="button" href={LOGIN_URL}>Login</a></p>}
        </>
      )}
    </section>
  )
}
