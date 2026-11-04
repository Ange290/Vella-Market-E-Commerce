import { Heart, ImageOff, Star } from 'lucide-react'
import { Link, useLocation, useNavigate } from 'react-router-dom'
import { Skeleton } from '@/components/ui/feedback'
import { useToggleWishlist, useWishlist } from '@/features/catalog/hooks'
import { errorMessage } from '@/lib/api'
import { useAuth } from '@/lib/auth'
import { formatMoney } from '@/lib/format'
import { useToast } from '@/lib/toast'
import type { Money } from '@/types/api'

export interface CardProduct {
  id: string
  name: string
  slug: string
  image: { url: string; altText: string | null } | null
  priceCny: string
  displayPrice: Money | null
  ratingAverage: string
  ratingCount: number
  inStock: boolean
  categoryName?: string
}

export function Stars({ value, size = 'h-4 w-4' }: { value: number; size?: string }) {
  return (
    <span className="inline-flex items-center gap-0.5" aria-hidden>
      {[1, 2, 3, 4, 5].map((i) => (
        <Star key={i} className={`${size} ${value >= i - 0.25 ? 'fill-accent-500 text-accent-500' : value >= i - 0.75 ? 'fill-accent-500/40 text-accent-500' : 'text-slate-300'}`} />
      ))}
    </span>
  )
}

export function WishlistButton({ productId, className = '' }: { productId: string; className?: string }) {
  const { status } = useAuth()
  const navigate = useNavigate()
  const location = useLocation()
  const toast = useToast()
  const { data } = useWishlist()
  const toggle = useToggleWishlist()
  const wishlisted = !!data?.some((p) => p.id === productId)

  const onClick = (e: React.MouseEvent) => {
    e.preventDefault()
    e.stopPropagation()
    if (status !== 'authenticated') {
      toast.info('Log in to save items to your wishlist.')
      navigate('/login', { state: { from: location.pathname + location.search } })
      return
    }
    toggle.mutate(
      { productId, add: !wishlisted },
      {
        onSuccess: () => toast.success(wishlisted ? 'Removed from your wishlist.' : 'Saved to your wishlist.'),
        onError: (err) => toast.error(errorMessage(err)),
      },
    )
  }

  return (
    <button type="button" onClick={onClick} disabled={toggle.isPending} aria-pressed={wishlisted} aria-label={wishlisted ? 'Remove from wishlist' : 'Add to wishlist'} className={`grid h-9 w-9 place-items-center rounded-full bg-white/90 shadow-sm backdrop-blur transition hover:bg-white ${className}`}>
      <Heart className={`h-[18px] w-[18px] ${wishlisted ? 'fill-red-500 text-red-500' : 'text-slate-600'}`} aria-hidden />
    </button>
  )
}

export function ProductImage({ image, name, className = '' }: { image: CardProduct['image']; name: string; className?: string }) {
  if (!image) {
    return (
      <div className={`grid place-items-center bg-slate-100 text-slate-400 ${className}`} role="img" aria-label={`No photo for ${name}`}>
        <ImageOff className="h-8 w-8" aria-hidden />
      </div>
    )
  }
  return <img src={image.url} alt={image.altText ?? name} loading="lazy" className={`object-cover ${className}`} />
}

export function Price({ money, fallbackCny, className = '' }: { money: Money | null; fallbackCny: string; className?: string }) {
  return <span className={className}>{formatMoney(money, fallbackCny)}</span>
}

export function ProductCard({ p }: { p: CardProduct }) {
  return (
    <article className="group relative flex flex-col overflow-hidden rounded-2xl border border-slate-200 bg-white transition-shadow hover:shadow-lg">
      <div className="relative aspect-square overflow-hidden bg-slate-100">
        <ProductImage image={p.image} name={p.name} className="h-full w-full transition-transform duration-300 group-hover:scale-105" />
        <WishlistButton productId={p.id} className="absolute right-2 top-2 z-10" />
        {!p.inStock && <span className="absolute left-2 top-2 rounded-full bg-slate-900/80 px-2.5 py-1 text-xs font-semibold text-white">Out of stock</span>}
      </div>
      <div className="flex flex-1 flex-col gap-1.5 p-4">
        {p.categoryName && <p className="text-xs font-medium uppercase tracking-wide text-royal-600">{p.categoryName}</p>}
        <h3 className="line-clamp-2 min-h-10 text-sm font-semibold text-navy-900">
          <Link to={`/products/${p.slug}`} className="after:absolute after:inset-0 focus-visible:outline-none">
            {p.name}
          </Link>
        </h3>
        <div className="flex items-center gap-1.5 text-xs text-slate-500">
          <Stars value={Number(p.ratingAverage)} />
          <span aria-label={`Rated ${p.ratingAverage} out of 5 from ${p.ratingCount} reviews`}>({p.ratingCount})</span>
        </div>
        <Price money={p.displayPrice} fallbackCny={p.priceCny} className="mt-auto pt-1 text-lg font-extrabold text-navy-900" />
      </div>
    </article>
  )
}

export function ProductGrid({ children }: { children: React.ReactNode }) {
  return <div className="grid grid-cols-2 gap-3 sm:gap-5 md:grid-cols-3 xl:grid-cols-4">{children}</div>
}

export function ProductGridSkeleton({ count = 8 }: { count?: number }) {
  return (
    <ProductGrid>
      {Array.from({ length: count }, (_, i) => (
        <div key={i} className="overflow-hidden rounded-2xl border border-slate-200 bg-white">
          <Skeleton className="aspect-square rounded-none" />
          <div className="space-y-2 p-4">
            <Skeleton className="h-3 w-1/3" />
            <Skeleton className="h-4 w-full" />
            <Skeleton className="h-4 w-2/3" />
            <Skeleton className="h-6 w-1/2" />
          </div>
        </div>
      ))}
    </ProductGrid>
  )
}
