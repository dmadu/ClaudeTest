import { useState } from 'react'
import { NavLink, Outlet, useNavigate } from 'react-router-dom'
import { LOGIN_URL, useAuth } from '../auth/AuthContext.jsx'

export default function Layout() {
  const [open, setOpen] = useState(false)
  const [logoutError, setLogoutError] = useState('')
  const { user, loading, logout } = useAuth()
  const navigate = useNavigate()

  const close = () => setOpen(false)

  const onLogout = async () => {
    setLogoutError('')
    try {
      await logout()
      close()
      navigate('/')
    } catch (err) {
      setLogoutError(err.message)
    }
  }

  return (
    <>
      <a className="skip-link" href="#main">Skip to content</a>
      <header className="site-header">
        <div className="container header-inner">
          <span className="brand">Site Records</span>
          <button
            type="button"
            className="menu-toggle"
            aria-expanded={open}
            aria-controls="top-menu"
            onClick={() => setOpen((o) => !o)}
          >
            Menu
          </button>
          <nav id="top-menu" aria-label="Main" className={open ? 'open' : ''}>
            <ul>
              <li><NavLink to="/" end onClick={close}>Home</NavLink></li>
              <li><NavLink to="/about" onClick={close}>About</NavLink></li>
              <li><NavLink to="/contact" onClick={close}>Contact</NavLink></li>
              {user && <li><NavLink to="/dashboard" onClick={close}>Dashboard</NavLink></li>}
              {!loading && !user && (
                <li><a href={LOGIN_URL}>Login</a></li>
              )}
              {user && (
                <>
                  <li className="user-name">
                    <span className="visually-hidden">Signed in as </span>
                    {user.name || user.email}
                  </li>
                  <li>
                    <button type="button" className="link-button" onClick={onLogout}>Logout</button>
                  </li>
                </>
              )}
            </ul>
          </nav>
        </div>
        {logoutError && (
          <p className="notice danger container" role="alert">{logoutError}</p>
        )}
      </header>
      <main id="main" className="container">
        <Outlet />
      </main>
      <footer className="site-footer">
        <div className="container">Site Records</div>
      </footer>
    </>
  )
}
