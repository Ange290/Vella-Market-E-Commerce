import { zodResolver } from '@hookform/resolvers/zod'
import { useState } from 'react'
import { useForm } from 'react-hook-form'
import { Link, useNavigate } from 'react-router-dom'
import { z } from 'zod'
import { Button } from '@/components/ui/Button'
import { TextField } from '@/components/ui/Field'
import { PasswordField } from '@/components/ui/PasswordField'
import { FormError } from '@/components/ui/feedback'
import { AuthShell, authLink } from '@/features/auth/AuthShell'
import { api, errorMessage } from '@/lib/api'
import { useToast } from '@/lib/toast'

const emailSchema = z.object({ email: z.email('Enter a valid email address').trim() })
const resetSchema = z
  .object({
    code: z.string().regex(/^\d{6}$/, 'Enter the 6-digit code'),
    newPassword: z.string().min(10, 'Use at least 10 characters').max(128).regex(/[A-Za-z]/, 'Include at least one letter').regex(/\d/, 'Include at least one number'),
    confirmPassword: z.string().min(1, 'Confirm your new password'),
  })
  .refine((d) => d.newPassword === d.confirmPassword, { path: ['confirmPassword'], message: 'Passwords do not match' })

export function ForgotPasswordPage() {
  const toast = useToast()
  const navigate = useNavigate()
  const [email, setEmail] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)

  const emailForm = useForm<z.infer<typeof emailSchema>>({ resolver: zodResolver(emailSchema) })
  const resetForm = useForm<z.infer<typeof resetSchema>>({ resolver: zodResolver(resetSchema) })

  const requestCode = emailForm.handleSubmit(async (v) => {
    setError(null)
    try {
      await api('/auth/forgot-password', { method: 'POST', auth: false, body: { email: v.email.toLowerCase() } })
      setEmail(v.email.toLowerCase())
    } catch (err) {
      setError(errorMessage(err))
    }
  })

  const reset = resetForm.handleSubmit(async (v) => {
    setError(null)
    try {
      await api('/auth/reset-password', { method: 'POST', auth: false, body: { email, code: v.code, newPassword: v.newPassword } })
      toast.success('Password updated. Please log in with your new password.')
      navigate('/login', { replace: true })
    } catch (err) {
      setError(errorMessage(err))
    }
  })

  const footer = (
    <Link to="/login" className={authLink}>
      Back to log in
    </Link>
  )

  if (!email) {
    return (
      <AuthShell title="Forgot your password?" subtitle="Enter your email and we will send you a code to reset it." footer={footer}>
        <form onSubmit={requestCode} noValidate className="space-y-4">
          <FormError message={error} />
          <TextField label="Email address" type="email" autoComplete="email" error={emailForm.formState.errors.email?.message} {...emailForm.register('email')} />
          <Button type="submit" size="lg" className="w-full" loading={emailForm.formState.isSubmitting}>
            Send reset code
          </Button>
        </form>
      </AuthShell>
    )
  }

  return (
    <AuthShell title="Choose a new password" subtitle={`If an account exists for ${email}, we sent a 6-digit code. It expires in 5 minutes.`} footer={footer}>
      <form onSubmit={reset} noValidate className="space-y-4">
        <FormError message={error} />
        <TextField label="6-digit code" inputMode="numeric" autoComplete="one-time-code" maxLength={6} placeholder="123456" className="text-center text-xl font-semibold tracking-[0.5em]" error={resetForm.formState.errors.code?.message} {...resetForm.register('code')} />
        <PasswordField label="New password" autoComplete="new-password" hint="At least 10 characters, with a letter and a number." error={resetForm.formState.errors.newPassword?.message} {...resetForm.register('newPassword')} />
        <PasswordField label="Confirm new password" autoComplete="new-password" error={resetForm.formState.errors.confirmPassword?.message} {...resetForm.register('confirmPassword')} />
        <Button type="submit" size="lg" className="w-full" loading={resetForm.formState.isSubmitting}>
          Update password
        </Button>
        <button type="button" onClick={() => setEmail(null)} className={`${authLink} block w-full text-center text-sm`}>
          Use a different email
        </button>
      </form>
    </AuthShell>
  )
}
