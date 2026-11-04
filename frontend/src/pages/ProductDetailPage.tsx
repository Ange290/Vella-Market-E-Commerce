import { zodResolver } from '@hookform/resolvers/zod'
import { BadgeCheck, Clock, Minus, Plus, ShoppingCart, Store, Truck } from 'lucide-react'
import { useEffect, useMemo, useState } from 'react'
import { useForm } from 'react-hook-form'
import { Link, useLocation, useNavigate, useParams } from 'react-router-dom'
import { z } from 'zod'
import { Button, ButtonLink } from '@/components/ui/Button'
import { TextAreaField, TextField } from '@/components/ui/Field'
import { EmptyState, ErrorState, FormError, Skeleton } from '@/components/ui/feedback'
import { Pagination } from '@/components/ui/Pagination'
import { Price, ProductCard, ProductGrid, ProductImage, Stars, WishlistButton } from '@/features/catalog/components'
import { useAddToCart, useProduct, useRelated, useReviews, useSubmitReview } from '@/features/catalog/hooks'
import { usePageTitle } from '@/hooks/usePageTitle'
import { errorMessage } from '@/lib/api'
import { useAuth } from '@/lib/auth'
import { daysRange, formatDate } from '@/lib/format'
import { useToast } from '@/lib/toast'
import type { ProductDetail, ProductVariant } from '@/types/api'

const MAX_QTY = 99

function Chip({ label, selected, disabled, onClick }: { label: string; selected: boolean; disabled?: boolean; onClick: () => void }) {
  return (
    <button type="button" onClick={onClick} disabled={disabled} aria-pressed={selected} className={`min-w-12 rounded-lg border px-3 py-2 text-sm font-medium transition-colors ${selected ? 'border-navy-900 bg-navy-900 text-white' : 'border-slate-300 bg-white text-slate-700 hover:border-navy-900'} ${disabled ? 'cursor-not-allowed border-dashed text-slate-300 line-through hover:border-slate-300' : ''}`}>
      {label}
    </button>
  )
}

function Purchase({ product }: { product: ProductDetail }) {
  const { status } = useAuth()
  const navigate = useNavigate()
  const location = useLocation()
  const toast = useToast()
  const add = useAddToCart()
  const hasVariants = product.variants.length > 0
  const [size, setSize] = useState<string | null>(null)
  const [color, setColor] = useState<string | null>(null)
  const [qty, setQty] = useState(1)
  const [error, setError] = useState<string | null>(null)

  // Choose a variant once every option the product offers has been picked.
  const variant: ProductVariant | undefined = useMemo(() => {
    if (!hasVariants) return undefined
    if (product.sizes.length > 0 && !size) return undefined
    if (product.colors.length > 0 && !color) return undefined
    return product.variants.find((v) => (v.size ?? null) === (product.sizes.length ? size : null) && (v.color ?? null) === (product.colors.length ? color : null))
  }, [hasVariants, product, size, color])

  const available = hasVariants ? (variant?.stock ?? 0) : product.stock
  const optionInStock = (s: string | null, c: string | null) => product.variants.some((v) => (s === null || v.size === s) && (c === null || v.color === c) && v.stock > 0)

  useEffect(() => setQty((q) => Math.max(1, Math.min(q, available || 1, MAX_QTY))), [available])

  const price = variant ? { money: variant.displayPrice, cny: variant.finalPriceCny } : { money: product.displayPrice, cny: product.priceCny }
  const needsChoice = hasVariants && !variant

  const addToCart = () => {
    setError(null)
    if (status !== 'authenticated') {
      toast.info('Log in to add items to your cart.')
      return navigate('/login', { state: { from: location.pathname } })
    }
    if (needsChoice) return setError(`Please choose ${[product.sizes.length && !size ? 'a size' : '', product.colors.length && !color ? 'a colour' : ''].filter(Boolean).join(' and ')}.`)
    add.mutate(
      { productId: product.id, variantId: variant?.id, quantity: qty },
      { onSuccess: () => toast.success(`Added ${qty} × ${product.name} to your cart.`), onError: (err) => setError(errorMessage(err)) },
    )
  }

  return (
    <div className="space-y-5">
      <div>
        <Price money={price.money} fallbackCny={price.cny} className="text-3xl font-extrabold text-navy-900" />
        {price.money && <p className="text-xs text-slate-500">≈ ¥{Number(price.cny).toFixed(2)} supplier price. Shipping and fees are calculated at checkout.</p>}
        {!price.money && <p className="text-xs text-slate-500">Shipping and fees are calculated at checkout.</p>}
      </div>

      {product.sizes.length > 0 && (
        <div role="group" aria-label="Size">
          <p className="mb-2 text-sm font-semibold text-slate-700">Size{size && <span className="font-normal text-slate-500">: {size}</span>}</p>
          <div className="flex flex-wrap gap-2">
            {product.sizes.map((s) => <Chip key={s} label={s} selected={size === s} disabled={!optionInStock(s, product.colors.length ? color : null)} onClick={() => setSize(size === s ? null : s)} />)}
          </div>
        </div>
      )}
      {product.colors.length > 0 && (
        <div role="group" aria-label="Colour">
          <p className="mb-2 text-sm font-semibold text-slate-700">Colour{color && <span className="font-normal text-slate-500">: {color}</span>}</p>
          <div className="flex flex-wrap gap-2">
            {product.colors.map((c) => <Chip key={c} label={c} selected={color === c} disabled={!optionInStock(product.sizes.length ? size : null, c)} onClick={() => setColor(color === c ? null : c)} />)}
          </div>
        </div>
      )}

      <p className={`text-sm font-medium ${needsChoice ? 'text-slate-500' : available > 0 ? 'text-emerald-700' : 'text-red-600'}`}>
        {needsChoice ? 'Select your options to see availability' : available > 0 ? (available <= 5 ? `Only ${available} left` : 'In stock') : 'Out of stock'}
      </p>

      <div className="flex flex-wrap items-center gap-3">
        <div className="inline-flex items-center rounded-full border border-slate-300" role="group" aria-label="Quantity">
          <button type="button" aria-label="Decrease quantity" disabled={qty <= 1} onClick={() => setQty((q) => q - 1)} className="grid h-11 w-11 place-items-center rounded-l-full hover:bg-slate-50 disabled:opacity-40"><Minus className="h-4 w-4" /></button>
          <span className="w-10 text-center text-sm font-semibold" aria-live="polite">{qty}</span>
          <button type="button" aria-label="Increase quantity" disabled={qty >= Math.min(available, MAX_QTY)} onClick={() => setQty((q) => q + 1)} className="grid h-11 w-11 place-items-center rounded-r-full hover:bg-slate-50 disabled:opacity-40"><Plus className="h-4 w-4" /></button>
        </div>
        <Button size="lg" className="flex-1 sm:flex-none sm:px-10" onClick={addToCart} loading={add.isPending} disabled={!needsChoice && available <= 0} icon={<ShoppingCart className="h-5 w-5" aria-hidden />}>
          Add to cart
        </Button>
        <WishlistButton productId={product.id} className="h-11 w-11 border border-slate-300" />
      </div>
      <FormError message={error} />
    </div>
  )
}

