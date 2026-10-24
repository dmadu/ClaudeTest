import { useEffect } from 'react'
import { useNavigationType } from 'react-router-dom'

/**
 * Sets the browser tab title. After an in-app navigation it also moves focus to the page heading,
 * so keyboard and screen reader users land at the top of the new page. It does nothing to focus on
 * the first page load, so the skip link keeps working.
 */
export default function usePageTitle(title, ready = true) {
  const navigationType = useNavigationType()

  useEffect(() => {
    if (!ready) return
    document.title = `${title} \u2013 Site Records`
    if (navigationType !== 'POP') {
      const heading = document.querySelector('main h1')
      if (heading) {
        heading.tabIndex = -1
        heading.focus()
      }
    }
    // navigationType is read once per page; changing it alone should not steal focus again.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [title, ready])
}
