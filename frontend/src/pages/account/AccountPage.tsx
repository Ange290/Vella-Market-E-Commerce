import { Bell, ClipboardList, Heart, MapPin, Package } from 'lucide-react'
import { Link, useNavigate } from 'react-router-dom'
import { Button, ButtonLink } from '@/components/ui/Button'
import { Skeleton } from '@/components/ui/feedback'
import { useMarkNotifications, useNotifications } from '@/features/account/hooks'
import { StatusBadge } from '@/features/orders/components'
import { useOrders } from '@/features/orders/hooks'
import { usePageTitle } from '@/hooks/usePageTitle'
import { useAuth } from '@/lib/auth'
import { formatDate, formatMoney } from '@/lib/format'
import type { NotificationItem } from '@/types/api'

const ACTIVE = ['AWAITING_PAYMENT', 'PENDING', 'PAID', 'PROCESSING', 'PURCHASED_FROM_SUPPLIER', 'SHIPPED_FROM_CHINA', 'ARRIVED_AT_DESTINATION_COUNTRY', 'OUT_FOR_DELIVERY']

function target(n: NotificationItem): string | null {
  if (n.data?.orderId) return `/account/orders/${n.data.orderId}`
  if (n.data?.requestId) return `/account/requests/${n.data.requestId}`
  return null
}

export function AccountPage() {
  usePageTitle('My account')
  const { user } = useAuth()
  const navigate = useNavigate()
  const orders = useOrders(1)
  const notifications = useNotifications()
  const mark = useMarkNotifications()

  const active = orders.data?.items.filter((o) => ACTIVE.includes(o.status)).length ?? 0
  const shortcut = 'flex items-center gap-3 rounded-2xl border border-slate-200 bg-white p-4 text-sm font-semibold text-navy-900 transition hover:border-royal-500 hover:shadow-md'

  return (
    <div className="mx-auto max-w-5xl px-4 py-8">
      <h1 className="text-2xl font-extrabold text-navy-900 sm:text-3xl">Hello{user?.fullName ? `, ${user.fullName.split(' ')[0]}` : ''} 👋</h1>
      <p className="mt-1 text-sm text-slate-600">Here is what's happening with your orders.</p>

      <div className="mt-6 grid grid-cols-2 gap-3 sm:grid-cols-4">
        <Link to="/account/orders" className={shortcut}><Package className="h-5 w-5 text-royal-600" aria-hidden /> Orders{orders.data && <span className="ml-auto rounded-full bg-royal-50 px-2 py-0.5 text-xs text-royal-700">{orders.data.total}</span>}</Link>
        <Link to="/account/requests" className={shortcut}><ClipboardList className="h-5 w-5 text-royal-600" aria-hidden /> Requests</Link>
        <Link to="/wishlist" className={shortcut}><Heart className="h-5 w-5 text-royal-600" aria-hidden /> Wishlist</Link>
        <Link to="/account/addresses" className={shortcut}><MapPin className="h-5 w-5 text-royal-600" aria-hidden /> Addresses</Link>
      </div>

      <div className="mt-8 grid gap-6 lg:grid-cols-[1fr_22rem]">
        <section aria-labelledby="recent-h" className="rounded-2xl border border-slate-200 bg-white p-5">
          <div className="flex items-center justify-between">
            <h2 id="recent-h" className="font-bold text-navy-900">Recent orders {active > 0 && <span className="ml-1 text-xs font-medium text-slate-500">({active} in progress)</span>}</h2>
            <Link to="/account/orders" className="text-sm font-semibold text-royal-600 hover:underline">View all</Link>
          </div>
          {orders.isPending ? <div className="mt-4 space-y-3"><Skeleton className="h-14" /><Skeleton className="h-14" /></div> : orders.data && orders.data.items.length > 0 ? (
            <ul className="mt-3 divide-y divide-slate-100">
              {orders.data.items.slice(0, 4).map((o) => (
                <li key={o.id}>
                  <Link to={`/account/orders/${o.id}`} className="flex items-center justify-between gap-3 py-3 hover:bg-slate-50">
                    <div><p className="font-mono text-sm font-bold text-navy-900">{o.orderNumber}</p><p className="text-xs text-slate-500">{formatDate(o.createdAt)}</p></div>
                    <div className="flex items-center gap-3"><StatusBadge status={o.status} /><span className="hidden text-sm font-semibold text-navy-900 sm:inline">{formatMoney({ amount: o.total, currency: o.currency })}</span></div>
                  </Link>
                </li>
              ))}
            </ul>
          ) : (
            <div className="py-8 text-center"><p className="text-sm text-slate-600">You haven't placed an order yet.</p><ButtonLink to="/shop" className="mt-4">Start shopping</ButtonLink></div>
          )}
        </section>

        <section aria-labelledby="notif-h" className="rounded-2xl border border-slate-200 bg-white p-5">
          <div className="flex items-center justify-between">
            <h2 id="notif-h" className="flex items-center gap-2 font-bold text-navy-900"><Bell className="h-4 w-4" aria-hidden /> Notifications {!!notifications.data?.unread && <span className="rounded-full bg-accent-500 px-2 py-0.5 text-xs text-white">{notifications.data.unread}</span>}</h2>
            {!!notifications.data?.unread && <Button variant="ghost" size="sm" onClick={() => mark.mutate(undefined)} loading={mark.isPending}>Mark all read</Button>}
          </div>
          {notifications.isPending ? <Skeleton className="mt-4 h-24" /> : notifications.data && notifications.data.items.length > 0 ? (
            <ul className="mt-3 space-y-1">
              {notifications.data.items.map((n) => {
                const to = target(n)
                const body = (
                  <>
                    <p className={`text-sm ${n.readAt ? 'text-slate-700' : 'font-semibold text-navy-900'}`}>{!n.readAt && <span className="mr-1.5 inline-block h-2 w-2 rounded-full bg-accent-500" aria-label="Unread" />}{n.title}</p>
                    <p className="line-clamp-2 text-xs text-slate-500">{n.body}</p>
                    <time dateTime={n.createdAt} className="text-[11px] text-slate-400">{formatDate(n.createdAt, true)}</time>
                  </>
                )
                return (
                  <li key={n.id}>
                    <button type="button" className="block w-full rounded-lg px-2 py-2 text-left hover:bg-slate-50" onClick={() => { if (!n.readAt) mark.mutate(n.id); if (to) navigate(to) }}>{body}</button>
                  </li>
                )
              })}
            </ul>
          ) : <p className="mt-4 text-sm text-slate-500">You're all caught up.</p>}
        </section>
      </div>
    </div>
  )
}