const reviewSchema = z.object({
  rating: z.number().int().min(1, 'Choose a star rating').max(5),
  title: z.string().trim().max(120).optional(),
  comment: z.string().trim().max(2000).optional(),
})

function ReviewForm({ slug }: { slug: string }) {
  const toast = useToast()
  const submit = useSubmitReview(slug)
  const [error, setError] = useState<string | null>(null)
  const { register, handleSubmit, setValue, watch, reset, formState: { errors } } = useForm<z.infer<typeof reviewSchema>>({ resolver: zodResolver(reviewSchema), defaultValues: { rating: 0 } })
  const rating = watch('rating')

  const onSubmit = handleSubmit((v) => {
    setError(null)
    submit.mutate({ rating: v.rating, title: v.title || undefined, comment: v.comment || undefined }, {
      onSuccess: () => { toast.success('Thanks for your review!'); reset({ rating: 0, title: '', comment: '' }) },
      onError: (err) => setError(errorMessage(err)),
    })
  })

  return (
    <form onSubmit={onSubmit} noValidate className="space-y-3 rounded-2xl border border-slate-200 p-5">
      <h3 className="font-bold text-navy-900">Write a review</h3>
      <FormError message={error} />
      <div role="radiogroup" aria-label="Your rating" className="flex gap-1">
        {[1, 2, 3, 4, 5].map((n) => (
          <button key={n} type="button" role="radio" aria-checked={rating === n} aria-label={`${n} star${n > 1 ? 's' : ''}`} onClick={() => setValue('rating', n, { shouldValidate: true })} className="rounded p-0.5">
            <Stars value={rating >= n ? n : 0} size="h-7 w-7" />
          </button>
        ))}
      </div>
      {errors.rating && <p role="alert" className="text-xs font-medium text-red-600">{errors.rating.message}</p>}
      <TextField label="Title (optional)" error={errors.title?.message} {...register('title')} />
      <TextAreaField label="Your review (optional)" rows={4} error={errors.comment?.message} {...register('comment')} />
      <Button type="submit" loading={submit.isPending}>Submit review</Button>
    </form>
  )
}

