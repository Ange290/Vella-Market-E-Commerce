import { AlertTriangle, Banknote, CreditCard, Lock, MapPin, Plus, Smartphone, Tag, Truck } from 'lucide-react'
import { useEffect, useMemo, useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { Button, ButtonLink } from '@/components/ui/Button'
import { TextAreaField, TextField } from '@/components/ui/Field'
import { EmptyState, ErrorState, FormError, Skeleton } from '@/components/ui/feedback'
import { ProductImage } from '@/features/catalog/components'
import { useCart } from '@/features/catalog/hooks'
import { AddressForm } from '@/features/orders/AddressForm'
import { METHOD_LABEL, SummaryRow } from '@/features/orders/components'
import { useAddresses, useCreateAddress, useInitiatePayment, usePlaceOrder, useQuote, useShippingOptions } from '@/features/orders/hooks'
import { usePageTitle } from '@/hooks/usePageTitle'
import { ApiError, errorMessage } from '@/lib/api'
import { useCurrency } from '@/lib/currency'
import { daysRange, formatMoney } from '@/lib/format'
import { useToast } from '@/lib/toast'
import type { DeliveryMethod, PaymentMethod } from '@/types/api'

const DELIVERY_LABEL: Record<DeliveryMethod, string> = {
  STANDARD: 'Standard delivery',
  EXPRESS: 'Express delivery',
  AIR_FREIGHT: 'Air freight',
  SEA_FREIGHT: 'Sea freight',
  PICKUP: 'Pick-up',
}

const PAYMENT_OPTIONS: { value: PaymentMethod; hint: string; icon: typeof Smartphone }[] = [
  { value: 'MTN_MOBILE_MONEY', hint: 'Pay from your MTN wallet (RWF)', icon: Smartphone },
  { value: 'AIRTEL_MONEY', hint: 'Pay from your Airtel wallet (RWF)', icon: Smartphone },
  { value: 'CARD', hint: 'Visa, Mastercard — handled securely by our payment partner', icon: CreditCard },
  { value: 'BANK_TRANSFER', hint: 'Pay by bank transfer', icon: Banknote },
]

function Section({ number, title, children }: { number: number; title: string; children: React.ReactNode }) {
  return (
    <section className="rounded-2xl border border-slate-200 bg-white p-5 sm:p-6" aria-labelledby={`step-${number}`}>
      <h2 id={`step-${number}`} className="mb-4 flex items-center gap-3 text-lg font-bold text-navy-900">
        <span className="grid h-7 w-7 place-items-center rounded-full bg-navy-900 text-sm text-white">{number}</span>
        {title}
      </h2>
      {children}
    </section>
  )
}

export function CheckoutPage() {
  usePageTitle('Checkout')
  const navigate = useNavigate()
  const toast = useToast()
  const { currency } = useCurrency()
  const { data: cart, isPending: cartPending, isError: cartError, refetch: refetchCart } = useCart()
  const addresses = useAddresses()
  const createAddress = useCreateAddress()
  const placeOrder = usePlaceOrder()
  const initiate = useInitiatePayment()

  const [addressId, setAddressId] = useState<string>()
  const [adding, setAdding] = useState(false)
  const [method, setMethod] = useState<DeliveryMethod>()
  const [paymentMethod, setPaymentMethod] = useState<PaymentMethod>('MTN_MOBILE_MONEY')
  const [couponInput, setCouponInput] = useState('')
  const [coupon, setCoupon] = useState<string>()
  const [note, setNote] = useState('')
  const [agreed, setAgreed] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [working, setWorking] = useState(false)

  // Re-price whenever cart contents change.
  const cartSignature = useMemo(() => (cart ? cart.items.map((i) => `${i.id}:${i.quantity}`).join('|') : ''), [cart])

  // Default to the user's default (or first) address.
  useEffect(() => {
    if (!addressId && addresses.data && addresses.data.length > 0) setAddressId((addresses.data.find((a) => a.isDefault) ?? addresses.data[0]).id)
  }, [addresses.data, addressId])

  const options = useShippingOptions(addressId, currency, cartSignature)
  useEffect(() => {
    const opts = options.data?.options
    if (!opts) return
    if (!method || !opts.find((o) => o.method === method)?.available) setMethod(opts.find((o) => o.available)?.method)
  }, [options.data, method])

  const quoteInput = addressId && method ? { addressId, deliveryMethod: method, currency, couponCode: coupon } : null
  const quote = useQuote(quoteInput, cartSignature)
  const quoteError = quote.error instanceof ApiError ? quote.error : null

  const mobileMoney = paymentMethod === 'MTN_MOBILE_MONEY' || paymentMethod === 'AIRTEL_MONEY'
  const currencyMismatch = mobileMoney && currency !== 'RWF'

  if (cartPending || addresses.isPending) return <div className="mx-auto max-w-6xl space-y-4 px-4 py-10"><Skeleton className="h-40" /><Skeleton className="h-40" /></div>
  if (cartError || addresses.isError) return <ErrorState onRetry={() => { void refetchCart(); void addresses.refetch() }} />
  if (cart.items.length === 0) {
    return <EmptyState title="Your cart is empty" text="Add something to your cart before checking out." action={<ButtonLink to="/shop">Browse products</ButtonLink>} />
  }

  const q = quote.data
  const ready = !!q && q.canCheckout && !quote.isFetching && agreed && !currencyMismatch && !!quoteInput

  const applyCoupon = () => {
    const code = couponInput.trim().toUpperCase()
    setCoupon(code || undefined)
  }

  const submit = async () => {
    if (!quoteInput) return
    setError(null)
    setWorking(true)
    let orderId: string | undefined
    try {
      const order = await placeOrder.mutateAsync({ ...quoteInput, customerNote: note.trim() || undefined })
      orderId = order.id
      // Retry-safe: the same order + method always yields the same idempotency key.
      const payment = await initiate.mutateAsync({ orderId: order.id, method: paymentMethod, key: `pay-${order.id}-${paymentMethod}` })
      if (payment.checkoutUrl) {
        if (payment.checkoutUrl.startsWith('/')) navigate(payment.checkoutUrl)
        else window.location.assign(payment.checkoutUrl)
        return
      }
      throw new Error('No payment link returned')
    } catch (err) {
      if (orderId) {
        // The order exists; payment can be retried from the order page.
        toast.error(`Your order was placed, but we could not start the payment: ${errorMessage(err)} You can pay from your order page.`)
        navigate(`/account/orders/${orderId}`)
      } else {
        const message = errorMessage(err)
        setError(message)
        toast.error(message)
        void refetchCart()
        void quote.refetch()
      }
    } finally {
      setWorking(false)
    }
  }

  const addressList = addresses.data
  return (
    <div className="mx-auto max-w-6xl px-4 py-8">
      <h1 className="text-2xl font-extrabold text-navy-900 sm:text-3xl">Checkout</h1>
      <div className="mt-6 grid gap-8 lg:grid-cols-[1fr_24rem]">
        <div className="space-y-6">
          <Section number={1} title="Delivery address">
            {addressList.length > 0 && !adding && (
              <fieldset>
                <legend className="sr-only">Choose a delivery address</legend>
                <div className="grid gap-3 sm:grid-cols-2">
                  {addressList.map((a) => (
                    <label key={a.id} className={`flex cursor-pointer gap-3 rounded-xl border p-4 text-sm transition-colors ${addressId === a.id ? 'border-navy-900 bg-royal-50/50 ring-1 ring-navy-900' : 'border-slate-200 hover:border-slate-300'}`}>
                      <input type="radio" name="address" className="mt-1" checked={addressId === a.id} onChange={() => setAddressId(a.id)} />
                      <span>
                        <span className="flex items-center gap-1.5 font-semibold text-navy-900"><MapPin className="h-4 w-4" aria-hidden />{a.label}{a.isDefault && <span className="rounded bg-royal-100 px-1.5 text-[10px] font-bold uppercase text-royal-700">Default</span>}</span>
                        <span className="mt-1 block text-slate-700">{a.recipientName}</span>
                        <span className="block text-slate-600">{a.street}, {a.city}{a.region ? `, ${a.region}` : ''}, {a.country}</span>
                        <span className="block text-slate-500">{a.phone}</span>
                      </span>
                    </label>
                  ))}
                </div>
                <Button variant="ghost" size="sm" className="mt-3" icon={<Plus className="h-4 w-4" aria-hidden />} onClick={() => setAdding(true)}>Add a new address</Button>
              </fieldset>
            )}
            {(addressList.length === 0 || adding) && (
              <AddressForm
                submitLabel="Save and use this address"
                showDefaultToggle={addressList.length > 0}
                onCancel={addressList.length > 0 ? () => setAdding(false) : undefined}
                onSubmit={async (v) => {
                  try {
                    const a = await createAddress.mutateAsync(v)
                    setAddressId(a.id)
                    setAdding(false)
                    toast.success('Address saved.')
                  } catch (err) {
                    toast.error(errorMessage(err))
                  }
                }}
              />
            )}
          </Section>

          <Section number={2} title="Delivery method">
            {!addressId ? <p className="text-sm text-slate-500">Choose an address first.</p> : options.isPending ? <Skeleton className="h-24" /> : options.isError ? (
              <FormError message={options.error instanceof ApiError ? options.error.message : 'We could not load delivery options.'} />
            ) : (
              <fieldset>
                <legend className="sr-only">Choose a delivery method</legend>
                <div className="space-y-3">
                  {options.data.options.map((o) => (
                    <label key={o.method} className={`flex items-start gap-3 rounded-xl border p-4 text-sm ${!o.available ? 'cursor-not-allowed border-dashed border-slate-200 bg-slate-50 text-slate-400' : method === o.method ? 'cursor-pointer border-navy-900 bg-royal-50/50 ring-1 ring-navy-900' : 'cursor-pointer border-slate-200 hover:border-slate-300'}`}>
                      <input type="radio" name="delivery" className="mt-1" disabled={!o.available} checked={method === o.method} onChange={() => setMethod(o.method)} />
                      <span className="flex-1">
                        <span className="flex items-center gap-2 font-semibold"><Truck className="h-4 w-4" aria-hidden />{DELIVERY_LABEL[o.method]}</span>
                        <span className="block text-xs">{o.available ? (o.estimatedDays?.min != null && o.estimatedDays?.max != null ? `Estimated ${daysRange(o.estimatedDays.min, o.estimatedDays.max)} after we ship` : 'Delivery time confirmed after shipping') : (o.reason ?? 'Not available')}</span>
                      </span>
                      {o.fee && <span className="font-semibold text-navy-900">{formatMoney(o.fee)}</span>}
                    </label>
                  ))}
                </div>
              </fieldset>
            )}
          </Section>

          <Section number={3} title="Payment method">
            <fieldset>
              <legend className="sr-only">Choose how to pay</legend>
              <div className="grid gap-3 sm:grid-cols-2">
                {PAYMENT_OPTIONS.map(({ value, hint, icon: Icon }) => (
                  <label key={value} className={`flex cursor-pointer gap-3 rounded-xl border p-4 text-sm ${paymentMethod === value ? 'border-navy-900 bg-royal-50/50 ring-1 ring-navy-900' : 'border-slate-200 hover:border-slate-300'}`}>
                    <input type="radio" name="payment" className="mt-1" checked={paymentMethod === value} onChange={() => setPaymentMethod(value)} />
                    <span><span className="flex items-center gap-2 font-semibold text-navy-900"><Icon className="h-4 w-4" aria-hidden />{METHOD_LABEL[value]}</span><span className="block text-xs text-slate-500">{hint}</span></span>
                  </label>
                ))}
              </div>
            </fieldset>
            {currencyMismatch && (
              <p role="alert" className="mt-3 flex gap-2 rounded-lg bg-amber-50 p-3 text-sm text-amber-900"><AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" aria-hidden />Mobile money is paid in RWF. Switch the display currency (top of the page) to RWF, or pay by card.</p>
            )}
            <p className="mt-3 flex items-center gap-1.5 text-xs text-slate-500"><Lock className="h-3.5 w-3.5" aria-hidden /> You will complete the payment on our payment partner's secure page. We never see or store your card details.</p>
          </Section>

          <Section number={4} title="Notes & discount">
            <div className="flex gap-2">
              <div className="flex-1"><TextField label="Discount code" value={couponInput} onChange={(e) => setCouponInput(e.target.value)} placeholder="Enter code" onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); applyCoupon() } }} /></div>
              <Button variant="outline" className="mt-[26px]" icon={<Tag className="h-4 w-4" aria-hidden />} onClick={applyCoupon}>Apply</Button>
            </div>
            <div className="mt-4"><TextAreaField label="Note for our team (optional)" rows={2} maxLength={500} value={note} onChange={(e) => setNote(e.target.value)} /></div>
          </Section>
        </div>

        <aside className="h-fit space-y-4 rounded-2xl border border-slate-200 bg-white p-5 lg:sticky lg:top-24" aria-label="Order summary" aria-busy={quote.isFetching}>
          <h2 className="font-bold text-navy-900">Order summary</h2>
          <ul className="max-h-56 space-y-3 overflow-y-auto pr-1">
            {cart.items.map((i) => (
              <li key={i.id} className="flex gap-3 text-sm">
                <div className="h-12 w-12 shrink-0 overflow-hidden rounded-lg border border-slate-200"><ProductImage image={i.image} name={i.name} className="h-full w-full" /></div>
                <div className="min-w-0 flex-1"><p className="line-clamp-1 font-medium text-navy-900">{i.name}</p><p className="text-xs text-slate-500">{[i.size, i.color].filter(Boolean).join(' · ')} × {i.quantity}</p></div>
              </li>
            ))}
          </ul>

          {quote.isPending && quoteInput ? <Skeleton className="h-40" /> : quoteError ? (
            <div role="alert" className="rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-800">
              <p className="font-semibold">We can't price this order yet</p>
              <p className="mt-1">{quoteError.message}</p>
              {quoteError.code === 'CURRENCY_UNAVAILABLE' && <p className="mt-1">Try a different display currency from the menu at the top.</p>}
            </div>
          ) : q ? (
            <>
              <dl className={`space-y-2 ${quote.isFetching ? 'opacity-60' : ''}`}>
                <SummaryRow label="Subtotal" value={formatMoney(q.breakdown.subtotal)} />
                <SummaryRow label={q.breakdown.shipping.label} value={formatMoney(q.breakdown.shipping.amount)} />
                <SummaryRow label={q.breakdown.serviceFee.label} value={formatMoney(q.breakdown.serviceFee.amount)} />
                {q.breakdown.taxes.map((t) => <SummaryRow key={t.label} label={t.label} value={formatMoney(t.amount)} />)}
                {q.breakdown.discount && <SummaryRow label={`Discount (${q.breakdown.discount.code})`} value={`− ${formatMoney(q.breakdown.discount.amount)}`} />}
                <SummaryRow strong label="Total" value={formatMoney(q.breakdown.total)} />
              </dl>
              <p className="text-xs text-slate-500">Prices converted at 1 CNY = {q.exchangeRate.rate} {q.exchangeRate.to}. Shipping is based on a parcel weight of {(q.breakdown.shipping.weightGrams / 1000).toFixed(2)} kg.</p>
              {q.issues.length > 0 && (
                <ul role="alert" className="space-y-1 rounded-lg bg-red-50 p-3 text-sm text-red-800">
                  {q.issues.map((i, n) => <li key={n}>{i.message}</li>)}
                  {q.issues.some((i) => !i.code.startsWith('COUPON')) && <li><Link to="/cart" className="font-semibold underline">Update your cart</Link></li>}
                </ul>
              )}
            </>
          ) : (
            <p className="text-sm text-slate-500">Choose an address and delivery method to see your total.</p>
          )}

          <label className="flex items-start gap-2 text-xs text-slate-600">
            <input type="checkbox" checked={agreed} onChange={(e) => setAgreed(e.target.checked)} className="mt-0.5 h-4 w-4 rounded border-slate-300" />
            <span>I agree to the <Link to="/terms" className="font-semibold text-royal-600 underline" target="_blank">Terms &amp; Conditions</Link> and <Link to="/privacy" className="font-semibold text-royal-600 underline" target="_blank">Privacy Policy</Link>.</span>
          </label>
          <FormError message={error} />
          <Button size="lg" className="w-full" disabled={!ready} loading={working} onClick={submit} icon={<Lock className="h-4 w-4" aria-hidden />}>
            {q ? `Place order & pay ${formatMoney(q.breakdown.total)}` : 'Place order & pay'}
          </Button>
        </aside>
      </div>
    </div>
  )
}
