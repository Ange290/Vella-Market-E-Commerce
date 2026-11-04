import { ClipboardList, ExternalLink } from 'lucide-react'
import { Link, useSearchParams } from 'react-router-dom'
import { ButtonLink } from '@/components/ui/Button'
import { EmptyState, ErrorState, Skeleton } from '@/components/ui/feedback'
import { Pagination } from '@/components/ui/Pagination'
import { useRequests } from '@/features/account/hooks'
import { REQUEST_LABEL, RequestBadge } from '@/features/account/requestComponents'
import { usePageTitle } from '@/hooks/usePageTitle'
import { formatDate } from '@/lib/format'
import type { RequestStatus } from '@/types/api'

export function RequestsPage() {
  usePageTitle('My requests')
  const [params, setParams] = useSearchParams()
  const page = Math.max(1, Number(params.get('page')) || 1)
  const status = (params.get('status') as RequestStatus | null) ?? undefined
  const { data, isPending, isError, refetch, isPlaceholderData } = useRequests(page, status)

  const set = (changes: Record<string, string | null>) => {
    const next = new URLSearchParams(params)
    for (const [k, v] of Object.entries(changes)) v ? next.set(k, v) : next.delete(k)
    setParams(next)
  }

  return (
    <div className="mx-auto max-w-4xl px-4 py-8">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <h1 className="text-2xl font-extrabold text-navy-900 sm:text-3xl">My product requests</h1>
        <div className="flex items-center gap-2">
          <label htmlFor="rstatus" className="sr-only">Filter by status</label>
          <select id="rstatus" value={status ?? ''} onChange={(e) => set({ status: e.target.value || null, page: null })} className="h-9 rounded-full border border-slate-300 bg-white px-3 text-sm focus:border-royal-500 focus:outline-none">
            <option value="">All requests</option>
            {(Object.keys(REQUEST_LABEL) as RequestStatus[]).map((s) => <option key={s} value={s}>{REQUEST_LABEL[s]}</option>)}
          </select>
          <ButtonLink to="/request-product" size="sm">New request</ButtonLink>
        </div>
      </div>

      <div className={`mt-6 ${isPlaceholderData ? 'opacity-60' : ''}`}>
        {isPending ? <div className="space-y-3">{[0, 1, 2].map((i) => <Skeleton key={i} className="h-24" />)}</div> : isError ? <ErrorState onRetry={() => void refetch()} /> : data.items.length === 0 ? (
          <EmptyState icon={<ClipboardList className="h-6 w-6" />} title={status ? 'No requests with this status' : 'No requests yet'} text={status ? undefined : 'Ask us to source any product and we will send you a quotation.'} action={status ? undefined : <ButtonLink to="/request-product">Request a product</ButtonLink>} />
        ) : (
          <>
            <ul className="space-y-3">
              {data.items.map((r) => (
                <li key={r.id}>
                  <Link to={`/account/requests/${r.id}`} className="flex gap-4 rounded-2xl border border-slate-200 bg-white p-4 transition-shadow hover:shadow-md">
                    <span className="grid h-16 w-16 shrink-0 place-items-center overflow-hidden rounded-xl border border-slate-200 bg-slate-100 text-slate-400">
                      {r.imageUrl ? <img src={r.imageUrl} alt="" className="h-full w-full object-cover" /> : <ExternalLink className="h-5 w-5" aria-hidden />}
                    </span>
                    <div className="min-w-0 flex-1">
                      <div className="flex items-start justify-between gap-2">
                        <p className="line-clamp-1 font-semibold text-navy-900">{r.title ?? r.productUrl ?? 'Product request'}</p>
                        <RequestBadge status={r.status} />
                      </div>
                      <p className="mt-1 text-xs text-slate-500">Qty {r.quantity} · sent {formatDate(r.createdAt)}</p>
                      {r.status === 'QUOTED' && <p className="mt-1 text-sm font-semibold text-accent-600">Your quotation is ready →</p>}
                    </div>
                  </Link>
                </li>
              ))}
            </ul>
            <Pagination page={data.page} totalPages={data.totalPages} onChange={(n) => set({ page: n > 1 ? String(n) : null })} />
          </>
        )}
      </div>
    </div>
  )
}