function Reviews({ product }: { product: ProductDetail }) {
  const { status } = useAuth()
  const [page, setPage] = useState(1)
  const { data, isPending } = useReviews(product.slug, page)

  return (
    <section aria-labelledby="reviews-title" className="mt-14">
      <h2 id="reviews-title" className="text-xl font-extrabold text-navy-900">Customer reviews</h2>
      <div className="mt-5 grid gap-8 lg:grid-cols-[18rem_1fr]">
        <div>
          <div className="flex items-center gap-3">
            <span className="text-4xl font-extrabold text-navy-900">{Number(product.ratingAverage).toFixed(1)}</span>
            <div>
              <Stars value={Number(product.ratingAverage)} size="h-5 w-5" />
              <p className="text-xs text-slate-500">{product.ratingCount} {product.ratingCount === 1 ? 'review' : 'reviews'}</p>
            </div>
          </div>
          {data && (
            <ul className="mt-4 space-y-1.5" aria-label="Rating breakdown">
              {[5, 4, 3, 2, 1].map((n) => {
                const count = data.distribution[String(n)] ?? 0
                const pct = data.total ? (count / data.total) * 100 : 0
                return (
                  <li key={n} className="flex items-center gap-2 text-xs text-slate-600">
                    <span className="w-6">{n}★</span>
                    <span className="h-2 flex-1 overflow-hidden rounded-full bg-slate-100"><span className="block h-full rounded-full bg-accent-500" style={{ width: `${pct}%` }} /></span>
                    <span className="w-6 text-right">{count}</span>
                  </li>
                )
              })}
            </ul>
          )}
          <div className="mt-6">
            {status === 'authenticated' ? <ReviewForm slug={product.slug} /> : <p className="text-sm text-slate-600"><Link to="/login" state={{ from: `/products/${product.slug}` }} className="font-semibold text-royal-600 hover:underline">Log in</Link> to write a review.</p>}
          </div>
        </div>
        <div>
          {isPending ? (
            <div className="space-y-4">{[0, 1].map((i) => <Skeleton key={i} className="h-24" />)}</div>
          ) : data && data.items.length > 0 ? (
            <>
              <ul className="space-y-5">
                {data.items.map((r) => (
                  <li key={r.id} className="border-b border-slate-100 pb-5">
                    <div className="flex flex-wrap items-center gap-2">
                      <Stars value={r.rating} />
                      <span className="sr-only">{r.rating} out of 5</span>
                      {r.title && <h3 className="font-semibold text-navy-900">{r.title}</h3>}
                    </div>
                    {r.comment && <p className="mt-1.5 whitespace-pre-line text-sm text-slate-700">{r.comment}</p>}
                    <p className="mt-2 flex items-center gap-2 text-xs text-slate-500">
                      {r.author} · {formatDate(r.createdAt)}
                      {r.isVerifiedPurchase && <span className="inline-flex items-center gap-1 text-emerald-700"><BadgeCheck className="h-3.5 w-3.5" aria-hidden /> Verified purchase</span>}
                    </p>
                  </li>
                ))}
              </ul>
              <Pagination page={data.page} totalPages={data.totalPages} onChange={setPage} />
            </>
          ) : (
            <EmptyState title="No reviews yet" text="Be the first to share your experience with this product." />
          )}
        </div>
      </div>
    </section>
  )
}

