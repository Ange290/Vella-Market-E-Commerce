import { ShieldCheck } from 'lucide-react'
import { useEffect, useState, type ReactNode } from 'react'
import { Link } from 'react-router-dom'

/** Two-column frame shared by all authentication screens. */
export function AuthShell({ title, subtitle, children, footer }: { title: string; subtitle?: string; children: ReactNode; footer?: ReactNode }) {
  return (
    <div className="mx-auto grid min-h-[70vh] max-w-6xl items-center gap-10 px-4 py-10 lg:grid-cols-2 lg:py-16">
      <div className="hidden lg:block">
        <div className="relative overflow-hidden rounded-3xl bg-navy-950">
          <img src="/images/hero-cargo.webp" alt="" className="h-[28rem] w-full object-cover opacity-60" />
          <div className="absolute inset-0 bg-gradient-to-t from-navy-950 via-navy-950/40 to-transparent" />
          <div className="absolute inset-x-0 bottom-0 p-8 text-white">
            <p className="text-2xl font-extrabold leading-snug">Shop from China.<br />Delivered to you.</p>
            <p className="mt-3 flex items-center gap-2 text-sm text-slate-200">
              <ShieldCheck className="h-4 w-4 text-accent-500" aria-hidden /> Verified accounts, secure payments, tracked delivery.
            </p>
          </div>
        </div>
      </div>
      <div className="mx-auto w-full max-w-md">
        <h1 className="text-2xl font-extrabold text-navy-900">{title}</h1>
        {subtitle && <p className="mt-1.5 text-sm text-slate-600">{subtitle}</p>}
        <div className="mt-6">{children}</div>
        {footer && <div className="mt-6 text-center text-sm text-slate-600">{footer}</div>}
      </div>
    </div>
  )
}

export const authLink = 'font-semibold text-royal-600 hover:underline'

export function AuthFooterLink({ text, to, label }: { text: string; to: string; label: string }) {
  return (
    <>
      {text}{' '}
      <Link to={to} className={authLink}>
        {label}
      </Link>
    </>
  )
}

/** Counts down once per second; `start(n)` restarts it. */
export function useCountdown(initial = 0) {
  const [left, setLeft] = useState(initial)
  useEffect(() => {
    if (left <= 0) return
    const t = window.setTimeout(() => setLeft((s) => s - 1), 1000)
    return () => window.clearTimeout(t)
  }, [left])
  return [left, setLeft] as const
}
