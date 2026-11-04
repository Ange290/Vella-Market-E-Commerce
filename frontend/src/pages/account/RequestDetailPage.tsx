import { Clock, ExternalLink } from 'lucide-react'
import { useState } from 'react'
import { Link, useNavigate, useParams } from 'react-router-dom'
import { Button, ButtonLink } from '@/components/ui/Button'
import { EmptyState, ErrorState, FormError, Skeleton } from '@/components/ui/feedback'
import { useAcceptQuotation, useCancelRequest, useRejectQuotation, useRequest } from '@/features/account/hooks'
import { OPEN_REQUEST, QUOTATION_LABEL, RequestBadge } from '@/features/account/requestComponents'
import { SummaryRow } from '@/features/orders/components'
import { useAddresses } from '@/features/orders/hooks'
import { usePageTitle } from '@/hooks/usePageTitle'
import { errorMessage } from '@/lib/api'
import { formatDate, formatMoney } from '@/lib/format'
import { useToast } from '@/lib/toast'
import type { QuotationItem } from '@/types/api'

function QuotationCard({ q }: { q: QuotationItem }) {
  const navigate = useNavigate()
  const toast = useToast()
  const addresses = useAddresses()
  const accept = useAcceptQuotation()
  const reject = useRejectQuotation()
  const [addressId, setAddressId] = useState<string>()
  const [error, setError] = useState<string | null>(null)

  const money = (amount: string) => formatMoney({ amount, currency: q.currency })
  const expiresMs = new Date(q.validUntil).getTime() - Date.now()
  const live = q.status === 'SENT' && expiresMs > 0
  const daysLeft = Math.max(0, Math.ceil(expiresMs / 86_400_000))
  const selected = addressId ?? addresses.data?.find((a) => a.isDefault)?.id ?? addresses.data?.[0]?.id

  const onAccept = () => {
    if (!selected) return setError('Choose a delivery address first.')
    setError(null)
    accept.mutate({ id: q.id, addressId: selected }, {
      onSuccess: (order) => { toast.success('Order created. Complete your payment to start sourcing.'); navigate(`/account/orders/${order.id}`) },
      onError: (e) => setError(errorMessage(e)),
    })
  }

  return (
    <section className={`rounded-2xl border bg-white p-5 ${live ? 'border-accent-500 ring-1 ring-accent-500' : 'border-slate-200'}`} aria-label={`Quotation, ${QUOTATION_LABEL[q.status]}`}>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h3 className="font-bold text-navy-900">Quotation</h3>
        <span className={`rounded-full px-2.5 py-1 text-xs font-semibold ${live ? 'bg-accent-100 text-accent-600' : q.status === 'ACCEPTED' ? 'bg-emerald-100 text-emerald-800' : 'bg-slate-100 text-slate-600'}`}>{q.status === 'SENT' && !live ? 'Expired' : QUOTATION_LABEL[q.status]}</span>
      </div>
      <dl className="mt-4 space-y-2">
        <SummaryRow label="Product cost" value={money(q.productCost)} />
        <SummaryRow label="Shipping" value={money(q.shippingCost)} />
        <SummaryRow label="Service fee" value={money(q.serviceFee)} />
        {Number(q.taxAmount) > 0 && <SummaryRow label="Taxes" value={money(q.taxAmount)} />}
        <SummaryRow strong label="Total" value={money(q.total)} />
      </dl>
      {q.notes && <p className="mt-3 rounded-lg bg-surface p-3 text-sm text-slate-700"><span className="font-semibold">Note from our team: </span>{q.notes}</p>}
      <p className="mt-3 flex items-center gap-1.5 text-xs text-slate-500"><Clock className="h-3.5 w-3.5" aria-hidden />{live ? `Valid until ${formatDate(q.validUntil)} (${daysLeft} ${daysLeft === 1 ? 'day' : 'days'} left)` : `Valid until ${formatDate(q.validUntil)}`}</p>

      {q.order && <ButtonLink to={`/account/orders/${q.order.id}`} className="mt-4" variant="outline">View order {q.order.orderNumber}</ButtonLink>}

      {live && (
        <div className="mt-5 border-t border-slate-100 pt-5">
          <p className="text-sm font-semibold text-navy-900">Deliver to</p>
          {addresses.isPending ? <Skeleton className="mt-2 h-12" /> : addresses.data && addresses.data.length > 0 ? (
            <div className="mt-2 space-y-2">
              {addresses.data.map((a) => (
                <label key={a.id} className={`flex cursor-pointer gap-3 rounded-xl border p-3 text-sm ${selected === a.id ? 'border-navy-900 bg-royal-50/50' : 'border-slate-200'}`}>
                  <input type="radio" name={`addr-${q.id}`} checked={selected === a.id} onChange={() => setAddressId(a.id)} />
                  <span>{a.recipientName}, {a.street}, {a.city} ({a.country})</span>
                </label>
              ))}
            </div>
          ) : <p className="mt-2 text-sm text-slate-600">You have no saved address. <Link to="/account/addresses" className="font-semibold text-royal-600 hover:underline">Add one</Link> first.</p>}
          <div className="mt-3"><FormError message={error} /></div>
          <div className="mt-4 flex flex-wrap gap-3">
            <Button size="lg" loading={accept.isPending} disabled={!selected} onClick={onAccept}>Accept &amp; create order</Button>
            <Button variant="outline" loading={reject.isPending} onClick={() => reject.mutate(q.id, { onSuccess: () => toast.info('Quotation declined. We may send you a new offer.'), onError: (e) => toast.error(errorMessage(e)) })}>Decline</Button>
          </div>
          <p className="mt-2 text-xs text-slate-500">Accepting creates an order for {money(q.total)}. You pay in the next step.</p>
        </div>
      )}
    </section>
  )
}