export function ProductDetailPage() {
  const { slug } = useParams()
  const { data: product, isPending, isError, error, refetch } = useProduct(slug)
  const related = useRelated(slug)
  const [active, setActive] = useState(0)
  usePageTitle(product?.name)
  useEffect(() => setActive(0), [slug])

  if (isPending) {
    return (
      <div className="mx-auto grid max-w-7xl gap-10 px-4 py-8 lg:grid-cols-2">
        <Skeleton className="aspect-square" />
        <div className="space-y-4"><Skeleton className="h-8 w-3/4" /><Skeleton className="h-5 w-1/3" /><Skeleton className="h-10 w-1/2" /><Skeleton className="h-40" /></div>
      </div>
    )
  }
  if (isError) {
    const notFound = (error as { status?: number }).status === 404
    return notFound ? <EmptyState title="Product not found" text="It may have been removed or is no longer available." action={<ButtonLink to="/shop">Browse products</ButtonLink>} /> : <ErrorState onRetry={() => void refetch()} />
  }

  const images = product.images
  const current = images[active] ?? images[0]
  const specs = Object.entries(product.specifications ?? {})

  return (
    <div className="mx-auto max-w-7xl px-4 py-8">
      <nav aria-label="Breadcrumb" className="mb-5 text-sm text-slate-500">
        <Link to="/" className="hover:text-royal-600">Home</Link> / <Link to="/shop" className="hover:text-royal-600">Shop</Link> /{' '}
        <Link to={`/shop?category=${product.category.slug}`} className="hover:text-royal-600">{product.category.name}</Link>
      </nav>

      <div className="grid gap-10 lg:grid-cols-2">
        <div>
          <div className="aspect-square overflow-hidden rounded-2xl border border-slate-200 bg-slate-100">
            <ProductImage image={current ?? null} name={product.name} className="h-full w-full" />
          </div>
          {images.length > 1 && (
            <ul className="mt-3 flex gap-2 overflow-x-auto" aria-label="Product photos">
              {images.map((img, i) => (
                <li key={img.id ?? img.url}>
                  <button type="button" onClick={() => setActive(i)} aria-label={`Show photo ${i + 1}`} aria-current={i === active} className={`h-16 w-16 overflow-hidden rounded-lg border-2 ${i === active ? 'border-navy-900' : 'border-transparent hover:border-slate-300'}`}>
                    <img src={img.url} alt="" className="h-full w-full object-cover" />
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>

        <div>
          <p className="text-xs font-semibold uppercase tracking-wide text-royal-600">{product.category.name}</p>
          <h1 className="mt-1 text-2xl font-extrabold text-navy-900 sm:text-3xl">{product.name}</h1>
          <div className="mt-2 flex items-center gap-2 text-sm text-slate-600">
            <Stars value={Number(product.ratingAverage)} />
            <a href="#reviews-title" className="hover:underline">{product.ratingCount} {product.ratingCount === 1 ? 'review' : 'reviews'}</a>
            <span aria-hidden>·</span>
            <span>SKU {product.sku}</span>
          </div>
          <div className="mt-6"><Purchase key={product.id} product={product} /></div>

          <dl className="mt-8 grid gap-3 rounded-2xl bg-surface p-5 text-sm sm:grid-cols-2">
            <div className="flex gap-3"><Clock className="mt-0.5 h-5 w-5 shrink-0 text-royal-600" aria-hidden /><div><dt className="font-semibold text-navy-900">Processing time</dt><dd className="text-slate-600">{daysRange(product.processingDaysMin, product.processingDaysMax)}</dd></div></div>
            <div className="flex gap-3"><Truck className="mt-0.5 h-5 w-5 shrink-0 text-royal-600" aria-hidden /><div><dt className="font-semibold text-navy-900">Shipping time</dt><dd className="text-slate-600">{daysRange(product.shippingDaysMin, product.shippingDaysMax)}</dd></div></div>
            {product.supplier && <div className="flex gap-3 sm:col-span-2"><Store className="mt-0.5 h-5 w-5 shrink-0 text-royal-600" aria-hidden /><div><dt className="font-semibold text-navy-900">Supplier</dt><dd className="text-slate-600">{product.supplier.name}{product.supplier.city ? `, ${product.supplier.city}` : ''} ({product.supplier.country})</dd></div></div>}
          </dl>
        </div>
      </div>

      <section className="mt-12 grid gap-10 lg:grid-cols-[1fr_22rem]" aria-label="Product information">
        <div>
          <h2 className="text-xl font-extrabold text-navy-900">Description</h2>
          <p className="mt-3 whitespace-pre-line text-slate-700">{product.description}</p>
        </div>
        {specs.length > 0 && (
          <div>
            <h2 className="text-xl font-extrabold text-navy-900">Specifications</h2>
            <dl className="mt-3 divide-y divide-slate-100 rounded-2xl border border-slate-200 text-sm">
              {specs.map(([k, v]) => (
                <div key={k} className="flex justify-between gap-4 px-4 py-2.5"><dt className="capitalize text-slate-500">{k.replace(/_/g, ' ')}</dt><dd className="text-right font-medium text-slate-800">{String(v)}</dd></div>
              ))}
              {product.weightGrams && <div className="flex justify-between gap-4 px-4 py-2.5"><dt className="text-slate-500">Weight</dt><dd className="font-medium text-slate-800">{product.weightGrams} g</dd></div>}
            </dl>
          </div>
        )}
      </section>

      <Reviews product={product} />

      {related.data && related.data.length > 0 && (
        <section className="mt-14" aria-labelledby="related-title">
          <h2 id="related-title" className="mb-5 text-xl font-extrabold text-navy-900">You may also like</h2>
          <ProductGrid>{related.data.slice(0, 4).map((p) => <ProductCard key={p.id} p={{ ...p, categoryName: p.category.name }} />)}</ProductGrid>
        </section>
      )}
    </div>
  )
}
