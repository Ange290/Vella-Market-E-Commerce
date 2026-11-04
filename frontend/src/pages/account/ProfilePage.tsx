import { zodResolver } from '@hookform/resolvers/zod'
import { useState } from 'react'
import { useForm } from 'react-hook-form'
import { z } from 'zod'
import { Button } from '@/components/ui/Button'
import { SelectField, TextField } from '@/components/ui/Field'
import { PasswordField } from '@/components/ui/PasswordField'
import { ErrorState, FormError, Skeleton } from '@/components/ui/feedback'
import { useChangePassword, useMe, useUpdateProfile } from '@/features/account/hooks'
import { usePageTitle } from '@/hooks/usePageTitle'
import { errorMessage, tokenStore } from '@/lib/api'
import { COUNTRIES } from '@/lib/countries'
import { useCurrency } from '@/lib/currency'
import { formatDate } from '@/lib/format'
import { useToast } from '@/lib/toast'
import type { MeProfile } from '@/types/api'

const profileSchema = z.object({
  fullName: z.string().trim().min(2, 'Enter your full name').max(100),
  country: z.string().length(2, 'Choose your country'),
  preferredCurrency: z.string().length(3),
})

const passwordSchema = z
  .object({
    currentPassword: z.string().min(1, 'Enter your current password'),
    newPassword: z.string().min(10, 'Use at least 10 characters').max(128).regex(/[A-Za-z]/, 'Include at least one letter').regex(/\d/, 'Include at least one number'),
    confirmPassword: z.string().min(1, 'Confirm your new password'),
  })
  .refine((d) => d.newPassword === d.confirmPassword, { path: ['confirmPassword'], message: 'Passwords do not match' })

function ProfileForm({ me }: { me: MeProfile }) {
  const toast = useToast()
  const update = useUpdateProfile()
  const { options, currency, setCurrency } = useCurrency()
  const [error, setError] = useState<string | null>(null)
  const { register, handleSubmit, formState: { errors, isDirty } } = useForm<z.infer<typeof profileSchema>>({
    resolver: zodResolver(profileSchema),
    defaultValues: { fullName: me.profile?.fullName ?? '', country: me.profile?.country ?? 'RW', preferredCurrency: me.profile?.preferredCurrency ?? currency },
  })

  const onSubmit = handleSubmit((v) => {
    setError(null)
    update.mutate(v, {
      onSuccess: () => { setCurrency(v.preferredCurrency); toast.success('Profile updated.') },
      onError: (e) => setError(errorMessage(e)),
    })
  })

  return (
    <form onSubmit={onSubmit} noValidate className="space-y-4">
      <FormError message={error} />
      <TextField label="Full name" autoComplete="name" error={errors.fullName?.message} {...register('fullName')} />
      <div className="grid gap-4 sm:grid-cols-2">
        <TextField label="Email address" value={me.email} readOnly disabled hint="Contact support to change your email." />
        <TextField label="Phone number" value={me.phone ?? '—'} readOnly disabled hint="Contact support to change your phone." />
      </div>
      <div className="grid gap-4 sm:grid-cols-2">
        <SelectField label="Country" error={errors.country?.message} {...register('country')}>
          {COUNTRIES.map((c) => <option key={c.code} value={c.code}>{c.name}</option>)}
        </SelectField>
        <SelectField label="Display currency" hint="Prices are shown in this currency when a rate is available." error={errors.preferredCurrency?.message} {...register('preferredCurrency')}>
          {options.map((c) => <option key={c.code} value={c.code}>{c.code} — {c.name}</option>)}
        </SelectField>
      </div>
      <p className="text-xs text-slate-500">Member since {formatDate(me.createdAt)}</p>
      <Button type="submit" loading={update.isPending} disabled={!isDirty}>Save changes</Button>
    </form>
  )
}

function PasswordForm() {
  const toast = useToast()
  const change = useChangePassword()
  const [error, setError] = useState<string | null>(null)
  const { register, handleSubmit, reset, formState: { errors } } = useForm<z.infer<typeof passwordSchema>>({ resolver: zodResolver(passwordSchema) })

  const onSubmit = handleSubmit((v) => {
    setError(null)
    change.mutate({ currentPassword: v.currentPassword, newPassword: v.newPassword }, {
      onSuccess: (res) => {
        tokenStore.set(res.accessToken) // this device stays signed in; every other device is signed out by the server
        reset()
        toast.success('Password changed. Other devices have been signed out.')
      },
      onError: (e) => setError(errorMessage(e)),
    })
  })

  return (
    <form onSubmit={onSubmit} noValidate className="space-y-4">
      <FormError message={error} />
      <PasswordField label="Current password" autoComplete="current-password" error={errors.currentPassword?.message} {...register('currentPassword')} />
      <PasswordField label="New password" autoComplete="new-password" hint="At least 10 characters, with a letter and a number." error={errors.newPassword?.message} {...register('newPassword')} />
      <PasswordField label="Confirm new password" autoComplete="new-password" error={errors.confirmPassword?.message} {...register('confirmPassword')} />
      <Button type="submit" variant="secondary" loading={change.isPending}>Change password</Button>
    </form>
  )
}

export function ProfilePage() {
  usePageTitle('My profile')
  const { data: me, isPending, isError, refetch } = useMe()
  return (
    <div className="mx-auto max-w-3xl px-4 py-8">
      <h1 className="text-2xl font-extrabold text-navy-900 sm:text-3xl">My profile</h1>
      <section aria-labelledby="details-h" className="mt-6 rounded-2xl border border-slate-200 bg-white p-6">
        <h2 id="details-h" className="mb-4 font-bold text-navy-900">Personal details</h2>
        {isPending ? <Skeleton className="h-64" /> : isError ? <ErrorState onRetry={() => void refetch()} /> : <ProfileForm me={me} />}
      </section>
      <section aria-labelledby="pw-h" className="mt-6 rounded-2xl border border-slate-200 bg-white p-6">
        <h2 id="pw-h" className="mb-4 font-bold text-navy-900">Password</h2>
        <PasswordForm />
      </section>
    </div>
  )
}
