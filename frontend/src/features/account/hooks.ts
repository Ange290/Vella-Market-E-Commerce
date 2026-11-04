import { keepPreviousData, useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { api } from '@/lib/api'
import { useAuth } from '@/lib/auth'
import type { ContentPage, MeProfile, NotificationItem, OrderDetail, Paginated, ProductRequestItem, RequestStatus } from '@/types/api'

// ───────────── Profile ─────────────

export function useMe() {
  const { status } = useAuth()
  return useQuery({ queryKey: ['me'], queryFn: () => api<MeProfile>('/users/me'), enabled: status === 'authenticated' })
}

export function useUpdateProfile() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (input: { fullName?: string; country?: string; preferredCurrency?: string; preferredLanguage?: string }) => api<MeProfile>('/users/me', { method: 'PATCH', body: input }),
    onSuccess: (me) => qc.setQueryData(['me'], me),
  })
}

export function useChangePassword() {
  return useMutation({
    mutationFn: (input: { currentPassword: string; newPassword: string }) => api<{ message: string; accessToken: string }>('/users/me/password', { method: 'POST', body: input }),
  })
}

// ───────────── Notifications ─────────────

export function useNotifications(unreadOnly = false) {
  const { status } = useAuth()
  return useQuery({
    queryKey: ['notifications', unreadOnly],
    queryFn: () => api<Paginated<NotificationItem> & { unread: number }>('/notifications', { query: { pageSize: 8, unreadOnly: unreadOnly || undefined } }),
    enabled: status === 'authenticated',
    refetchInterval: 60_000,
  })
}

export function useMarkNotifications() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (id?: string) => api(id ? `/notifications/${id}/read` : '/notifications/read-all', { method: 'POST' }),
    onSuccess: () => void qc.invalidateQueries({ queryKey: ['notifications'] }),
  })
}

// ───────────── Product requests & quotations ─────────────

export function useRequests(page: number, status?: RequestStatus) {
  const { status: auth } = useAuth()
  return useQuery({
    queryKey: ['requests', 'list', page, status ?? 'all'],
    queryFn: () => api<Paginated<ProductRequestItem>>('/product-requests', { query: { page, pageSize: 10, status } }),
    enabled: auth === 'authenticated',
    placeholderData: keepPreviousData,
  })
}

export function useRequest(id: string | undefined) {
  return useQuery({
    queryKey: ['requests', 'detail', id],
    queryFn: () => api<ProductRequestItem>(`/product-requests/${id}`),
    enabled: !!id,
    retry: (count, err) => (err as { status?: number }).status !== 404 && count < 1,
  })
}

export function useCreateRequest() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (form: FormData) => api<ProductRequestItem>('/product-requests', { method: 'POST', body: form }),
    onSuccess: () => void qc.invalidateQueries({ queryKey: ['requests'] }),
  })
}

export function useCancelRequest() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (id: string) => api<ProductRequestItem>(`/product-requests/${id}/cancel`, { method: 'POST' }),
    onSuccess: () => void qc.invalidateQueries({ queryKey: ['requests'] }),
  })
}

export function useAcceptQuotation() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: ({ id, addressId }: { id: string; addressId: string }) => api<OrderDetail>(`/quotations/${id}/accept`, { method: 'POST', body: { addressId } }),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['requests'] })
      void qc.invalidateQueries({ queryKey: ['orders'] })
    },
  })
}

export function useRejectQuotation() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (id: string) => api<ProductRequestItem>(`/quotations/${id}/reject`, { method: 'POST' }),
    onSuccess: () => void qc.invalidateQueries({ queryKey: ['requests'] }),
  })
}

// ───────────── Public content ─────────────

export function useContentPage(slug: string) {
  return useQuery({
    queryKey: ['public', 'content', slug],
    queryFn: () => api<ContentPage>(`/content/${slug}`, { auth: false }),
    staleTime: 5 * 60_000,
    retry: (count, err) => (err as { status?: number }).status !== 404 && count < 1,
  })
}
