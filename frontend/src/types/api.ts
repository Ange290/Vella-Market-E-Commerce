// Shapes returned by the Vella Market API (only what the UI uses).
// Money amounts are decimal strings — never parse them for arithmetic.

export interface Money {
  amount: string
  currency: string
}

export type Role = 'CUSTOMER' | 'ADMIN' | 'STAFF'

export interface SessionUser {
  id: string
  email: string
  role: Role
  fullName: string | null
}

export interface Paginated<T> {
  items: T[]
  total: number
  page: number
  pageSize: number
  totalPages: number
}

export interface Currency {
  code: string
  name: string
  symbol: string
  decimals: number
  rateFromCny: string | null
}

export interface CategoryNode {
  id: string
  name: string
  slug: string
  imageUrl: string | null
  productCount: number
  children: CategoryNode[]
}

export interface ProductImage {
  id?: string
  url: string
  altText: string | null
  isPrimary?: boolean
}

export interface ProductListItem {
  id: string
  sku: string
  name: string
  slug: string
  priceCny: string
  stock: number
  status: string
  ratingAverage: string
  ratingCount: number
  processingDaysMin: number
  processingDaysMax: number
  shippingDaysMin: number
  shippingDaysMax: number
  category: { id: string; name: string; slug: string }
  image: { url: string; altText: string | null } | null
  inStock: boolean
  displayPrice: Money | null
}

export interface ProductVariant {
  id: string
  sku: string
  size: string | null
  color: string | null
  stock: number
  priceDeltaCny: string
  finalPriceCny: string
  displayPrice: Money | null
}

export interface ProductDetail extends Omit<ProductListItem, 'image' | 'inStock'> {
  description: string
  specifications: Record<string, string | number | boolean>
  weightGrams: number | null
  images: ProductImage[]
  variants: ProductVariant[]
  sizes: string[]
  colors: string[]
  supplier: { id: string; name: string; country: string; city: string | null; platform: string | null } | null
  category: { id: string; name: string; slug: string; parent: { id: string; name: string; slug: string } | null }
}

export interface Review {
  id: string
  rating: number
  title: string | null
  comment: string | null
  isVerifiedPurchase: boolean
  createdAt: string
  author: string
}

export interface ReviewPage extends Paginated<Review> {
  average: string
  distribution: Record<string, number>
}

export interface WishlistEntry {
  id: string
  name: string
  slug: string
  priceCny: string
  stock: number
  status: string
  image: { url: string; altText: string | null } | null
  displayPrice: Money | null
  ratingAverage: string
  ratingCount: number
}

export interface Promotion {
  id: string
  title: string
  subtitle: string | null
  bannerUrl: string | null
  linkUrl: string | null
  couponCode: string | null
}

export interface CartItem {
  id: string
  productId: string
  variantId: string | null
  name: string
  slug: string
  sku: string
  size: string | null
  color: string | null
  image: { url: string; altText: string | null } | null
  quantity: number
  unitPriceCny: string
  lineTotalCny: string
  unitPrice: Money | null
  lineTotal: Money | null
  available: number
  issue: { code: string; message: string } | null
}

export interface Cart {
  items: CartItem[]
  itemCount: number
  subtotalCny: string
  subtotal: Money | null
  currency: string | null
}
