import { CreditCard, Lock, XCircle } from 'lucide-react'
import { useState } from 'react'
import { Link, useParams } from 'react-router-dom'
import { Button, ButtonLink } from '@/components/ui/Button'
import { EmptyState, ErrorState, FormError, Skeleton } from '@/components/ui/feedback'
import { METHOD_LABEL, OrderTimeline, PaymentBadge, ProgressStepper, ShipmentTracker, StatusBadge, SummaryRow } from '@/features/orders/components'
import { useCancelOrder, useInitiatePayment, useOrder } from '@/features/orders/hooks'
import { usePageTitle } from '@/hooks/usePageTitle'
import { errorMessage } from '@/lib/api'
import { formatDate, formatMoney } from '@/lib/format'
import { useToast } from '@/lib/toast'
import type { OrderDetail, PaymentMethod } from '@/types/api'

const PAY_METHODS: PaymentMethod[] = ['MTN_MOBILE_MONEY', 'AIRTEL_MONEY', 'CARD', 'BANK_TRANSFER']

function PayNow({ order }: { order: OrderDetail }) {
  const initiate = useInitiatePayment()
  const [method, setMethod] = useState<PaymentMethod>('MTN_MOBILE_MONEY')
  const [error, setError] = useState<string | null>(null)

  const pay = () => {
    setError(null)
    initiate.mutate(
      { orderId: order.id, method, key: `pay-${order.id}-${method}-${Date.now()}` },
      {
        onSuccess: (p) => {
          if (p.checkoutUrl) window.location.assign(p.checkoutUrl)
        },
        onError: (err) => setError(errorMessage(err)),
      },
    )
  }

  return (
    <div className="rounded-2xl border-2 border-amber-300 bg-amber-50 p-5">
      <h2 className="flex items-center gap-2 font-bold text-navy-900"><CreditCard className="h-5 w-5" aria-hidden /> Complete your payment</h2>
      <p className="mt-1 text-sm text-amber-900">We will start sourcing as soon as your payment of <strong>{formatMoney({ amount: order.total, currency: order.currency })}</strong> is confirmed.</p>
      <div className="mt-4 flex flex-wrap items-end gap-3">
        <div>
          <label htmlFor="pay-method" className="mb-1 block text-xs font-medium text-slate-700">Pay with</label>
          <select id="pay-method" value={method} onChange={(e) => setMethod(e.target.value as PaymentMethod)} className="h-11 rounded-lg border border-slate-300 bg-white px-3 text-sm focus:border-royal-500 focus:outline-none">
            {PAY_METHODS.map((m) => <option key={m} value={m}>{METHOD_LABEL[m]}</option>)}
          </select>
        </div>
        <Button size="lg" onClick={pay} loading={initiate.isPending} icon={<Lock className="h-4 w-4" aria-hidden />}>Pay now</Button>
      </div>
      <div className="mt-3"><FormError message={error} /></div>
    </div>
  )
}

function CancelOrder({ order }: { order: OrderDetail }) {
  const toast = useToast()
  const cancel = useCancelOrder()
  const [confirming, setConfirming] = useState(false)

  if (!confirming) {
    return <Button variant="ghost" size="sm" className="text-red-600 hover:bg-red-50" icon={<XCircle className="h-4 w-4" aria-hidden />} onClick={() => setConfirming(true)}>Cancel order</Button>
  }
  return (
    <div role="alertdialog" aria-label="Confirm cancellation" className="rounded-xl border border-red-200 bg-red-50 p-4">
      <p className="text-sm font-medium text-red-900">Cancel this order? Items go back into stock and you will not be charged.</p>
      <div className="mt-3 flex gap-2">
        <Button variant="danger" size="sm" loading={cancel.isPending} onClick={() => cancel.mutate({ id: order.id }, { onSuccess: () => toast.success('Your order was cancelled.'), onError: (e) => toast.error(errorMessage(e)) })}>Yes, cancel order</Button>
        <Button variant="outline" size="sm" onClick={() => setConfirming(false)}>Keep order</Button>
      </div>
    </div>
  )
}

