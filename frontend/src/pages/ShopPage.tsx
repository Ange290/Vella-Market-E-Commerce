import { SlidersHorizontal, X } from 'lucide-react'
import { useEffect, useState, type FormEvent } from 'react'
import { Link, useSearchParams } from 'react-router-dom'
import { Button } from '@/components/ui/Button'
import { EmptyState, ErrorState } from '@/components/ui/feedback'
import { Pagination } from '@/components/ui/Pagination'
import { ProductCard, ProductGrid, ProductGridSkeleton } from '@/features/catalog/components'
import { useCategories, useProducts } from '@/features/catalog/hooks'
import { usePageTitle } from '@/hooks/usePageTitle'
import type { CategoryNode } from '@/types/api'

const SORTS = [
  { value: 'newest', label: 'Newest' },
  { value: 'price_asc', label: 'Price: low to high' },
  { value: 'price_desc', label: 'Price: high to low' },
  { value: 'rating', label: 'Top rated' },
  { value: 'name', label: 'Name A–Z' },
]
const PAGE_SIZE = 12

function findCategory(nodes: CategoryNode[] | undefined, slug: string | null): CategoryNode | undefined {
  for (const n of nodes ?? []) {
    if (n.slug === slug) return n
    const child = findCategory(n.children, slug)
    if (child) return child
  }
  return undefined
}

function CategoryList({ nodes, active, onPick, depth = 0 }: { nodes: CategoryNode[]; active: string | null; onPick: (slug: string | null) => void; depth?: number }) {
  return (
    <ul className={depth ? 'ml-3 border-l border-slate-200 pl-3' : ''}>
      {nodes.map((n) => (
        <li key={n.id}>
          <button type="button" onClick={() => onPick(n.slug)} aria-current={active === n.slug ? 'true' : undefined} className={`flex w-full items-center justify-between rounded-lg px-2 py-1.5 text-left text-sm transition-colors ${active === n.slug ? 'bg-royal-50 font-semibold text-royal-700' : 'text-slate-700 hover:bg-slate-50'}`}>
            <span>{n.name}</span>
            <span className="text-xs text-slate-400">{n.productCount}</span>
          </button>
          {n.children.length > 0 && <CategoryList nodes={n.children} active={active} onPick={onPick} depth={depth + 1} />}
        </li>
      ))}
    </ul>
  )
}

