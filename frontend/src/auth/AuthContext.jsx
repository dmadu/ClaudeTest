import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react'
import { getJson, postJson, setCsrfToken } from '../api/client.js'

const AuthContext = createContext(null)

export const LOGIN_URL = '/api/auth/login'

export function AuthProvider({ children }) {
  const [user, setUser] = useState(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    let cancelled = false
    getJson('/api/auth/me')
      .then((data) => {
        if (cancelled) return
        setCsrfToken(data.csrf_token)
        setUser(data.user)
      })
      .catch(() => !cancelled && setUser(null))
      .finally(() => !cancelled && setLoading(false))
    return () => {
      cancelled = true
    }
  }, [])

  const logout = useCallback(async () => {
    await postJson('/api/auth/logout')
    setCsrfToken(null)
    setUser(null)
  }, [])

  // Called when the API says the session is gone, so protected pages redirect to login.
  const expireSession = useCallback(() => {
    setCsrfToken(null)
    setUser(null)
  }, [])

  const value = useMemo(
    () => ({ user, loading, logout, expireSession }),
    [user, loading, logout, expireSession],
  )
  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>
}

export function useAuth() {
  const ctx = useContext(AuthContext)
  if (!ctx) throw new Error('useAuth must be used inside AuthProvider')
  return ctx
}
