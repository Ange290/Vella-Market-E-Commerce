import { useEffect } from 'react'

/** Sets the browser tab title for the current page. */
export function usePageTitle(title: string | undefined) {
  useEffect(() => {
    document.title = title ? `${title} · Vella Market` : 'Vella Market'
  }, [title])
}
