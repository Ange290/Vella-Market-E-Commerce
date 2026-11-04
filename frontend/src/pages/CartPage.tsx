import { AlertTriangle, Minus, Plus, ShoppingBag, Trash2 } from 'lucide-react'
import { Link, useNavigate } from 'react-router-dom'
import { Button, ButtonLink } from '@/components/ui/Button'
import { EmptyState, ErrorState, Skeleton } from '@/components/ui/feedback'
import { ProductImage } from '@/features/catalog/components'
import { useCart } from '@/features/catalog/hooks'
import { useRemoveCartItem, useUpdateCartItem } from '@/features/orders/hooks'
import { usePageTitle } from '@/hooks/usePageTitle'
import { errorMessage } from '@/lib/api'
import { formatMoney } from '@/lib/format'
import { useToast } from '@/lib/toast'
import type { CartItem } from '@/types/api'

function Line({ item }: { item: CartItem }) {
  const toast = useToast()
  const update = useUpdateCartItem()
  const remove = useRemoveCartItem()
  const busy = update.isPending || remove.isPending
  const max = Math.max(1, Math.min(item.available, 99))
  const options = [item.size && `Size ${item.size}`, item.color].filter(Boolean).join(' · ')

  const setQty = (quantity: number) => update.mutate({ id: item.id, quantity }, { onError: (e) => toast.error(errorMessage(e)) })

  return (
    <li className="flex gap-4 py-5">
      <Link to={`/products/${item.slug}`} className="h-24 w-24 shrink-0 overflow-hidden rounded-xl border border-slate-200 bg-slate-100">
        <ProductImage image={item.image} name={item.name} className="h-full w-full" />
      </Link>
      <div className="flex min-w-0 flex-1 flex-col gap-2">
        <div className="flex justify-between gap-3">
          <div className="min-w-0">
            <Link to={`/products/${item.slug}`} className="line-clamp-2 font-semibold text-navy-900 hover:text-royal-600">{item.name}</Link>
            {options && <p className="text-sm text-slate-500">{options}</p>}
            <p className="text-sm text-slate-500">{formatMoney(item.unitPrice, item.unitPriceCny)} each</p>
          </div>
          <p className="shrink-0 font-bold text-navy-900">{formatMoney(item.lineTotal, item.lineTotalCny)}</p>
        </div>
        {item.issue && (
          <p role="alert" className="flex items-center gap-1.5 text-sm font-medium text-red-600"><AlertTriangle className="h-4 w-4" aria-hidden /> {item.issue.message}</p>
        )}
        <div className="mt-auto flex items-center justify-between">
          <div className="inline-flex items-center rounded-full border border-slate-300" role="group" aria-label={`Quantity of ${item.name}`}>
            <button type="button" aria-label="Decrease quantity" disabled={busy || item.quantity <= 1} onClick={() => setQty(item.quantity - 1)} className="grid h-9 w-9 place-items-center rounded-l-full hover:bg-slate-50 disabled:opacity-40"><Minus className="h-4 w-4" /></button>
            <span className="w-9 text-center text-sm font-semibold" aria-live="polite">{item.quantity}</span>
            <button type="button" aria-label="Increase quantity" disabled={busy || item.quantity >= max} onClick={() => setQty(item.quantity + 1)} className="grid h-9 w-9 place-items-center rounded-r-full hover:bg-slate-50 disabled:opacity-40"><Plus className="h-4 w-4" /></button>
          </div>
          <button type="button" disabled={busy} onClick={() => remove.mutate(item.id, { onSuccess: () => toast.info(`Removed ${item.name}.`), onError: (e) => toast.error(errorMessage(e)) })} className="inline-flex items-center gap-1.5 text-sm font-medium text-slate-500 hover:text-red-600 disabled:opacity-50">
            <Trash2 className="h-4 w-4" aria-hidden /> Remove
          </button>
        </div>
      </div>
    </li>
  )
}

export function CartPage() {
  usePageTitle('Shopping cart')
  const navigate = useNavigate()
  const { data: cart, isPending, isError, refetch } = useCart()

  if (isPending) return <div className="mx-auto max-w-5xl space-y-4 px-4 py-10">{[0, 1, 2].map((i) => <Skeleton key={i} className="h-28" />)}</div>
  if (isError) return <ErrorState onRetry={() => void refetch()} />
  if (cart.items.length === 0) {
    return <EmptyState icon={<ShoppingBag className="h-6 w-6" />} title="Your cart is empty" text="Find something you like and add it to your cart." action={<ButtonLink to="/shop">Start shopping</ButtonLink>} />
  }

  const blocked = cart.items.some((i) => i.issue)
  return (
    <div className="mx-auto max-w-6xl px-4 py-8">
      <h1 className="text-2xl font-extrabold text-navy-900 sm:text-3xl">Shopping cart <span className="text-base font-medium text-slate-500">({cart.itemCount} {cart.itemCount === 1 ? 'item' : 'items'})</span></h1>
      <div className="mt-6 grid gap-8 lg:grid-cols-[1fr_22rem]">
        <ul className="divide-y divide-slate-200 rounded-2xl border border-slate-200 bg-white px-5">
          {cart.items.map((i) => <Line key={i.id} item={i} />)}
        </ul>
        <aside className="h-fit rounded-2xl border border-slate-200 bg-white p-5" aria-label="Order summary">
          <h2 className="font-bold text-navy-900">Summary</h2>
          <dl className="mt-4 space-y-2 text-sm">
            <div className="flex justify-between"><dt className="text-slate-600">Subtotal</dt><dd className="font-semibold text-navy-900">{formatMoney(cart.subtotal, cart.subtotalCny)}</dd></div>
            <div className="flex justify-between text-slate-500"><dt>Shipping, service fee &amp; taxes</dt><dd>At checkout</dd></div>
          </dl>
          <p className="mt-3 text-xs text-slate-500">You will see every charge itemised before you pay.</p>
          {blocked && <p role="alert" className="mt-3 text-sm font-medium text-red-600">Please fix the items marked above to continue.</p>}
          <Button size="lg" className="mt-5 w-full" disabled={blocked} onClick={() => navigate('/checkout')}>Proceed to checkout</Button>
          <Link to="/shop" className="mt-3 block text-center text-sm font-semibold text-royal-600 hover:underline">Continue shopping</Link>
        </aside>
      </div>
    </div>
  )
}
