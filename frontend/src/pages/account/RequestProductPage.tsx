import { zodResolver } from '@hookform/resolvers/zod'
import { ImagePlus, Link2, X } from 'lucide-react'
import { useEffect, useRef, useState } from 'react'
import { useForm } from 'react-hook-form'
import { Link, useNavigate } from 'react-router-dom'
import { z } from 'zod'
import { Button } from '@/components/ui/Button'
import { SelectField, TextAreaField, TextField } from '@/components/ui/Field'
import { FormError } from '@/components/ui/feedback'
import { useCreateRequest } from '@/features/account/hooks'
import { usePageTitle } from '@/hooks/usePageTitle'
import { errorMessage } from '@/lib/api'
import { COUNTRIES } from '@/lib/countries'
import { useToast } from '@/lib/toast'

const MAX_IMAGE = 5 * 1024 * 1024
const IMAGE_TYPES = ['image/jpeg', 'image/png', 'image/webp']

const schema = z.object({
  productUrl: z.string().trim().refine((v) => v === '' || /^https?:\/\/\S+$/i.test(v), 'Enter a full link starting with http:// or https://'),
  title: z.string().trim().max(200).optional(),
  quantity: z.number('Enter a quantity').int('Whole numbers only').min(1, 'At least 1').max(999, 'At most 999'),
  preferredSize: z.string().trim().max(60).optional(),
  preferredColor: z.string().trim().max(60).optional(),
  instructions: z.string().trim().max(1500).optional(),
  destinationCountry: z.string().length(2),
})
type Values = z.infer<typeof schema>

export function RequestProductPage() {
  usePageTitle('Request a product')
  const navigate = useNavigate()
  const toast = useToast()
  const create = useCreateRequest()
  const fileRef = useRef<HTMLInputElement>(null)
  const [image, setImage] = useState<File | null>(null)
  const [preview, setPreview] = useState<string | null>(null)
  const [imageError, setImageError] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const { register, handleSubmit, formState: { errors } } = useForm<Values>({ resolver: zodResolver(schema), defaultValues: { quantity: 1, destinationCountry: 'RW', productUrl: '' } })

  useEffect(() => {
    if (!image) return setPreview(null)
    const url = URL.createObjectURL(image)
    setPreview(url)
    return () => URL.revokeObjectURL(url)
  }, [image])

  const pick = (file: File | undefined) => {
    setImageError(null)
    if (!file) return
    if (!IMAGE_TYPES.includes(file.type)) return setImageError('Please choose a JPEG, PNG or WebP image.')
    if (file.size > MAX_IMAGE) return setImageError('That image is larger than 5 MB.')
    setImage(file)
  }

  const onSubmit = handleSubmit((v) => {
    setError(null)
    if (!v.productUrl && !image) return setError('Add a product link, a photo, or both so we know what to look for.')
    const form = new FormData()
    form.append('quantity', String(v.quantity))
    form.append('destinationCountry', v.destinationCountry)
    for (const key of ['productUrl', 'title', 'preferredSize', 'preferredColor', 'instructions'] as const) {
      const value = v[key]
      if (value) form.append(key, value)
    }
    if (image) form.append('image', image)
    create.mutate(form, {
      onSuccess: (r) => {
        toast.success('Request sent! We will reply with a quotation.')
        navigate(`/account/requests/${r.id}`)
      },
      onError: (e) => setError(errorMessage(e)),
    })
  })

  return (
    <div className="mx-auto grid max-w-5xl gap-10 px-4 py-10 lg:grid-cols-[1fr_18rem]">
      <div>
        <h1 className="text-2xl font-extrabold text-navy-900 sm:text-3xl">Request a product</h1>
        <p className="mt-2 text-slate-600">Found something on a Chinese marketplace, or have a photo of what you want? Tell us and we will send you a price including shipping and fees.</p>

        <form onSubmit={onSubmit} noValidate className="mt-6 space-y-5">
          <FormError message={error} />

          <fieldset className="space-y-4 rounded-2xl border border-slate-200 p-5">
            <legend className="px-1 text-sm font-bold text-navy-900">What do you want? <span className="font-normal text-slate-500">(link, photo, or both)</span></legend>
            <TextField label="Product link" type="url" inputMode="url" placeholder="https://detail.1688.com/offer/…" error={errors.productUrl?.message} {...register('productUrl')} />
            <div>
              <p className="mb-1.5 text-sm font-medium text-slate-700">Product photo</p>
              {preview ? (
                <div className="flex items-center gap-4">
                  <img src={preview} alt="Selected product" className="h-24 w-24 rounded-xl border border-slate-200 object-cover" />
                  <Button type="button" variant="outline" size="sm" icon={<X className="h-4 w-4" aria-hidden />} onClick={() => { setImage(null); if (fileRef.current) fileRef.current.value = '' }}>Remove photo</Button>
                </div>
              ) : (
                <button type="button" onClick={() => fileRef.current?.click()} className="flex w-full flex-col items-center gap-1 rounded-xl border-2 border-dashed border-slate-300 px-4 py-6 text-sm text-slate-600 transition-colors hover:border-royal-500 hover:bg-royal-50/40">
                  <ImagePlus className="h-6 w-6 text-slate-400" aria-hidden />
                  <span className="font-semibold text-royal-600">Upload a photo</span>
                  <span className="text-xs text-slate-500">JPEG, PNG or WebP, up to 5 MB</span>
                </button>
              )}
              <input ref={fileRef} type="file" accept={IMAGE_TYPES.join(',')} className="sr-only" aria-label="Upload a product photo" onChange={(e) => pick(e.target.files?.[0])} />
              {imageError && <p role="alert" className="mt-1 text-xs font-medium text-red-600">{imageError}</p>}
            </div>
          </fieldset>

          <TextField label="Product name (optional)" placeholder="e.g. Wireless earbuds" error={errors.title?.message} {...register('title')} />
          <div className="grid gap-4 sm:grid-cols-3">
            <TextField label="Quantity" type="number" min={1} max={999} inputMode="numeric" error={errors.quantity?.message} {...register('quantity', { valueAsNumber: true })} />
            <TextField label="Size (optional)" error={errors.preferredSize?.message} {...register('preferredSize')} />
            <TextField label="Colour (optional)" error={errors.preferredColor?.message} {...register('preferredColor')} />
          </div>
          <SelectField label="Deliver to" error={errors.destinationCountry?.message} {...register('destinationCountry')}>
            {COUNTRIES.map((c) => <option key={c.code} value={c.code}>{c.name}</option>)}
          </SelectField>
          <TextAreaField label="Anything else we should know? (optional)" rows={4} placeholder="Specifications, quality requirements, deadline…" error={errors.instructions?.message} {...register('instructions')} />
          <Button type="submit" size="lg" loading={create.isPending} icon={<Link2 className="h-4 w-4" aria-hidden />}>Send request</Button>
        </form>
      </div>

      <aside className="h-fit rounded-2xl bg-surface p-6 text-sm">
        <h2 className="font-bold text-navy-900">How it works</h2>
        <ol className="mt-3 list-decimal space-y-2 pl-5 text-slate-600">
          <li>You send us the link or photo.</li>
          <li>We check the supplier and reply with a quotation: product cost, shipping, service fee and taxes.</li>
          <li>Accept it and pay securely. We buy, ship and track it to you.</li>
        </ol>
        <p className="mt-4 text-xs text-slate-500">Quotations are free and have no obligation. <Link to="/account/requests" className="font-semibold text-royal-600 hover:underline">See your requests</Link></p>
      </aside>
    </div>
  )
}
