import { ArrowRight, ClipboardCheck, CreditCard, PackageCheck, Search, ShieldCheck, Tag, Truck } from 'lucide-react'
import { Link } from 'react-router-dom'
import { ButtonLink } from '@/components/ui/Button'
import { Skeleton } from '@/components/ui/feedback'
import { ProductCard, ProductGrid, ProductGridSkeleton } from '@/features/catalog/components'
import { useCategories, useProducts, usePromotions } from '@/features/catalog/hooks'
import { usePageTitle } from '@/hooks/usePageTitle'

const features = [
  { icon: ShieldCheck, title: 'Secure payments', text: 'Mobile money and cards through a verified payment gateway.' },
  { icon: PackageCheck, title: 'Sourced for you', text: 'Send us a product link or photo and we quote you a transparent price.' },
  { icon: Truck, title: 'Tracked delivery', text: 'Follow every step from the supplier in China to your door.' },
]

const steps = [
  { icon: Search, title: 'Choose', text: 'Pick from our catalogue or send us a link to any product you want.' },
  { icon: CreditCard, title: 'Pay securely', text: 'See every charge up front, then pay by mobile money or card.' },
  { icon: ClipboardCheck, title: 'We buy & ship', text: 'We purchase from the supplier, inspect and ship it to you.' },
  { icon: Truck, title: 'Receive', text: 'Track the parcel until it is delivered to your address.' },
]

