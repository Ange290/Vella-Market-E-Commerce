import { useState, type FormEvent } from 'react'
import { Link, useLocation, useNavigate } from 'react-router-dom'
import { Button } from '@/components/ui/Button'
import { TextField } from '@/components/ui/Field'
import { FormError } from '@/components/ui/feedback'
import { AuthShell, authLink, useCountdown } from '@/features/auth/AuthShell'
import { api, errorMessage } from '@/lib/api'
import { useAuth } from '@/lib/auth'
import { useToast } from '@/lib/toast'

interface LocationState {
  email?: string
  cooldown?: number
}

export function VerifyOtpPage() {
  const { verifyRegistration } = useAuth()
  const toast = useToast()
  const navigate = useNavigate()
  const state = (useLocation().state as LocationState | null) ?? {}
  const [email, setEmail] = useState(state.email ?? '')
  const [code, setCode] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [resending, setResending] = useState(false)
  const [cooldown, setCooldown] = useCountdown(state.cooldown ?? 0)

  const submit = async (e: FormEvent) => {
    e.preventDefault()
    setError(null)
    if (!/^\d{6}$/.test(code)) return setError('Enter the 6-digit code from your email.')
    if (!email) return setError('Enter the email address you registered with.')
    setBusy(true)
    try {
      const user = await verifyRegistration(email.trim().toLowerCase(), code)
      toast.success(`Welcome to Vella Market${user.fullName ? `, ${user.fullName.split(' ')[0]}` : ''}!`)
      navigate('/account', { replace: true })
    } catch (err) {
      setError(errorMessage(err))
    } finally {
      setBusy(false)
    }
  }

  const resend = async () => {
    if (!email) return setError('Enter your email address first.')
    setError(null)
    setResending(true)
    try {
      const res = await api<{ resendAvailableInSeconds?: number }>('/auth/resend-otp', { method: 'POST', auth: false, body: { email: email.trim().toLowerCase() } })
      setCooldown(res.resendAvailableInSeconds ?? 60)
      toast.success('If your account is waiting for verification, a new code is on its way.')
    } catch (err) {
      setError(errorMessage(err))
      setCooldown(30)
    } finally {
      setResending(false)
    }
  }

  return (
    <AuthShell
      title="Verify your email"
      subtitle={state.email ? `We sent a 6-digit code to ${state.email}. It expires in 5 minutes.` : 'Enter the 6-digit code we emailed you. It expires in 5 minutes.'}
      footer={
        <Link to="/login" className={authLink}>
          Back to log in
        </Link>
      }
    >
      <form onSubmit={submit} noValidate className="space-y-4">
        <FormError message={error} />
        {!state.email && <TextField label="Email address" type="email" autoComplete="email" value={email} onChange={(e) => setEmail(e.target.value)} />}
        <TextField
          label="Verification code"
          inputMode="numeric"
          autoComplete="one-time-code"
          maxLength={6}
          placeholder="123456"
          value={code}
          onChange={(e) => setCode(e.target.value.replace(/\D/g, '').slice(0, 6))}
          className="text-center text-xl font-semibold tracking-[0.5em]"
          autoFocus
        />
        <Button type="submit" size="lg" className="w-full" loading={busy}>
          Verify and continue
        </Button>
      </form>
      <div className="mt-5 text-center text-sm text-slate-600">
        Didn't get it?{' '}
        <button type="button" onClick={resend} disabled={cooldown > 0 || resending} className={`${authLink} disabled:cursor-not-allowed disabled:text-slate-400 disabled:no-underline`}>
          {resending ? 'Sending…' : cooldown > 0 ? `Resend code in ${cooldown}s` : 'Resend code'}
        </button>
      </div>
    </AuthShell>
  )
}
