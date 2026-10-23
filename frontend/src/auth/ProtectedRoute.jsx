import { Navigate, Outlet } from 'react-router-dom'
import { useAuth } from './AuthContext.jsx'

export default function ProtectedRoute() {
  const { user, loading } = useAuth()
  if (loading) return <p role="status">Loading…</p>
  if (!user) return <Navigate to="/login?error=required" replace />
  return <Outlet />
}
