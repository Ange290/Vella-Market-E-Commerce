import { zodResolver } from '@hookform/resolvers/zod'
import { CheckCircle2 } from 'lucide-react'
import { useState } from 'react'
import { useForm } from 'react-hook-form'
import { Link } from 'react-router-dom'
import { z } from 'zod'
import { Button, ButtonLink } from '@/components/ui/Button'
import { TextAreaField, TextField } from '@/components/ui/Field'
import { FormError } from '@/components/ui/feedback'
import { usePageTitle } from '@/hooks/usePageTitle'
import { api, errorMessage } from '@/lib/api'
import { useAuth } from '@/lib/auth'

const schema = z.object({
  name: z.string().trim().min(2, 'Enter your name').max(100),
  email: z.email('Enter a valid email address').trim(),
  subject: z.string().trim().min(3, 'Add a short subject').max(150),
  message: z.string().trim().min(10, 'Tell us a little more (at least 10 characters)').max(5000),
})
type Values = z.infer<typeof schema>

export function ContactPage() {
  usePageTitle('Contact us')
  const { user } = useAuth()
  const [sent, setSent] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const { register, handleSubmit, reset, formState: { errors, isSubmitting } } = useForm<Values>({
    resolver: zodResolver(schema),
    values: { name: user?.fullName ?? '', email: user?.email ?? '', subject: '', message: '' },
  })

  const onSubmit = handleSubmit(async (v) => {
    setError(null)
    try {
      await api('/support', { method: 'POST', auth: false, body: { ...v, email: v.email.toLowerCase() } })
      setSent(true)
      reset({ name: v.name, email: v.email, subject: '', message: '' })
    } catch (err) {
      setError(errorMessage(err))
    }
  })

  if (sent) {
    return (
      <div className="mx-auto max-w-lg px-4 py-20 text-center" role="status">
        <span className="mx-auto grid h-16 w-16 place-items-center rounded-full bg-emerald-100 text-emerald-600"><CheckCircle2 className="h-8 w-8" aria-hidden /></span>
        <h1 className="mt-5 text-2xl font-extrabold text-navy-900">Message sent</h1>
        <p className="mt-2 text-slate-600">Thanks for getting in touch. Our team will reply to your email address.</p>
        <div className="mt-8 flex justify-center gap-3"><ButtonLink to="/">Back to home</ButtonLink><Button variant="outline" onClick={() => setSent(false)}>Send another</Button></div>
      </div>
    )
  }

  return (
    <div className="mx-auto grid max-w-5xl gap-10 px-4 py-12 lg:grid-cols-[1fr_20rem]">
      <div>
        <h1 className="text-2xl font-extrabold text-navy-900 sm:text-3xl">Contact us</h1>
        <p className="mt-2 text-slate-600">Questions about an order, a product or a payment? Send us a message and we will reply by email.</p>
        <form onSubmit={onSubmit} noValidate className="mt-6 space-y-4">
          <FormError message={error} />
          <div className="grid gap-4 sm:grid-cols-2">
            <TextField label="Your name" autoComplete="name" error={errors.name?.message} {...register('name')} />
            <TextField label="Email address" type="email" autoComplete="email" error={errors.email?.message} {...register('email')} />
          </div>
          <TextField label="Subject" error={errors.subject?.message} {...register('subject')} />
          <TextAreaField label="Message" rows={6} error={errors.message?.message} {...register('message')} />
          <Button type="submit" size="lg" loading={isSubmitting}>Send message</Button>
        </form>
      </div>
      <aside className="h-fit rounded-2xl bg-surface p-6 text-sm">
        <h2 className="font-bold text-navy-900">Before you write</h2>
        <ul className="mt-3 space-y-2 text-slate-600">
          <li>Track a parcel on the <Link to="/track" className="font-semibold text-royal-600 hover:underline">Track Order</Link> page.</li>
          <li>Many answers are in our <Link to="/faq" className="font-semibold text-royal-600 hover:underline">FAQ</Link>.</li>
          <li>Include your order reference (like <span className="font-mono">VM-20261104-7K3QHD</span>) if your question is about an order.</li>
        </ul>
      </aside>
    </div>
  )
}
