import { useAuth } from '../auth/AuthContext.jsx'

export default function Dashboard() {
  const { user } = useAuth()

  return (
    <section>
      <h1>Dashboard</h1>
      <p>Welcome, {user.name || user.email}.</p>
      <p>Your records will appear here.</p>
    </section>
  )
}
