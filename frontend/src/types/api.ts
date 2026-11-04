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

// ───────────── Buying flow ─────────────

export interface Address {
  id: string
  label: string
  recipientName: string
  phone: string
  country: string
  region: string | null
  city: string
  street: string
  postalCode: string | null
  isDefault: boolean
}

export type DeliveryMethod = 'STANDARD' | 'EXPRESS' | 'AIR_FREIGHT' | 'SEA_FREIGHT' | 'PICKUP'

export interface ShippingOption {
  method: DeliveryMethod
  available: boolean
  fee: Money | null
  estimatedDays?: { min: number | null; max: number | null }
  reason?: string
}

export interface ShippingOptions {
  country: string
  weightGrams: number
  currency: string
  options: ShippingOption[]
}

export interface QuoteIssue {
  code: string
  message: string
  itemId?: string
}

export interface Quote {
  currency: string
  exchangeRate: { from: string; to: string; rate: string }
  lines: { itemId: string; name: string; sku: string; size: string | null; color: string | null; quantity: number; unitPrice: Money; lineTotal: Money }[]
  breakdown: {
    subtotal: Money
    shipping: { label: string; amount: Money; weightGrams: number; estimatedDays: { min: number | null; max: number | null } }
    serviceFee: { label: string; pct: string; amount: Money }
    taxes: { label: string; ratePct: string; amount: Money }[]
    discount: { code: string; amount: Money } | null
    total: Money
  }
  issues: QuoteIssue[]
  canCheckout: boolean
}

export type OrderStatus =
  | 'PENDING'
  | 'AWAITING_PAYMENT'
  | 'PAID'
  | 'PROCESSING'
  | 'PURCHASED_FROM_SUPPLIER'
  | 'SHIPPED_FROM_CHINA'
  | 'ARRIVED_AT_DESTINATION_COUNTRY'
  | 'OUT_FOR_DELIVERY'
  | 'DELIVERED'
  | 'CANCELLED'
  | 'REFUNDED'

export interface OrderListItem {
  id: string
  orderNumber: string
  status: OrderStatus
  currency: string
  total: string
  createdAt: string
  itemCount: number
  items: { name: string; imageUrl: string | null; quantity: number }[]
}

export interface TimelineEntry {
  id: string
  status: OrderStatus
  description: string | null
  trackingRef: string | null
  createdAt: string
}

export type PaymentMethod = 'MTN_MOBILE_MONEY' | 'AIRTEL_MONEY' | 'CARD' | 'BANK_TRANSFER' | 'OTHER'
export type PaymentStatus = 'INITIATED' | 'PENDING' | 'SUCCESSFUL' | 'FAILED' | 'CANCELLED' | 'PARTIALLY_REFUNDED' | 'REFUNDED'

export interface Payment {
  id: string
  orderId: string
  method: PaymentMethod
  status: PaymentStatus
  amount: string
  currency: string
  reference: string
  checkoutUrl: string | null
  failureReason: string | null
  paidAt: string | null
  createdAt: string
}

export type ShipmentStatus = 'PENDING' | 'IN_TRANSIT' | 'CUSTOMS' | 'ARRIVED' | 'OUT_FOR_DELIVERY' | 'DELIVERED' | 'EXCEPTION'

export interface Shipment {
  id: string
  carrier: string | null
  trackingNumber: string | null
  status: ShipmentStatus
  originCountry: string
  destinationCountry: string
  estimatedDelivery: string | null
  shippedAt: string | null
  deliveredAt: string | null
  events: { id: string; status: ShipmentStatus; location: string | null; description: string | null; occurredAt: string }[]
}

export interface OrderDetail {
  id: string
  orderNumber: string
  status: OrderStatus
  deliveryMethod: DeliveryMethod
  currency: string
  exchangeRate: string
  subtotal: string
  shippingFee: string
  serviceFee: string
  taxAmount: string
  discountAmount: string
  total: string
  customerNote: string | null
  createdAt: string
  shippingAddress: { recipientName: string; phone: string; country: string; region: string | null; city: string; street: string; postalCode: string | null }
  items: { id: string; name: string; sku: string; imageUrl: string | null; size: string | null; color: string | null; quantity: number; unitPrice: string; lineTotal: string }[]
  history: TimelineEntry[]
  payments: Pick<Payment, 'id' | 'method' | 'status' | 'amount' | 'currency' | 'reference' | 'paidAt' | 'createdAt'>[]
  shipments: Shipment[]
}
