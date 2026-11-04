import { FlaskConical } from 'lucide-react'
import { useState } from 'react'
import { useNavigate, useSearchParams } from 'react-router-dom'
import { Button } from '@/components/ui/Button'
import { FormError } from '@/components/ui/feedback'
import { api, errorMessage } from '@/lib/api'

/**
 * DEVELOPMENT ONLY. Stands in for the payment provider's hosted page when the backend runs with
 * PAYMENT_PROVIDER=mock. This route is only registered in development builds; the backend endpoint
 * it calls is also refused in production.
 */
export function DevMockPayPage() {
  const [params] = useSearchParams()
  const navigate = useNavigate()
  const reference = params.get('reference')
  const [busy, setBusy] = useState<'successful' | 'failed' | null>(null)
  const [error, setError] = useState<string | null>(null)

  const run = async (outcome: 'successful' | 'failed') => {
    if (!reference) return
    setBusy(outcome)
    setError(null)
    try {
      await api(`/dev/payments/${encodeURIComponent(reference)}/simulate`, { method: 'POST', auth: false, body: { outcome } })
      navigate(`/payment/return?tx_ref=${encodeURIComponent(reference)}&status=${outcome}`)
    } catch (err) {
      setError(errorMessage(err))
      setBusy(null)
    }
  }

  return (
    <div className="mx-auto max-w-md px-4 py-16">
      <div className="rounded-2xl border-2 border-dashed border-amber-400 bg-amber-50 p-6 text-center">
        <span className="mx-auto grid h-12 w-12 place-items-center rounded-full bg-amber-200 text-amber-800"><FlaskConical className="h-6 w-6" aria-hidden /></span>
        <h1 className="mt-4 text-xl font-extrabold text-navy-900">Simulated payment page</h1>
        <p className="mt-2 text-sm text-amber-900">Development mock — no real money moves. In production, customers are sent to the real payment provider instead.</p>
        <p className="mt-3 break-all font-mono text-xs text-slate-600">{reference ?? 'missing reference'}</p>
        <div className="mt-5 space-y-3 text-left"><FormError message={error} /></div>
        <div className="mt-5 flex flex-col gap-3">
          <Button size="lg" disabled={!reference || busy !== null} loading={busy === 'successful'} onClick={() => run('successful')}>Simulate successful payment</Button>
          <Button size="lg" variant="outline" disabled={!reference || busy !== null} loading={busy === 'failed'} onClick={() => run('failed')}>Simulate failed payment</Button>
        </div>
      </div>
    </div>
  )
}