/** Serves both /shop and /search — the URL query string is the single source of truth for filters. */
export function ShopPage({ mode = 'shop' }: { mode?: 'shop' | 'search' }) {
  const [params, setParams] = useSearchParams()
  const q = params.get('q') ?? ''
  const category = params.get('category')
  const sort = params.get('sort') ?? 'newest'
  const page = Math.max(1, Number(params.get('page')) || 1)
  const minPrice = params.get('minPrice') ?? ''
  const maxPrice = params.get('maxPrice') ?? ''

  const [filtersOpen, setFiltersOpen] = useState(false)
  const [min, setMin] = useState(minPrice)
  const [max, setMax] = useState(maxPrice)
  useEffect(() => {
    setMin(minPrice)
    setMax(maxPrice)
  }, [minPrice, maxPrice])

  const categories = useCategories()
  const activeCategory = findCategory(categories.data, category)
  const products = useProducts({ q: q || undefined, category: category ?? undefined, minPrice: minPrice || undefined, maxPrice: maxPrice || undefined, sort, page, pageSize: PAGE_SIZE })

  const title = mode === 'search' && q ? `Results for “${q}”` : (activeCategory?.name ?? 'All products')
  usePageTitle(title)

  const update = (changes: Record<string, string | null>, resetPage = true) => {
    const next = new URLSearchParams(params)
    for (const [k, v] of Object.entries(changes)) {
      if (v) next.set(k, v)
      else next.delete(k)
    }
    if (resetPage) next.delete('page')
    setParams(next)
  }

  const applyPrice = (e: FormEvent) => {
    e.preventDefault()
    update({ minPrice: min.trim() || null, maxPrice: max.trim() || null })
  }
  const hasFilters = !!(q || category || minPrice || maxPrice)
  const clearAll = () => setParams(mode === 'search' && q ? { q } : {})
  const priceInvalid = (v: string) => v !== '' && !/^\d{1,9}(\.\d{1,2})?$/.test(v)

  const filterPanel = (
    <div className="space-y-6">
      <div>
        <h2 className="mb-2 text-sm font-bold uppercase tracking-wide text-navy-900">Categories</h2>
        <button type="button" onClick={() => update({ category: null })} className={`mb-1 w-full rounded-lg px-2 py-1.5 text-left text-sm ${!category ? 'bg-royal-50 font-semibold text-royal-700' : 'text-slate-700 hover:bg-slate-50'}`}>
          All categories
        </button>
        {categories.data && <CategoryList nodes={categories.data} active={category} onPick={(slug) => update({ category: slug })} />}
      </div>
      <form onSubmit={applyPrice}>
        <h2 className="mb-2 text-sm font-bold uppercase tracking-wide text-navy-900">Price (CNY ¥)</h2>
        <div className="flex items-center gap-2">
          <label className="sr-only" htmlFor="minPrice">Minimum price in yuan</label>
          <input id="minPrice" inputMode="decimal" placeholder="Min" value={min} onChange={(e) => setMin(e.target.value)} aria-invalid={priceInvalid(min)} className="w-full rounded-lg border border-slate-300 px-2.5 py-2 text-sm focus:border-royal-500 focus:outline-none" />
          <span className="text-slate-400" aria-hidden>–</span>
          <label className="sr-only" htmlFor="maxPrice">Maximum price in yuan</label>
          <input id="maxPrice" inputMode="decimal" placeholder="Max" value={max} onChange={(e) => setMax(e.target.value)} aria-invalid={priceInvalid(max)} className="w-full rounded-lg border border-slate-300 px-2.5 py-2 text-sm focus:border-royal-500 focus:outline-none" />
        </div>
        <Button type="submit" size="sm" variant="outline" className="mt-2 w-full" disabled={priceInvalid(min) || priceInvalid(max)}>Apply</Button>
      </form>
    </div>
  )

  const total = products.data?.total

  return (
    <div className="mx-auto max-w-7xl px-4 py-8">
      <nav aria-label="Breadcrumb" className="mb-3 text-sm text-slate-500">
        <Link to="/" className="hover:text-royal-600">Home</Link> / <span className="text-slate-700">{mode === 'search' ? 'Search' : 'Shop'}</span>
      </nav>
      <div className="mb-6 flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-2xl font-extrabold text-navy-900 sm:text-3xl">{title}</h1>
          {total !== undefined && <p className="mt-1 text-sm text-slate-600" aria-live="polite">{total} {total === 1 ? 'product' : 'products'}</p>}
        </div>
        <div className="flex items-center gap-2">
          <Button variant="outline" size="sm" className="lg:hidden" icon={<SlidersHorizontal className="h-4 w-4" aria-hidden />} onClick={() => setFiltersOpen((o) => !o)} aria-expanded={filtersOpen}>Filters</Button>
          <div>
            <label htmlFor="sort" className="sr-only">Sort by</label>
            <select id="sort" value={sort} onChange={(e) => update({ sort: e.target.value === 'newest' ? null : e.target.value })} className="h-9 rounded-full border border-slate-300 bg-white px-3 text-sm focus:border-royal-500 focus:outline-none">
              {SORTS.map((s) => <option key={s.value} value={s.value}>{s.label}</option>)}
            </select>
          </div>
        </div>
      </div>

      {hasFilters && (
        <div className="mb-5 flex flex-wrap items-center gap-2">
          {q && <Chip label={`“${q}”`} onRemove={() => update({ q: null })} />}
          {activeCategory && <Chip label={activeCategory.name} onRemove={() => update({ category: null })} />}
          {(minPrice || maxPrice) && <Chip label={`¥${minPrice || 0} – ${maxPrice ? `¥${maxPrice}` : 'any'}`} onRemove={() => update({ minPrice: null, maxPrice: null })} />}
          <button type="button" onClick={clearAll} className="text-sm font-semibold text-royal-600 hover:underline">Clear all</button>
        </div>
      )}

      <div className="grid gap-8 lg:grid-cols-[16rem_1fr]">
        <aside className={`${filtersOpen ? 'block' : 'hidden'} rounded-2xl border border-slate-200 bg-white p-4 lg:block lg:self-start`} aria-label="Filters">{filterPanel}</aside>
        <section aria-label="Products" className={products.isPlaceholderData ? 'opacity-60 transition-opacity' : ''}>
          {products.isPending ? (
            <ProductGridSkeleton count={PAGE_SIZE} />
          ) : products.isError ? (
            <ErrorState onRetry={() => void products.refetch()} />
          ) : products.data.items.length === 0 ? (
            <EmptyState
              title={hasFilters ? 'No products match your filters' : 'No products yet'}
              text={hasFilters ? 'Try removing a filter or searching for something else.' : 'Our catalogue is being stocked. You can still request any product from a supplier.'}
              action={hasFilters ? <Button variant="outline" onClick={clearAll}>Clear filters</Button> : <Link to="/request-product" className="font-semibold text-royal-600 hover:underline">Request a product</Link>}
            />
          ) : (
            <>
              <ProductGrid>
                {products.data.items.map((p) => <ProductCard key={p.id} p={{ ...p, categoryName: p.category.name }} />)}
              </ProductGrid>
              <Pagination page={products.data.page} totalPages={products.data.totalPages} onChange={(n) => { update({ page: n > 1 ? String(n) : null }, false); window.scrollTo({ top: 0, behavior: 'smooth' }) }} />
            </>
          )}
        </section>
      </div>
    </div>
  )
}

function Chip({ label, onRemove }: { label: string; onRemove: () => void }) {
  return (
    <span className="inline-flex items-center gap-1 rounded-full bg-royal-50 py-1 pl-3 pr-1.5 text-sm font-medium text-royal-700">
      {label}
      <button type="button" onClick={onRemove} aria-label={`Remove filter ${label}`} className="grid h-5 w-5 place-items-center rounded-full hover:bg-royal-100">
        <X className="h-3.5 w-3.5" />
      </button>
    </span>
  )
}
