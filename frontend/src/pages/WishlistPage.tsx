import { Heart } from 'lucide-react'
import { ButtonLink } from '@/components/ui/Button'
import { EmptyState, ErrorState } from '@/components/ui/feedback'
import { ProductCard, ProductGrid, ProductGridSkeleton } from '@/features/catalog/components'
import { useWishlist } from '@/features/catalog/hooks'
import { usePageTitle } from '@/hooks/usePageTitle'

export function WishlistPage() {
  usePageTitle('Wishlist')
  const { data, isPending, isError, refetch } = useWishlist()

  return (
    <div className="mx-auto max-w-7xl px-4 py-8">
      <h1 className="text-2xl font-extrabold text-navy-900 sm:text-3xl">My wishlist</h1>
      <div className="mt-8">
        {isPending ? (
          <ProductGridSkeleton count={4} />
        ) : isError ? (
          <ErrorState onRetry={() => void refetch()} />
        ) : data.length === 0 ? (
          <EmptyState icon={<Heart className="h-6 w-6" />} title="Your wishlist is empty" text="Tap the heart on any product to save it for later." action={<ButtonLink to="/shop">Browse products</ButtonLink>} />
        ) : (
          <ProductGrid>
            {data.map((p) => (
              <ProductCard key={p.id} p={{ ...p, inStock: p.stock > 0 && p.status === 'ACTIVE' }} />
            ))}
          </ProductGrid>
        )}
      </div>
    </div>
  )
}
