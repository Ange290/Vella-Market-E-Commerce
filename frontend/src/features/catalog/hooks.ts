import { keepPreviousData, useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { api } from '@/lib/api'
import { useAuth } from '@/lib/auth'
import { useCurrency } from '@/lib/currency'
import type { Cart, CategoryNode, Paginated, ProductDetail, ProductListItem, Promotion, ReviewPage, WishlistEntry } from '@/types/api'

// Query keys that start with 'public' survive logout; everything else is cleared when the session ends.

export interface ProductFilters {
  q?: string
  category?: string
  minPrice?: string
  maxPrice?: string
  sort?: string
  page?: number
  pageSize?: number
}

export function useCategories() {
  return useQuery({ queryKey: ['public', 'categories'], queryFn: () => api<CategoryNode[]>('/categories', { auth: false }), staleTime: 5 * 60_000 })
}

export function usePromotions() {
  return useQuery({ queryKey: ['public', 'promotions'], queryFn: () => api<Promotion[]>('/promotions', { auth: false }), staleTime: 60_000 })
}

export function useProducts(filters: ProductFilters) {
  const { currency } = useCurrency()
  return useQuery({
    queryKey: ['public', 'products', filters, currency],
    queryFn: () => api<Paginated<ProductListItem> & { currency: string | null }>('/products', { auth: false, query: { ...filters, currency } }),
    placeholderData: keepPreviousData,
  })
}

export function useProduct(slug: string | undefined) {
  const { currency } = useCurrency()
  return useQuery({
    queryKey: ['public', 'product', slug, currency],
    queryFn: () => api<ProductDetail>(`/products/${slug}`, { auth: false, query: { currency } }),
    enabled: !!slug,
    retry: (count, err) => (err as { status?: number }).status !== 404 && count < 1,
  })
}

export function useRelated(slug: string | undefined) {
  const { currency } = useCurrency()
  return useQuery({
    queryKey: ['public', 'related', slug, currency],
    queryFn: () => api<ProductListItem[]>(`/products/${slug}/related`, { auth: false, query: { currency } }),
    enabled: !!slug,
  })
}

export function useReviews(slug: string | undefined, page: number) {
  return useQuery({
    queryKey: ['public', 'reviews', slug, page],
    queryFn: () => api<ReviewPage>(`/products/${slug}/reviews`, { auth: false, query: { page, pageSize: 5 } }),
    enabled: !!slug,
    placeholderData: keepPreviousData,
  })
}

export function useSubmitReview(slug: string) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (input: { rating: number; title?: string; comment?: string }) => api(`/products/${slug}/reviews`, { method: 'POST', body: input }),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['public', 'reviews', slug] })
      void qc.invalidateQueries({ queryKey: ['public', 'product', slug] })
    },
  })
}

// ───────────── Wishlist ─────────────

export function useWishlist() {
  const { status } = useAuth()
  const { currency } = useCurrency()
  return useQuery({
    queryKey: ['wishlist', currency],
    queryFn: () => api<WishlistEntry[]>('/wishlist', { query: { currency } }),
    enabled: status === 'authenticated',
  })
}

export function useToggleWishlist() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: ({ productId, add }: { productId: string; add: boolean }) => api(`/wishlist/${productId}`, { method: add ? 'POST' : 'DELETE' }),
    onSuccess: () => void qc.invalidateQueries({ queryKey: ['wishlist'] }),
  })
}

// ───────────── Cart ─────────────

export function useCart() {
  const { status } = useAuth()
  const { currency } = useCurrency()
  return useQuery({ queryKey: ['cart', currency], queryFn: () => api<Cart>('/cart', { query: { currency } }), enabled: status === 'authenticated' })
}

export function useAddToCart() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (input: { productId: string; variantId?: string; quantity: number }) => api<Cart>('/cart/items', { method: 'POST', body: input }),
    onSuccess: () => void qc.invalidateQueries({ queryKey: ['cart'] }),
  })
}
