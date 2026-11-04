import { Check, CircleAlert, MapPin, Package } from 'lucide-react'
import { formatDate } from '@/lib/format'
import type { OrderStatus, PaymentStatus, Shipment, ShipmentStatus, TimelineEntry } from '@/types/api'

export const STATUS_LABEL: Record<OrderStatus, string> = {
  PENDING: 'Pending',
  AWAITING_PAYMENT: 'Awaiting payment',
  PAID: 'Paid',
  PROCESSING: 'Processing',
  PURCHASED_FROM_SUPPLIER: 'Purchased from supplier',
  SHIPPED_FROM_CHINA: 'Shipped from China',
  ARRIVED_AT_DESTINATION_COUNTRY: 'Arrived in your country',
  OUT_FOR_DELIVERY: 'Out for delivery',
  DELIVERED: 'Delivered',
  CANCELLED: 'Cancelled',
  REFUNDED: 'Refunded',
}

const STATUS_TONE: Record<OrderStatus, string> = {
  PENDING: 'bg-slate-100 text-slate-700',
  AWAITING_PAYMENT: 'bg-amber-100 text-amber-800',
  PAID: 'bg-emerald-100 text-emerald-800',
  PROCESSING: 'bg-royal-100 text-royal-700',
  PURCHASED_FROM_SUPPLIER: 'bg-royal-100 text-royal-700',
  SHIPPED_FROM_CHINA: 'bg-indigo-100 text-indigo-700',
  ARRIVED_AT_DESTINATION_COUNTRY: 'bg-indigo-100 text-indigo-700',
  OUT_FOR_DELIVERY: 'bg-accent-100 text-accent-600',
  DELIVERED: 'bg-emerald-100 text-emerald-800',
  CANCELLED: 'bg-red-100 text-red-700',
  REFUNDED: 'bg-slate-200 text-slate-700',
}

export function StatusBadge({ status }: { status: OrderStatus }) {
  return <span className={`inline-flex items-center rounded-full px-2.5 py-1 text-xs font-semibold ${STATUS_TONE[status]}`}>{STATUS_LABEL[status]}</span>
}

const PAYMENT_TONE: Record<PaymentStatus, string> = {
  INITIATED: 'bg-slate-100 text-slate-700',
  PENDING: 'bg-amber-100 text-amber-800',
  SUCCESSFUL: 'bg-emerald-100 text-emerald-800',
  FAILED: 'bg-red-100 text-red-700',
  CANCELLED: 'bg-slate-100 text-slate-600',
  PARTIALLY_REFUNDED: 'bg-slate-200 text-slate-700',
  REFUNDED: 'bg-slate-200 text-slate-700',
}

export function PaymentBadge({ status }: { status: PaymentStatus }) {
  return <span className={`inline-flex rounded-full px-2.5 py-1 text-xs font-semibold ${PAYMENT_TONE[status]}`}>{status.replace(/_/g, ' ').toLowerCase().replace(/^\w/, (c) => c.toUpperCase())}</span>
}

export const METHOD_LABEL: Record<string, string> = {
  MTN_MOBILE_MONEY: 'MTN Mobile Money',
  AIRTEL_MONEY: 'Airtel Money',
  CARD: 'Bank card',
  BANK_TRANSFER: 'Bank transfer',
  OTHER: 'Other',
}

/** The happy path an order follows, used for the progress bar. */
const PROGRESS: { status: OrderStatus; label: string }[] = [
  { status: 'AWAITING_PAYMENT', label: 'Placed' },
  { status: 'PAID', label: 'Paid' },
  { status: 'PROCESSING', label: 'Processing' },
  { status: 'PURCHASED_FROM_SUPPLIER', label: 'Purchased' },
  { status: 'SHIPPED_FROM_CHINA', label: 'Shipped' },
  { status: 'ARRIVED_AT_DESTINATION_COUNTRY', label: 'Arrived' },
  { status: 'OUT_FOR_DELIVERY', label: 'Out for delivery' },
  { status: 'DELIVERED', label: 'Delivered' },
]

export function ProgressStepper({ status }: { status: OrderStatus }) {
  if (status === 'CANCELLED' || status === 'REFUNDED') {
    return (
      <div role="status" className={`flex items-center gap-2 rounded-xl px-4 py-3 text-sm font-medium ${status === 'CANCELLED' ? 'bg-red-50 text-red-800' : 'bg-slate-100 text-slate-700'}`}>
        <CircleAlert className="h-4 w-4" aria-hidden /> This order was {status === 'CANCELLED' ? 'cancelled' : 'refunded'}.
      </div>
    )
  }
  const current = Math.max(0, PROGRESS.findIndex((p) => p.status === (status === 'PENDING' ? 'AWAITING_PAYMENT' : status)))
  return (
    <ol className="flex" aria-label="Order progress">
      {PROGRESS.map((step, i) => {
        const done = i < current
        const active = i === current
        return (
          <li key={step.status} className="relative flex-1 text-center" aria-current={active ? 'step' : undefined}>
            {i > 0 && <span aria-hidden className={`absolute left-[-50%] top-3.5 h-0.5 w-full ${i <= current ? 'bg-emerald-500' : 'bg-slate-200'}`} />}
            <span className={`relative z-10 mx-auto grid h-7 w-7 place-items-center rounded-full text-xs font-bold ${done ? 'bg-emerald-500 text-white' : active ? 'bg-navy-900 text-white ring-4 ring-royal-100' : 'bg-slate-200 text-slate-500'}`}>
              {done ? <Check className="h-4 w-4" aria-hidden /> : i + 1}
            </span>
            <span className={`mt-1.5 hidden text-[11px] leading-tight sm:block ${active ? 'font-semibold text-navy-900' : 'text-slate-500'}`}>{step.label}</span>
            <span className="sr-only">{step.label}{done ? ' (done)' : active ? ' (current)' : ''}</span>
          </li>
        )
      })}
    </ol>
  )
}