export function HomePage() {
  usePageTitle(undefined)
  const categories = useCategories()
  const latest = useProducts({ sort: 'newest', pageSize: 8 })
  const promotions = usePromotions()

  return (
    <>
      <section className="relative isolate overflow-hidden bg-navy-950 text-white">
        <img src="/images/hero-cargo.webp" alt="Aerial view of a container ship carrying colourful cargo across the ocean" className="absolute inset-0 -z-20 h-full w-full object-cover" fetchPriority="high" />
        <div className="absolute inset-0 -z-10 bg-gradient-to-r from-navy-950/95 via-navy-900/80 to-navy-900/30" />
        <div className="mx-auto max-w-7xl px-4 py-20 sm:py-32">
          <p className="mb-4 inline-block rounded-full bg-white/10 px-3 py-1 text-xs font-semibold uppercase tracking-wider text-accent-100">China → Rwanda &amp; beyond</p>
          <h1 className="max-w-3xl text-4xl font-extrabold leading-tight sm:text-5xl">
            Shop from China. <span className="text-accent-500">Delivered to you.</span>
          </h1>
          <p className="mt-5 max-w-xl text-lg text-slate-200">Browse our catalogue or request any product from a Chinese supplier. See every cost up front, pay securely, and track your order all the way home.</p>
          <div className="mt-8 flex flex-wrap gap-3">
            <ButtonLink to="/shop" size="lg">
              Start shopping <ArrowRight className="h-4 w-4" aria-hidden />
            </ButtonLink>
            <ButtonLink to="/request-product" size="lg" variant="outline" className="border-white/30 bg-transparent text-white hover:bg-white/10">
              Request a product
            </ButtonLink>
          </div>
        </div>
      </section>

      {promotions.data && promotions.data.length > 0 && (
        <section aria-label="Promotions" className="border-b border-accent-100 bg-accent-100/60">
          <div className="mx-auto flex max-w-7xl flex-col gap-2 px-4 py-3 sm:flex-row sm:items-center sm:justify-center sm:gap-6">
            {promotions.data.slice(0, 2).map((p) => {
              const inner = (
                <>
                  <Tag className="h-4 w-4 shrink-0 text-accent-600" aria-hidden />
                  <span className="font-semibold text-navy-900">{p.title}</span>
                  {p.subtitle && <span className="text-slate-700">{p.subtitle}</span>}
                  {p.couponCode && <span className="rounded bg-white px-2 py-0.5 font-mono text-xs font-bold text-accent-600">{p.couponCode}</span>}
                </>
              )
              const cls = 'flex flex-wrap items-center justify-center gap-2 text-sm'
              return p.linkUrl?.startsWith('/') ? (
                <Link key={p.id} to={p.linkUrl} className={`${cls} hover:underline`}>
                  {inner}
                </Link>
              ) : (
                <div key={p.id} className={cls}>
                  {inner}
                </div>
              )
            })}
          </div>
        </section>
      )}

      <section className="mx-auto grid max-w-7xl gap-6 px-4 py-14 md:grid-cols-3">
        {features.map(({ icon: Icon, title, text }) => (
          <div key={title} className="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm">
            <span className="grid h-11 w-11 place-items-center rounded-xl bg-royal-50 text-royal-600">
              <Icon className="h-5 w-5" aria-hidden />
            </span>
            <h2 className="mt-4 text-lg font-bold text-navy-900">{title}</h2>
            <p className="mt-1 text-sm text-slate-600">{text}</p>
          </div>
        ))}
      </section>

      <section className="mx-auto max-w-7xl px-4 pb-14" aria-labelledby="cats-title">
        <div className="mb-6 flex items-end justify-between">
          <h2 id="cats-title" className="text-2xl font-extrabold text-navy-900">Shop by category</h2>
          <Link to="/categories" className="text-sm font-semibold text-royal-600 hover:underline">All categories</Link>
        </div>
        {categories.isPending ? (
          <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-6">
            {Array.from({ length: 6 }, (_, i) => <Skeleton key={i} className="h-24" />)}
          </div>
        ) : categories.data && categories.data.length > 0 ? (
          <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-6">
            {categories.data.slice(0, 6).map((c) => (
              <Link key={c.id} to={`/shop?category=${c.slug}`} className="flex h-24 items-center justify-center rounded-2xl border border-slate-200 bg-gradient-to-br from-royal-50 to-white p-3 text-center text-sm font-bold text-navy-900 transition hover:border-royal-500 hover:shadow-md">
                {c.name}
              </Link>
            ))}
          </div>
        ) : null}
      </section>

      <section className="mx-auto max-w-7xl px-4 pb-14" aria-labelledby="new-title">
        <div className="mb-6 flex items-end justify-between">
          <h2 id="new-title" className="text-2xl font-extrabold text-navy-900">New arrivals</h2>
          <Link to="/shop" className="text-sm font-semibold text-royal-600 hover:underline">View all</Link>
        </div>
        {latest.isPending ? (
          <ProductGridSkeleton />
        ) : latest.data && latest.data.items.length > 0 ? (
          <ProductGrid>
            {latest.data.items.map((p) => (
              <ProductCard key={p.id} p={{ ...p, categoryName: p.category.name }} />
            ))}
          </ProductGrid>
        ) : (
          <p className="rounded-2xl border border-dashed border-slate-300 p-10 text-center text-sm text-slate-600">
            Our catalogue is being stocked. In the meantime you can <Link to="/request-product" className="font-semibold text-royal-600 hover:underline">request any product</Link> and we will quote it for you.
          </p>
        )}
      </section>

      <section className="bg-surface py-14" aria-labelledby="how-title">
        <div className="mx-auto max-w-7xl px-4">
          <h2 id="how-title" className="text-center text-2xl font-extrabold text-navy-900">How it works</h2>
          <ol className="mt-8 grid gap-6 sm:grid-cols-2 lg:grid-cols-4">
            {steps.map(({ icon: Icon, title, text }, i) => (
              <li key={title} className="rounded-2xl bg-white p-6 shadow-sm">
                <div className="flex items-center gap-3">
                  <span className="grid h-10 w-10 place-items-center rounded-full bg-navy-900 text-sm font-bold text-white">{i + 1}</span>
                  <Icon className="h-5 w-5 text-accent-500" aria-hidden />
                </div>
                <h3 className="mt-4 font-bold text-navy-900">{title}</h3>
                <p className="mt-1 text-sm text-slate-600">{text}</p>
              </li>
            ))}
          </ol>
        </div>
      </section>

      <section className="bg-navy-900 text-white">
        <div className="mx-auto flex max-w-7xl flex-col items-start justify-between gap-4 px-4 py-12 sm:flex-row sm:items-center">
          <div>
            <h2 className="text-2xl font-extrabold">Can't find what you need?</h2>
            <p className="mt-1 text-slate-300">Send us a link or a photo. We will find it, quote you, and ship it.</p>
          </div>
          <ButtonLink to="/request-product" size="lg">Request a product</ButtonLink>
        </div>
      </section>
    </>
  )
}