export function OrderDetailPage() {
  const { id } = useParams()
  const { data: o, isPending, isError, error, refetch } = useOrder(id)
  usePageTitle(o ? `Order ${o.orderNumber}` : 'Order')

  if (isPending) return <div className="mx-auto max-w-5xl space-y-4 px-4 py-10"><Skeleton className="h-16" /><Skeleton className="h-64" /></div>
  if (isError) {
    return (error as { status?: number }).status === 404
      ? <EmptyState title="Order not found" text="We could not find this order on your account." action={<ButtonLink to="/account/orders">My orders</ButtonLink>} />
      : <ErrorState onRetry={() => void refetch()} />
  }

  const money = (amount: string) => formatMoney({ amount, currency: o.currency })
  const unpaid = o.status === 'AWAITING_PAYMENT' || o.status === 'PENDING'
  const a = o.shippingAddress

  return (
    <div className="mx-auto max-w-5xl px-4 py-8">
      <nav aria-label="Breadcrumb" className="mb-3 text-sm text-slate-500"><Link to="/account/orders" className="hover:text-royal-600">My orders</Link> / <span className="text-slate-700">{o.orderNumber}</span></nav>
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="font-mono text-2xl font-extrabold text-navy-900">{o.orderNumber}</h1>
          <p className="text-sm text-slate-500">Placed {formatDate(o.createdAt, true)}</p>
        </div>
        <StatusBadge status={o.status} />
      </div>

      <div className="mt-6 rounded-2xl border border-slate-200 bg-white p-5"><ProgressStepper status={o.status} /></div>
      {unpaid && <div className="mt-6"><PayNow order={o} /></div>}

      <div className="mt-6 grid gap-6 lg:grid-cols-[1fr_20rem]">
        <div className="space-y-6">
          <section aria-labelledby="items-h" className="rounded-2xl border border-slate-200 bg-white p-5">
            <h2 id="items-h" className="font-bold text-navy-900">Items</h2>
            <ul className="mt-3 divide-y divide-slate-100">
              {o.items.map((it) => (
                <li key={it.id} className="flex gap-3 py-3 text-sm">
                  <span className="h-14 w-14 shrink-0 overflow-hidden rounded-lg border border-slate-200 bg-slate-100">{it.imageUrl && <img src={it.imageUrl} alt="" className="h-full w-full object-cover" />}</span>
                  <div className="min-w-0 flex-1">
                    <p className="font-medium text-navy-900">{it.name}</p>
                    <p className="text-xs text-slate-500">{[it.size && `Size ${it.size}`, it.color].filter(Boolean).join(' · ')} {it.quantity > 0 && `× ${it.quantity}`}</p>
                  </div>
                  <p className="font-semibold text-navy-900">{money(it.lineTotal)}</p>
                </li>
              ))}
            </ul>
          </section>

          {o.shipments.length > 0 && (
            <section aria-labelledby="ship-h" className="space-y-3">
              <h2 id="ship-h" className="font-bold text-navy-900">Shipping &amp; tracking</h2>
              {o.shipments.map((s, i) => <ShipmentTracker key={s.id} shipment={s} index={i} total={o.shipments.length} />)}
            </section>
          )}

          <section aria-labelledby="tl-h" className="rounded-2xl border border-slate-200 bg-white p-5">
            <h2 id="tl-h" className="mb-4 font-bold text-navy-900">Order history</h2>
            <OrderTimeline entries={o.history} />
          </section>
        </div>

        <aside className="space-y-6">
          <section aria-labelledby="sum-h" className="rounded-2xl border border-slate-200 bg-white p-5">
            <h2 id="sum-h" className="font-bold text-navy-900">Payment summary</h2>
            <dl className="mt-3 space-y-2">
              <SummaryRow label="Subtotal" value={money(o.subtotal)} />
              <SummaryRow label="Shipping" value={money(o.shippingFee)} />
              <SummaryRow label="Service fee" value={money(o.serviceFee)} />
              {Number(o.taxAmount) > 0 && <SummaryRow label="Taxes" value={money(o.taxAmount)} />}
              {Number(o.discountAmount) > 0 && <SummaryRow label="Discount" value={`− ${money(o.discountAmount)}`} />}
              <SummaryRow strong label="Total" value={money(o.total)} />
            </dl>
            <p className="mt-3 text-xs text-slate-500">Charged in {o.currency} at 1 CNY = {o.exchangeRate} {o.currency}.</p>
          </section>

          <section aria-labelledby="addr-h" className="rounded-2xl border border-slate-200 bg-white p-5 text-sm">
            <h2 id="addr-h" className="font-bold text-navy-900">Delivery address</h2>
            <address className="mt-3 not-italic text-slate-700">{a.recipientName}<br />{a.street}<br />{a.city}{a.region ? `, ${a.region}` : ''}{a.postalCode ? ` ${a.postalCode}` : ''}<br />{a.country}<br /><span className="text-slate-500">{a.phone}</span></address>
          </section>

          {o.payments.length > 0 && (
            <section aria-labelledby="pay-h" className="rounded-2xl border border-slate-200 bg-white p-5 text-sm">
              <h2 id="pay-h" className="font-bold text-navy-900">Payments</h2>
              <ul className="mt-3 space-y-3">
                {o.payments.map((p) => (
                  <li key={p.id} className="flex items-start justify-between gap-2">
                    <div><p className="font-medium text-slate-800">{METHOD_LABEL[p.method] ?? p.method}</p><p className="text-xs text-slate-500">{formatDate(p.paidAt ?? p.createdAt, true)}</p></div>
                    <PaymentBadge status={p.status} />
                  </li>
                ))}
              </ul>
            </section>
          )}

          {unpaid && <CancelOrder order={o} />}
        </aside>
      </div>
    </div>
  )
}
