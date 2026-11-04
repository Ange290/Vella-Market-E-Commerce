import { zodResolver } from '@hookform/resolvers/zod'
import { useForm } from 'react-hook-form'
import { z } from 'zod'
import { Button } from '@/components/ui/Button'
import { SelectField, TextField } from '@/components/ui/Field'
import type { AddressInput } from '@/features/orders/hooks'
import { COUNTRIES } from '@/lib/countries'

const schema = z.object({
  label: z.string().trim().max(40).optional(),
  recipientName: z.string().trim().min(2, 'Enter the recipient\'s full name').max(100),
  phone: z.string().trim().regex(/^\+[1-9]\d{6,14}$/, 'Include the country code, e.g. +250788123456'),
  country: z.string().length(2, 'Choose a country'),
  region: z.string().trim().max(100).optional(),
  city: z.string().trim().min(2, 'Enter the city').max(100),
  street: z.string().trim().min(3, 'Enter the street address').max(200),
  postalCode: z.string().trim().max(20).optional(),
  isDefault: z.boolean().optional(),
})
type Values = z.infer<typeof schema>

interface Props {
  defaultValues?: Partial<Values>
  submitLabel?: string
  onSubmit: (values: AddressInput) => Promise<void> | void
  onCancel?: () => void
  showDefaultToggle?: boolean
}

/** Delivery-address form shared by checkout and the address book. */
export function AddressForm({ defaultValues, submitLabel = 'Save address', onSubmit, onCancel, showDefaultToggle = true }: Props) {
  const { register, handleSubmit, formState: { errors, isSubmitting } } = useForm<Values>({
    resolver: zodResolver(schema),
    defaultValues: { country: 'RW', label: 'Home', ...defaultValues },
  })

  const submit = handleSubmit(async (v) => {
    await onSubmit({
      label: v.label || undefined,
      recipientName: v.recipientName,
      phone: v.phone.replace(/[\s()-]/g, ''),
      country: v.country,
      region: v.region || undefined,
      city: v.city,
      street: v.street,
      postalCode: v.postalCode || undefined,
      isDefault: v.isDefault,
    })
  })

  return (
    <form onSubmit={submit} noValidate className="space-y-4">
      <div className="grid gap-4 sm:grid-cols-2">
        <TextField label="Label" placeholder="Home, Office…" error={errors.label?.message} {...register('label')} />
        <TextField label="Recipient name" autoComplete="name" error={errors.recipientName?.message} {...register('recipientName')} />
      </div>
      <div className="grid gap-4 sm:grid-cols-2">
        <TextField label="Phone number" type="tel" autoComplete="tel" placeholder="+250788123456" error={errors.phone?.message} {...register('phone')} />
        <SelectField label="Country" error={errors.country?.message} {...register('country')}>
          {COUNTRIES.map((c) => <option key={c.code} value={c.code}>{c.name}</option>)}
        </SelectField>
      </div>
      <TextField label="Street address" autoComplete="street-address" error={errors.street?.message} {...register('street')} />
      <div className="grid gap-4 sm:grid-cols-3">
        <TextField label="City" autoComplete="address-level2" error={errors.city?.message} {...register('city')} />
        <TextField label="Region (optional)" autoComplete="address-level1" error={errors.region?.message} {...register('region')} />
        <TextField label="Postal code (optional)" autoComplete="postal-code" error={errors.postalCode?.message} {...register('postalCode')} />
      </div>
      {showDefaultToggle && (
        <label className="flex items-center gap-2 text-sm text-slate-700">
          <input type="checkbox" className="h-4 w-4 rounded border-slate-300" {...register('isDefault')} /> Make this my default address
        </label>
      )}
      <div className="flex gap-3">
        <Button type="submit" loading={isSubmitting}>{submitLabel}</Button>
        {onCancel && <Button type="button" variant="ghost" onClick={onCancel}>Cancel</Button>}
      </div>
    </form>
  )
}
