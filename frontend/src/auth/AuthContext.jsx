import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react'
import { getJson, postJson } from '../api/client.js'

const AuthContext = createContext(null)

export const LOGIN_URL = '/api/auth/login'

export function AuthProvider({ children }) {
  const [user, setUser] = useState(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    let cancelled = false
    getJson('/api/auth/me')
      .then((data) => !cancelled && setUser(data.user))
      .catch(() => !cancelled && setUser(null))
      .finally(() => !cancelled && setLoading(false))
    return () => {
      cancelled = true
    }
  }, [])

  const logout = useCallback(async () => {
    await postJson('/api/auth/logout')
    setUser(null)
  }, [])

  const value = useMemo(() => ({ user, loading, logout }), [user, loading, logout])
  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>
}

export function useAuth() {
  const ctx = useContext(AuthContext)
  if (!ctx) throw new Error('useAuth must be used inside AuthProvider')
  return ctx
}
