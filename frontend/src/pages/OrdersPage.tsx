import { PackageOpen } from 'lucide-react'
import { Link, useSearchParams } from 'react-router-dom'
import { ButtonLink } from '@/components/ui/Button'
import { EmptyState, ErrorState, Skeleton } from '@/components/ui/feedback'
import { Pagination } from '@/components/ui/Pagination'
import { STATUS_LABEL, StatusBadge } from '@/features/orders/components'
import { useOrders } from '@/features/orders/hooks'
import { usePageTitle } from '@/hooks/usePageTitle'
import { formatDate, formatMoney } from '@/lib/format'
import type { OrderStatus } from '@/types/api'

export function OrdersPage() {
  usePageTitle('My orders')
  const [params, setParams] = useSearchParams()
  const page = Math.max(1, Number(params.get('page')) || 1)
  const status = (params.get('status') as OrderStatus | null) ?? undefined
  const { data, isPending, isError, refetch, isPlaceholderData } = useOrders(page, status)

  const set = (changes: Record<string, string | null>) => {
    const next = new URLSearchParams(params)
    for (const [k, v] of Object.entries(changes)) v ? next.set(k, v) : next.delete(k)
    setParams(next)
  }

  return (
    <div className="mx-auto max-w-4xl px-4 py-8">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <h1 className="text-2xl font-extrabold text-navy-900 sm:text-3xl">My orders</h1>
        <div>
          <label htmlFor="status" className="sr-only">Filter by status</label>
          <select id="status" value={status ?? ''} onChange={(e) => set({ status: e.target.value || null, page: null })} className="h-9 rounded-full border border-slate-300 bg-white px-3 text-sm focus:border-royal-500 focus:outline-none">
            <option value="">All orders</option>
            {(Object.keys(STATUS_LABEL) as OrderStatus[]).map((s) => <option key={s} value={s}>{STATUS_LABEL[s]}</option>)}
          </select>
        </div>
      </div>

      <div className={`mt-6 ${isPlaceholderData ? 'opacity-60' : ''}`}>
        {isPending ? (
          <div className="space-y-3">{[0, 1, 2].map((i) => <Skeleton key={i} className="h-28" />)}</div>
        ) : isError ? (
          <ErrorState onRetry={() => void refetch()} />
        ) : data.items.length === 0 ? (
          <EmptyState icon={<PackageOpen className="h-6 w-6" />} title={status ? 'No orders with this status' : 'No orders yet'} text={status ? undefined : 'When you place an order it will show up here.'} action={status ? undefined : <ButtonLink to="/shop">Start shopping</ButtonLink>} />
        ) : (
          <>
            <ul className="space-y-3">
              {data.items.map((o) => (
                <li key={o.id}>
                  <Link to={`/account/orders/${o.id}`} className="block rounded-2xl border border-slate-200 bg-white p-5 transition-shadow hover:shadow-md">
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <div>
                        <p className="font-mono text-sm font-bold text-navy-900">{o.orderNumber}</p>
                        <p className="text-xs text-slate-500">Placed {formatDate(o.createdAt)} · {o.itemCount} {o.itemCount === 1 ? 'item' : 'items'}</p>
                      </div>
                      <StatusBadge status={o.status} />
                    </div>
                    <div className="mt-4 flex items-center justify-between gap-4">
                      <div className="flex -space-x-2" aria-hidden>
                        {o.items.map((it, i) => (
                          <span key={i} className="h-11 w-11 overflow-hidden rounded-lg border-2 border-white bg-slate-100">
                            {it.imageUrl ? <img src={it.imageUrl} alt="" className="h-full w-full object-cover" /> : null}
                          </span>
                        ))}
                      </div>
                      <p className="text-lg font-extrabold text-navy-900">{formatMoney({ amount: o.total, currency: o.currency })}</p>
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
