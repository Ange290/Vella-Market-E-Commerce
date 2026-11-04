import { Search } from 'lucide-react'
import { useState, type FormEvent } from 'react'
import { Link, useNavigate, useParams } from 'react-router-dom'
import { Button } from '@/components/ui/Button'
import { TextField } from '@/components/ui/Field'
import { ErrorState, Skeleton } from '@/components/ui/feedback'
import { OrderTimeline, ProgressStepper, ShipmentTracker, StatusBadge } from '@/features/orders/components'
import { useOrderByNumber, useOrders } from '@/features/orders/hooks'
import { usePageTitle } from '@/hooks/usePageTitle'
import { formatDate } from '@/lib/format'

const REFERENCE = /^VM-\d{8}-[A-Z2-9]{6}$/i

export function TrackPage() {
  usePageTitle('Track your order')
  const { orderNumber } = useParams()
  const navigate = useNavigate()
  const [value, setValue] = useState(orderNumber ?? '')
  const [error, setError] = useState<string | null>(null)
  const recent = useOrders(1)
  const order = useOrderByNumber(orderNumber && REFERENCE.test(orderNumber) ? orderNumber : undefined)

  const submit = (e: FormEvent) => {
    e.preventDefault()
    const ref = value.trim().toUpperCase()
    if (!REFERENCE.test(ref)) return setError('Enter your order reference, e.g. VM-20261104-7K3QHD.')
    setError(null)
    navigate(`/track/${ref}`)
  }

  const o = order.data
  return (
    <div className="mx-auto max-w-3xl px-4 py-10">
      <h1 className="text-2xl font-extrabold text-navy-900 sm:text-3xl">Track your order</h1>
      <p className="mt-1 text-sm text-slate-600">Enter the order reference from your confirmation to see where your parcel is.</p>

      <form onSubmit={submit} noValidate className="mt-6 flex items-start gap-3">
        <div className="flex-1"><TextField label="Order reference" placeholder="VM-20261104-7K3QHD" value={value} onChange={(e) => setValue(e.target.value)} error={error ?? undefined} className="font-mono uppercase" /></div>
        <Button type="submit" className="mt-[26px]" icon={<Search className="h-4 w-4" aria-hidden />}>Track</Button>
      </form>

      {!orderNumber && recent.data && recent.data.items.length > 0 && (
        <div className="mt-8">
          <h2 className="text-sm font-bold uppercase tracking-wide text-slate-500">Your recent orders</h2>
          <ul className="mt-3 space-y-2">
            {recent.data.items.slice(0, 5).map((r) => (
              <li key={r.id}>
                <Link to={`/track/${r.orderNumber}`} className="flex items-center justify-between rounded-xl border border-slate-200 bg-white px-4 py-3 text-sm hover:border-royal-500">
                  <span className="font-mono font-semibold text-navy-900">{r.orderNumber}</span>
                  <span className="flex items-center gap-3"><span className="hidden text-slate-500 sm:inline">{formatDate(r.createdAt)}</span><StatusBadge status={r.status} /></span>
                </Link>
              </li>
            ))}
          </ul>
        </div>
      )}

      {orderNumber && !REFERENCE.test(orderNumber) && <div className="mt-8"><ErrorState message="That doesn't look like an order reference." /></div>}
      {order.isPending && order.fetchStatus !== 'idle' && <div className="mt-8 space-y-3"><Skeleton className="h-20" /><Skeleton className="h-48" /></div>}
      {order.isError && <div className="mt-8"><ErrorState message={(order.error as { status?: number }).status === 404 ? 'We could not find an order with that reference on your account.' : undefined} /></div>}

      {o && (
        <div className="mt-8 space-y-6">
          <div className="rounded-2xl border border-slate-200 bg-white p-5">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <p className="font-mono text-lg font-bold text-navy-900">{o.orderNumber}</p>
              <StatusBadge status={o.status} />
            </div>
            <div className="mt-5"><ProgressStepper status={o.status} /></div>
            <Link to={`/account/orders/${o.id}`} className="mt-4 inline-block text-sm font-semibold text-royal-600 hover:underline">View full order details →</Link>
          </div>
          {o.shipments.map((s, i) => <ShipmentTracker key={s.id} shipment={s} index={i} total={o.shipments.length} />)}
          <section className="rounded-2xl border border-slate-200 bg-white p-5" aria-labelledby="hist">
            <h2 id="hist" className="mb-4 font-bold text-navy-900">Status updates</h2>
            <OrderTimeline entries={o.history} />
          </section>
        </div>
      )}
    </div>
  )
}
