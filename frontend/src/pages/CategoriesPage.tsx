import { Link, Navigate, useParams } from 'react-router-dom'
import { EmptyState, ErrorState, Skeleton } from '@/components/ui/feedback'
import { useCategories } from '@/features/catalog/hooks'
import { usePageTitle } from '@/hooks/usePageTitle'

export function CategoriesPage() {
  usePageTitle('Categories')
  const { data, isPending, isError, refetch } = useCategories()

  return (
    <div className="mx-auto max-w-7xl px-4 py-8">
      <h1 className="text-2xl font-extrabold text-navy-900 sm:text-3xl">Categories</h1>
      <p className="mt-1 text-sm text-slate-600">Browse everything we offer, grouped by type.</p>
      <div className="mt-8">
        {isPending ? (
          <div className="grid gap-5 sm:grid-cols-2 lg:grid-cols-3">{Array.from({ length: 6 }, (_, i) => <Skeleton key={i} className="h-36" />)}</div>
        ) : isError ? (
          <ErrorState onRetry={() => void refetch()} />
        ) : data.length === 0 ? (
          <EmptyState title="No categories yet" text="Check back soon — we are adding products." />
        ) : (
          <div className="grid gap-5 sm:grid-cols-2 lg:grid-cols-3">
            {data.map((c) => (
              <div key={c.id} className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
                <Link to={`/shop?category=${c.slug}`} className="text-lg font-bold text-navy-900 hover:text-royal-600">{c.name}</Link>
                <p className="text-xs text-slate-500">{c.productCount} {c.productCount === 1 ? 'product' : 'products'}</p>
                {c.children.length > 0 && (
                  <ul className="mt-3 flex flex-wrap gap-2">
                    {c.children.map((ch) => (
                      <li key={ch.id}>
                        <Link to={`/shop?category=${ch.slug}`} className="rounded-full bg-royal-50 px-3 py-1 text-xs font-medium text-royal-700 hover:bg-royal-100">{ch.name}</Link>
                      </li>
                    ))}
                  </ul>
                )}
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  )
}

/** /categories/:slug simply opens the shop pre-filtered. */
export function CategoryRedirect() {
  const { slug } = useParams()
  return <Navigate to={`/shop?category=${encodeURIComponent(slug ?? '')}`} replace />
}
