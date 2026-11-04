import { ButtonLink } from '@/components/ui/Button'
import { usePageTitle } from '@/hooks/usePageTitle'

export function NotFoundPage() {
  usePageTitle('Page not found')
  return (
    <div className="mx-auto max-w-lg px-4 py-24 text-center">
      <p className="text-6xl font-extrabold text-royal-600">404</p>
      <h1 className="mt-4 text-2xl font-extrabold text-navy-900">We can't find that page</h1>
      <p className="mt-2 text-slate-600">The link may be broken or the page may have moved.</p>
      <div className="mt-8 flex justify-center gap-3">
        <ButtonLink to="/">Go home</ButtonLink>
        <ButtonLink to="/shop" variant="outline">Browse products</ButtonLink>
      </div>
    </div>
  )
}