export function RequestDetailPage() {
  const { id } = useParams()
  const toast = useToast()
  const { data: r, isPending, isError, error, refetch } = useRequest(id)
  const cancel = useCancelRequest()
  const [confirming, setConfirming] = useState(false)
  usePageTitle(r?.title ?? 'Product request')

  if (isPending) return <div className="mx-auto max-w-4xl space-y-4 px-4 py-10"><Skeleton className="h-24" /><Skeleton className="h-56" /></div>
  if (isError) {
    return (error as { status?: number }).status === 404
      ? <EmptyState title="Request not found" action={<ButtonLink to="/account/requests">My requests</ButtonLink>} />
      : <ErrorState onRetry={() => void refetch()} />
  }

  const quotations = r.quotations ?? []
  return (
    <div className="mx-auto max-w-4xl px-4 py-8">
      <nav aria-label="Breadcrumb" className="mb-3 text-sm text-slate-500"><Link to="/account/requests" className="hover:text-royal-600">My requests</Link> / <span className="text-slate-700">{r.title ?? 'Request'}</span></nav>
      <div className="flex flex-wrap items-start justify-between gap-3">
        <h1 className="text-2xl font-extrabold text-navy-900">{r.title ?? 'Product request'}</h1>
        <RequestBadge status={r.status} />
      </div>
      <p className="text-sm text-slate-500">Sent {formatDate(r.createdAt, true)}</p>

      <div className="mt-6 grid gap-6 lg:grid-cols-[1fr_20rem]">
        <div className="space-y-4">
          {r.status === 'SUBMITTED' && <p role="status" className="rounded-xl bg-royal-50 p-4 text-sm text-royal-800">We have your request and will review it shortly. You will get a notification when your quotation is ready.</p>}
          {r.status === 'UNDER_REVIEW' && <p role="status" className="rounded-xl bg-royal-50 p-4 text-sm text-royal-800">Our team is checking suppliers and preparing your quotation.</p>}
          {r.status === 'REJECTED' && <p role="status" className="rounded-xl bg-red-50 p-4 text-sm text-red-800">We could not source this product. Check your notifications for the reason, or <Link to="/contact" className="font-semibold underline">contact us</Link>.</p>}
          {quotations.length === 0 && ['SUBMITTED', 'UNDER_REVIEW'].includes(r.status) ? null : quotations.length === 0 ? <p className="text-sm text-slate-500">No quotations for this request.</p> : quotations.map((q) => <QuotationCard key={q.id} q={q} />)}
        </div>

        <aside className="h-fit space-y-4 rounded-2xl border border-slate-200 bg-white p-5 text-sm">
          <h2 className="font-bold text-navy-900">Your request</h2>
          {r.imageUrl && <img src={r.imageUrl} alt="Product you uploaded" className="w-full rounded-xl border border-slate-200 object-cover" />}
          <dl className="space-y-2">
            <div className="flex justify-between gap-3"><dt className="text-slate-500">Quantity</dt><dd className="font-medium">{r.quantity}</dd></div>
            {r.preferredSize && <div className="flex justify-between gap-3"><dt className="text-slate-500">Size</dt><dd className="font-medium">{r.preferredSize}</dd></div>}
            {r.preferredColor && <div className="flex justify-between gap-3"><dt className="text-slate-500">Colour</dt><dd className="font-medium">{r.preferredColor}</dd></div>}
            {r.destinationCountry && <div className="flex justify-between gap-3"><dt className="text-slate-500">Deliver to</dt><dd className="font-medium">{r.destinationCountry}</dd></div>}
          </dl>
          {r.productUrl && <a href={r.productUrl} target="_blank" rel="noopener noreferrer nofollow" className="flex items-center gap-1.5 break-all font-semibold text-royal-600 hover:underline"><ExternalLink className="h-4 w-4 shrink-0" aria-hidden />Supplier link</a>}
          {r.instructions && <p className="whitespace-pre-line rounded-lg bg-surface p-3 text-slate-700">{r.instructions}</p>}
          {OPEN_REQUEST.includes(r.status) && (confirming ? (
            <div role="alertdialog" aria-label="Confirm cancellation" className="rounded-xl border border-red-200 bg-red-50 p-3">
              <p className="text-red-900">Cancel this request? Any open quotation will be withdrawn.</p>
              <div className="mt-2 flex gap-2"><Button size="sm" variant="danger" loading={cancel.isPending} onClick={() => cancel.mutate(r.id, { onSuccess: () => toast.info('Request cancelled.'), onError: (e) => toast.error(errorMessage(e)) })}>Yes, cancel</Button><Button size="sm" variant="outline" onClick={() => setConfirming(false)}>Keep</Button></div>
            </div>
          ) : <Button variant="ghost" size="sm" className="text-red-600 hover:bg-red-50" onClick={() => setConfirming(true)}>Cancel request</Button>)}
        </aside>
      </div>
    </div>
  )
}