export function OrderTimeline({ entries }: { entries: TimelineEntry[] }) {
  const ordered = [...entries].reverse() // newest first
  return (
    <ol className="relative space-y-5 border-l-2 border-slate-200 pl-6">
      {ordered.map((e, i) => (
        <li key={e.id} className="relative">
          <span aria-hidden className={`absolute -left-[31px] top-1 h-3 w-3 rounded-full ring-4 ring-white ${i === 0 ? 'bg-navy-900' : 'bg-slate-300'}`} />
          <p className="text-sm font-semibold text-navy-900">{STATUS_LABEL[e.status]}</p>
          {e.description && <p className="text-sm text-slate-600">{e.description}</p>}
          {e.trackingRef && <p className="text-xs text-slate-500">Tracking reference: <span className="font-mono font-semibold">{e.trackingRef}</span></p>}
          <time dateTime={e.createdAt} className="text-xs text-slate-400">{formatDate(e.createdAt, true)}</time>
        </li>
      ))}
    </ol>
  )
}

const SHIPMENT_LABEL: Record<ShipmentStatus, string> = {
  PENDING: 'Preparing',
  IN_TRANSIT: 'In transit',
  CUSTOMS: 'In customs',
  ARRIVED: 'Arrived',
  OUT_FOR_DELIVERY: 'Out for delivery',
  DELIVERED: 'Delivered',
  EXCEPTION: 'Issue reported',
}

export function ShipmentTracker({ shipment, index, total }: { shipment: Shipment; index: number; total: number }) {
  return (
    <div className="rounded-2xl border border-slate-200 p-5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="flex items-center gap-3">
          <span className="grid h-10 w-10 place-items-center rounded-xl bg-royal-50 text-royal-600"><Package className="h-5 w-5" aria-hidden /></span>
          <div>
            <p className="font-semibold text-navy-900">{total > 1 ? `Parcel ${index + 1} of ${total}` : 'Your parcel'}</p>
            <p className="text-xs text-slate-500">
              {shipment.carrier ?? 'Carrier to be confirmed'}
              {shipment.trackingNumber && <> · Tracking no. <span className="font-mono font-semibold text-slate-700">{shipment.trackingNumber}</span></>}
            </p>
          </div>
        </div>
        <span className={`rounded-full px-2.5 py-1 text-xs font-semibold ${shipment.status === 'EXCEPTION' ? 'bg-red-100 text-red-700' : shipment.status === 'DELIVERED' ? 'bg-emerald-100 text-emerald-800' : 'bg-royal-100 text-royal-700'}`}>{SHIPMENT_LABEL[shipment.status]}</span>
      </div>
      {shipment.estimatedDelivery && shipment.status !== 'DELIVERED' && <p className="mt-3 text-sm text-slate-600">Estimated delivery: <strong>{formatDate(shipment.estimatedDelivery)}</strong></p>}
      <ol className="mt-4 space-y-3">
        {shipment.events.map((ev) => (
          <li key={ev.id} className="flex gap-3 text-sm">
            <MapPin className="mt-0.5 h-4 w-4 shrink-0 text-slate-400" aria-hidden />
            <div>
              <p className="font-medium text-slate-800">{SHIPMENT_LABEL[ev.status]}{ev.location && <span className="font-normal text-slate-500"> · {ev.location}</span>}</p>
              {ev.description && <p className="text-slate-600">{ev.description}</p>}
              <time dateTime={ev.occurredAt} className="text-xs text-slate-400">{formatDate(ev.occurredAt, true)}</time>
            </div>
          </li>
        ))}
      </ol>
    </div>
  )
}

export function SummaryRow({ label, value, strong, muted }: { label: string; value: string; strong?: boolean; muted?: boolean }) {
  return (
    <div className={`flex justify-between gap-4 ${strong ? 'border-t border-slate-200 pt-3 text-base font-extrabold text-navy-900' : `text-sm ${muted ? 'text-slate-500' : 'text-slate-700'}`}`}>
      <dt>{label}</dt>
      <dd className={strong ? '' : 'font-medium'}>{value}</dd>
    </div>
  )
}
