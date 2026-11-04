import { CheckCircle2, Clock, XCircle } from 'lucide-react'
import { useSearchParams } from 'react-router-dom'
import { ButtonLink } from '@/components/ui/Button'
import { ErrorState, Spinner } from '@/components/ui/feedback'
import { METHOD_LABEL } from '@/features/orders/components'
import { usePaymentStatus } from '@/features/orders/hooks'
import { usePageTitle } from '@/hooks/usePageTitle'
import { formatMoney } from '@/lib/format'

/**
 * Where the payment provider sends the customer back to. The URL parameters are only a hint
 * to find the payment: the outcome shown comes from our server, which verifies with the provider.
 */
export function PaymentReturnPage() {
  usePageTitle('Payment status')
  const [params] = useSearchParams()
  const reference = params.get('tx_ref') ?? params.get('reference')
  const { data, isPending, isError, error, refetch } = usePaymentStatus(reference)

  if (!reference) return <ErrorState message="We could not tell which payment you are returning from. Check your orders for its status." />
  if (isPending) return <Spinner label="Confirming your payment" />
  if (isError) {
    return <ErrorState message={(error as Error).message || 'We could not check this payment.'} onRetry={() => void refetch()} />
  }

  const paid = data.status === 'SUCCESSFUL' || data.status === 'PARTIALLY_REFUNDED' || data.status === 'REFUNDED'
  const failed = data.status === 'FAILED' || data.status === 'CANCELLED'
  const amount = formatMoney({ amount: data.amount, currency: data.currency })

  return (
    <div className="mx-auto max-w-lg px-4 py-16 text-center" aria-live="polite">
      {paid ? (
        <>
          <span className="mx-auto grid h-16 w-16 place-items-center rounded-full bg-emerald-100 text-emerald-600"><CheckCircle2 className="h-8 w-8" aria-hidden /></span>
          <h1 className="mt-5 text-2xl font-extrabold text-navy-900">Payment received</h1>
          <p className="mt-2 text-slate-600">Thank you! We received {amount} via {METHOD_LABEL[data.method] ?? data.method}. We will start sourcing your order right away.</p>
        </>
      ) : failed ? (
        <>
          <span className="mx-auto grid h-16 w-16 place-items-center rounded-full bg-red-100 text-red-600"><XCircle className="h-8 w-8" aria-hidden /></span>
          <h1 className="mt-5 text-2xl font-extrabold text-navy-900">Payment didn't go through</h1>
          <p className="mt-2 text-slate-600">{data.failureReason === 'AMOUNT_OR_CURRENCY_MISMATCH' ? 'The amount paid did not match your order, so we could not accept it. Please contact support.' : 'No money was taken for this attempt. You can try again from your order.'}</p>
        </>
      ) : (
        <>
          <span className="mx-auto grid h-16 w-16 place-items-center rounded-full bg-amber-100 text-amber-600"><Clock className="h-8 w-8" aria-hidden /></span>
          <h1 className="mt-5 text-2xl font-extrabold text-navy-900">Waiting for confirmation</h1>
          <p className="mt-2 text-slate-600">We are waiting for your payment provider to confirm {amount}. If you approved a mobile-money prompt, this can take a minute. This page updates by itself.</p>
          <Spinner label="Checking" />
        </>
      )}
      <div className="mt-8 flex justify-center gap-3">
        <ButtonLink to={`/account/orders/${data.orderId}`}>View my order</ButtonLink>
        <ButtonLink to="/shop" variant="outline">Keep shopping</ButtonLink>
      </div>
    </div>
  )
}
