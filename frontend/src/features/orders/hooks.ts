import { keepPreviousData, useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { api } from '@/lib/api'
import { useAuth } from '@/lib/auth'
import type { Address, Cart, DeliveryMethod, OrderDetail, OrderListItem, OrderStatus, Paginated, Payment, PaymentMethod, Quote, ShippingOptions } from '@/types/api'

// ───────────── Cart ─────────────

export function useUpdateCartItem() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: ({ id, quantity }: { id: string; quantity: number }) => api<Cart>(`/cart/items/${id}`, { method: 'PATCH', body: { quantity } }),
    onSuccess: () => void qc.invalidateQueries({ queryKey: ['cart'] }),
  })
}

export function useRemoveCartItem() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (id: string) => api<Cart>(`/cart/items/${id}`, { method: 'DELETE' }),
    onSuccess: () => void qc.invalidateQueries({ queryKey: ['cart'] }),
  })
}

// ───────────── Addresses ─────────────

export function useAddresses() {
  const { status } = useAuth()
  return useQuery({ queryKey: ['addresses'], queryFn: () => api<Address[]>('/users/me/addresses'), enabled: status === 'authenticated' })
}

export interface AddressInput {
  label?: string
  recipientName: string
  phone: string
  country: string
  region?: string
  city: string
  street: string
  postalCode?: string
  isDefault?: boolean
}

export function useCreateAddress() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (input: AddressInput) => api<Address>('/users/me/addresses', { method: 'POST', body: input }),
    onSuccess: () => void qc.invalidateQueries({ queryKey: ['addresses'] }),
  })
}

export function useUpdateAddress() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: ({ id, ...input }: Partial<AddressInput> & { id: string }) => api<Address>(`/users/me/addresses/${id}`, { method: 'PATCH', body: input }),
    onSuccess: () => void qc.invalidateQueries({ queryKey: ['addresses'] }),
  })
}

export function useDeleteAddress() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (id: string) => api(`/users/me/addresses/${id}`, { method: 'DELETE' }),
    onSuccess: () => void qc.invalidateQueries({ queryKey: ['addresses'] }),
  })
}

// ───────────── Checkout ─────────────

/** `cartSignature` changes whenever cart contents change, so prices re-fetch automatically. */
export function useShippingOptions(addressId: string | undefined, currency: string, cartSignature: string) {
  return useQuery({
    queryKey: ['checkout', 'options', addressId, currency, cartSignature],
    queryFn: () => api<ShippingOptions>('/checkout/shipping-options', { query: { addressId, currency } }),
    enabled: !!addressId && cartSignature !== '',
    retry: false,
  })
}

export interface QuoteInput {
  addressId: string
  deliveryMethod: DeliveryMethod
  currency: string
  couponCode?: string
}

export function useQuote(input: QuoteInput | null, cartSignature: string) {
  return useQuery({
    queryKey: ['checkout', 'quote', input, cartSignature],
    queryFn: () => api<Quote>('/checkout/quote', { method: 'POST', body: input }),
    enabled: !!input && cartSignature !== '',
    retry: false,
    placeholderData: keepPreviousData,
  })
}

export function usePlaceOrder() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (input: QuoteInput & { customerNote?: string }) => api<OrderDetail>('/orders', { method: 'POST', body: input }),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['cart'] })
      void qc.invalidateQueries({ queryKey: ['orders'] })
    },
  })
}

// ───────────── Payments ─────────────

/** `key` makes retries of the same attempt idempotent on the server. */
export function useInitiatePayment() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: ({ orderId, method, key }: { orderId: string; method: PaymentMethod; key: string }) =>
      api<Payment>(`/orders/${orderId}/payments`, { method: 'POST', body: { method }, headers: { 'Idempotency-Key': key } }),
    onSuccess: () => void qc.invalidateQueries({ queryKey: ['orders'] }),
  })
}

export function usePaymentStatus(reference: string | null) {
  return useQuery({
    queryKey: ['payment', reference],
    queryFn: () => api<Payment>(`/payments/${encodeURIComponent(reference!)}/status`),
    enabled: !!reference,
    // Keep asking while the payment is still open (the server re-verifies with the provider each time).
    refetchInterval: (q) => (q.state.data && ['INITIATED', 'PENDING'].includes(q.state.data.status) ? 3000 : false),
    retry: false,
  })
}

// ───────────── Orders ─────────────

export function useOrders(page: number, status?: OrderStatus) {
  const { status: auth } = useAuth()
  return useQuery({
    queryKey: ['orders', 'list', page, status ?? 'all'],
    queryFn: () => api<Paginated<OrderListItem>>('/orders', { query: { page, pageSize: 10, status } }),
    enabled: auth === 'authenticated',
    placeholderData: keepPreviousData,
  })
}

export function useOrder(id: string | undefined) {
  return useQuery({
    queryKey: ['orders', 'detail', id],
    queryFn: () => api<OrderDetail>(`/orders/${id}`),
    enabled: !!id,
    retry: (count, err) => (err as { status?: number }).status !== 404 && count < 1,
  })
}

export function useOrderByNumber(orderNumber: string | undefined) {
  return useQuery({
    queryKey: ['orders', 'number', orderNumber],
    queryFn: () => api<OrderDetail>(`/orders/by-number/${encodeURIComponent(orderNumber!)}`),
    enabled: !!orderNumber,
    retry: false,
  })
}

export function useCancelOrder() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: ({ id, reason }: { id: string; reason?: string }) => api<OrderDetail>(`/orders/${id}/cancel`, { method: 'POST', body: { reason } }),
    onSuccess: () => void qc.invalidateQueries({ queryKey: ['orders'] }),
  })
}
