import { zodResolver } from '@hookform/resolvers/zod'
import { useState } from 'react'
import { useForm, useWatch } from 'react-hook-form'
import { useNavigate } from 'react-router-dom'
import { z } from 'zod'
import { Button } from '@/components/ui/Button'
import { SelectField, TextField } from '@/components/ui/Field'
import { PasswordField } from '@/components/ui/PasswordField'
import { FormError } from '@/components/ui/feedback'
import { AuthFooterLink, AuthShell } from '@/features/auth/AuthShell'
import { api, errorMessage } from '@/lib/api'
import { COUNTRIES, countryByCode } from '@/lib/countries'

const passwordRule = z
  .string()
  .min(10, 'Use at least 10 characters')
  .max(128)
  .regex(/[A-Za-z]/, 'Include at least one letter')
  .regex(/\d/, 'Include at least one number')

const schema = z
  .object({
    fullName: z.string().trim().min(2, 'Enter your full name').max(100),
    email: z.email('Enter a valid email address').trim(),
    country: z.string().length(2, 'Choose your country'),
    phoneNumber: z.string().trim().regex(/^\d[\d ]{5,13}$/, 'Enter your phone number without the country code'),
    password: passwordRule,
    confirmPassword: z.string().min(1, 'Confirm your password'),
    addressLine: z.string().trim().min(3, 'Enter your street address').max(200),
    city: z.string().trim().min(2, 'Enter your city').max(100),
    region: z.string().trim().max(100).optional(),
    postalCode: z.string().trim().max(20).optional(),
  })
  .refine((d) => d.password === d.confirmPassword, { path: ['confirmPassword'], message: 'Passwords do not match' })

type FormValues = z.infer<typeof schema>

export function RegisterPage() {
  const navigate = useNavigate()
  const [serverError, setServerError] = useState<string | null>(null)
  const {
    register,
    handleSubmit,
    control,
    formState: { errors, isSubmitting },
  } = useForm<FormValues>({ resolver: zodResolver(schema), defaultValues: { country: 'RW' } })
  const country = countryByCode(useWatch({ control, name: 'country' }) ?? 'RW')

  const onSubmit = handleSubmit(async (v) => {
    setServerError(null)
    const national = v.phoneNumber.replace(/\s/g, '').replace(/^0+/, '')
    try {
      const res = await api<{ email: string; resendAvailableInSeconds: number }>('/auth/register', {
        method: 'POST',
        auth: false,
        body: {
          fullName: v.fullName,
          email: v.email.toLowerCase(),
          phone: `${country?.dial ?? '+250'}${national}`,
          password: v.password,
          confirmPassword: v.confirmPassword,
          country: v.country,
          addressLine: v.addressLine,
          city: v.city,
          region: v.region || undefined,
          postalCode: v.postalCode || undefined,
        },
      })
      navigate('/verify-otp', { state: { email: res.email, cooldown: res.resendAvailableInSeconds } })
    } catch (err) {
      setServerError(errorMessage(err))
    }
  })

  return (
    <AuthShell title="Create your account" subtitle="Shop from China and get your order delivered to you." footer={<AuthFooterLink text="Already have an account?" to="/login" label="Log in" />}>
      <form onSubmit={onSubmit} noValidate className="space-y-4">
        <FormError message={serverError} />
        <TextField label="Full name" autoComplete="name" error={errors.fullName?.message} {...register('fullName')} />
        <TextField label="Email address" type="email" autoComplete="email" error={errors.email?.message} {...register('email')} />
        <SelectField label="Country" autoComplete="country" error={errors.country?.message} {...register('country')}>
          {COUNTRIES.map((c) => (
            <option key={c.code} value={c.code}>
              {c.name}
            </option>
          ))}
        </SelectField>
        <TextField label="Phone number" type="tel" inputMode="tel" autoComplete="tel-national" prefix={country?.dial} placeholder="788 123 456" error={errors.phoneNumber?.message} {...register('phoneNumber')} />
        <PasswordField label="Password" autoComplete="new-password" hint="At least 10 characters, with a letter and a number." error={errors.password?.message} {...register('password')} />
        <PasswordField label="Confirm password" autoComplete="new-password" error={errors.confirmPassword?.message} {...register('confirmPassword')} />
        <fieldset className="space-y-4 rounded-xl border border-slate-200 p-4">
          <legend className="px-1 text-sm font-semibold text-navy-900">Delivery address</legend>
          <TextField label="Street address" autoComplete="street-address" error={errors.addressLine?.message} {...register('addressLine')} />
          <div className="grid gap-4 sm:grid-cols-2">
            <TextField label="City" autoComplete="address-level2" error={errors.city?.message} {...register('city')} />
            <TextField label="Region / District (optional)" autoComplete="address-level1" error={errors.region?.message} {...register('region')} />
          </div>
          <TextField label="Postal code (optional)" autoComplete="postal-code" error={errors.postalCode?.message} {...register('postalCode')} />
        </fieldset>
        <Button type="submit" size="lg" className="w-full" loading={isSubmitting}>
          Create account
        </Button>
        <p className="text-center text-xs text-slate-500">We will email you a 6-digit code to verify your account.</p>
      </form>
    </AuthShell>
  )
}
