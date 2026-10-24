import { Link } from 'react-router-dom'
import usePageTitle from '../lib/usePageTitle.js'

export default function NotFound() {
  usePageTitle('Page not found')
  return (
    <section>
      <h1>Page not found</h1>
      <p><Link to="/">Back to Home</Link></p>
    </section>
  )
}
