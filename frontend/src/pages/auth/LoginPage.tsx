import { useState, type FormEvent } from 'react'
import { Link, useLocation, useNavigate } from 'react-router-dom'
import { Button } from '@/components/ui/Button'
import { TextField } from '@/components/ui/Field'
import { PasswordField } from '@/components/ui/PasswordField'
import { FormError } from '@/components/ui/feedback'
import { AuthFooterLink, AuthShell, authLink } from '@/features/auth/AuthShell'
import { api, ApiError, errorMessage } from '@/lib/api'
import { useAuth } from '@/lib/auth'
import { useToast } from '@/lib/toast'

type Mode = 'password' | 'code'

export function LoginPage() {
  const { login, loginWithCode } = useAuth()
  const toast = useToast()
  const navigate = useNavigate()
  const from = (useLocation().state as { from?: string } | null)?.from ?? '/account'

  const [mode, setMode] = useState<Mode>('password')
  const [identifier, setIdentifier] = useState('')
  const [password, setPassword] = useState('')
  const [code, setCode] = useState('')
  const [codeSent, setCodeSent] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [unverified, setUnverified] = useState(false)
  const [busy, setBusy] = useState(false)

  const switchMode = (m: Mode) => {
    setMode(m)
    setError(null)
    setUnverified(false)
    setCodeSent(false)
    setCode('')
  }

  const fail = (err: unknown) => {
    if (err instanceof ApiError && err.code === 'ACCOUNT_NOT_VERIFIED') {
      setUnverified(true)
      setError('Your account is not verified yet. Verify your email to continue.')
    } else {
      setError(errorMessage(err))
    }
  }

  const done = (name: string | null) => {
    toast.success(`Welcome back${name ? `, ${name.split(' ')[0]}` : ''}!`)
    navigate(from, { replace: true })
  }

  const submitPassword = async (e: FormEvent) => {
    e.preventDefault()
    setError(null)
    setUnverified(false)
    if (!identifier.trim() || !password) return setError('Enter your email or phone number and your password.')
    setBusy(true)
    try {
      done((await login(identifier.trim(), password)).fullName)
    } catch (err) {
      fail(err)
    } finally {
      setBusy(false)
    }
  }

  const requestCode = async (e: FormEvent) => {
    e.preventDefault()
    setError(null)
    if (!identifier.trim()) return setError('Enter your email address or phone number.')
    setBusy(true)
    try {
      await api('/auth/login/otp/request', { method: 'POST', auth: false, body: { identifier: identifier.trim() } })
      setCodeSent(true)
      toast.success('If an account exists, a login code is on its way.')
    } catch (err) {
      fail(err)
    } finally {
      setBusy(false)
    }
  }

  const submitCode = async (e: FormEvent) => {
    e.preventDefault()
    setError(null)
    if (!/^\d{6}$/.test(code)) return setError('Enter the 6-digit code.')
    setBusy(true)
    try {
      done((await loginWithCode(identifier.trim(), code)).fullName)
    } catch (err) {
      fail(err)
    } finally {
      setBusy(false)
    }
  }

  const tab = (m: Mode, label: string) => (
    <button type="button" role="tab" aria-selected={mode === m} onClick={() => switchMode(m)} className={`flex-1 rounded-full px-3 py-2 text-sm font-semibold transition-colors ${mode === m ? 'bg-white text-navy-900 shadow-sm' : 'text-slate-600 hover:text-slate-900'}`}>
      {label}
    </button>
  )

  return (
    <AuthShell title="Welcome back" subtitle="Log in to track orders and check out faster." footer={<AuthFooterLink text="New to Vella Market?" to="/register" label="Create an account" />}>
      <div role="tablist" aria-label="Login method" className="mb-5 flex rounded-full bg-slate-100 p-1">
        {tab('password', 'Password')}
        {tab('code', 'Email code')}
      </div>

      <div className="space-y-4">
        <FormError message={error} />
        {unverified && (
          <Link to="/verify-otp" state={{ email: identifier.includes('@') ? identifier.trim().toLowerCase() : undefined }} className={`${authLink} block text-sm`}>
            Verify my account →
          </Link>
        )}
      </div>

      {mode === 'password' ? (
        <form onSubmit={submitPassword} noValidate className="mt-4 space-y-4">
          <TextField label="Email or phone number" autoComplete="username" placeholder="you@example.com or +250788123456" value={identifier} onChange={(e) => setIdentifier(e.target.value)} />
          <PasswordField label="Password" autoComplete="current-password" value={password} onChange={(e) => setPassword(e.target.value)} />
          <div className="text-right">
            <Link to="/forgot-password" className={`${authLink} text-sm`}>
              Forgot password?
            </Link>
          </div>
          <Button type="submit" size="lg" className="w-full" loading={busy}>
            Log in
          </Button>
        </form>
      ) : !codeSent ? (
        <form onSubmit={requestCode} noValidate className="mt-4 space-y-4">
          <TextField label="Email address" autoComplete="username" placeholder="you@example.com" hint="We will email you a one-time login code." value={identifier} onChange={(e) => setIdentifier(e.target.value)} />
          <Button type="submit" size="lg" className="w-full" loading={busy}>
            Send me a code
          </Button>
        </form>
      ) : (
        <form onSubmit={submitCode} noValidate className="mt-4 space-y-4">
          <TextField label="6-digit code" inputMode="numeric" autoComplete="one-time-code" maxLength={6} placeholder="123456" value={code} onChange={(e) => setCode(e.target.value.replace(/\D/g, '').slice(0, 6))} className="text-center text-xl font-semibold tracking-[0.5em]" autoFocus />
          <Button type="submit" size="lg" className="w-full" loading={busy}>
            Log in
          </Button>
          <button type="button" onClick={() => setCodeSent(false)} className={`${authLink} block w-full text-center text-sm`}>
            Use a different email
          </button>
        </form>
      )}
    </AuthShell>
  )
}
