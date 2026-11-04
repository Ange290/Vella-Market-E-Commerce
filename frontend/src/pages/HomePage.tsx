import { ArrowRight, PackageCheck, ShieldCheck, Truck } from 'lucide-react'
import { Link } from 'react-router-dom'

const features = [
  { icon: ShieldCheck, title: 'Secure payments', text: 'Mobile money and cards through a verified payment gateway.' },
  { icon: PackageCheck, title: 'Sourced for you', text: 'Send us a product link or photo and we quote you a transparent price.' },
  { icon: Truck, title: 'Tracked delivery', text: 'Follow every step from the supplier in China to your door.' },
]

export function HomePage() {
  return (
    <>
      <section className="relative isolate overflow-hidden bg-navy-950 text-white">
        <img
          src="/images/hero-cargo.webp"
          alt="Aerial view of a container ship carrying colourful cargo across the ocean"
          className="absolute inset-0 -z-20 h-full w-full object-cover"
          fetchPriority="high"
        />
        <div className="absolute inset-0 -z-10 bg-gradient-to-r from-navy-950/95 via-navy-900/80 to-navy-900/30" />
        <div className="mx-auto max-w-7xl px-4 py-20 sm:py-32">
          <p className="mb-4 inline-block rounded-full bg-white/10 px-3 py-1 text-xs font-semibold uppercase tracking-wider text-accent-100">
            China → Rwanda &amp; beyond
          </p>
          <h1 className="max-w-3xl text-4xl font-extrabold leading-tight sm:text-5xl">
            Shop from China. <span className="text-accent-500">Delivered to you.</span>
          </h1>
          <p className="mt-5 max-w-xl text-lg text-slate-200">
            Browse our catalogue or request any product from a Chinese supplier. See every cost up front, pay securely, and
            track your order all the way home.
          </p>
          <div className="mt-8 flex flex-wrap gap-3">
            <Link
              to="/shop"
              className="inline-flex items-center gap-2 rounded-full bg-accent-500 px-6 py-3 font-semibold text-white shadow-lg transition hover:bg-accent-600"
            >
              Start shopping <ArrowRight className="h-4 w-4" />
            </Link>
            <Link
              to="/request-product"
              className="inline-flex items-center rounded-full border border-white/30 px-6 py-3 font-semibold text-white transition hover:bg-white/10"
            >
              Request a product
            </Link>
          </div>
        </div>
      </section>

      <section className="mx-auto grid max-w-7xl gap-6 px-4 py-16 md:grid-cols-3">
        {features.map(({ icon: Icon, title, text }) => (
          <div key={title} className="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm">
            <span className="grid h-11 w-11 place-items-center rounded-xl bg-royal-50 text-royal-600">
              <Icon className="h-5 w-5" />
            </span>
            <h2 className="mt-4 text-lg font-bold text-navy-900">{title}</h2>
            <p className="mt-1 text-sm text-slate-600">{text}</p>
          </div>
        ))}
      </section>
    </>
  )
}
