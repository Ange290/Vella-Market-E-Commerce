import type { QuotationStatus, RequestStatus } from '@/types/api'

export const REQUEST_LABEL: Record<RequestStatus, string> = {
  SUBMITTED: 'Submitted',
  UNDER_REVIEW: 'Under review',
  QUOTED: 'Quotation ready',
  ACCEPTED: 'Accepted',
  REJECTED: 'Declined',
  CONVERTED: 'Ordered',
  EXPIRED: 'Expired',
  CANCELLED: 'Cancelled',
}

const REQUEST_TONE: Record<RequestStatus, string> = {
  SUBMITTED: 'bg-slate-100 text-slate-700',
  UNDER_REVIEW: 'bg-royal-100 text-royal-700',
  QUOTED: 'bg-accent-100 text-accent-600',
  ACCEPTED: 'bg-emerald-100 text-emerald-800',
  REJECTED: 'bg-red-100 text-red-700',
  CONVERTED: 'bg-emerald-100 text-emerald-800',
  EXPIRED: 'bg-slate-200 text-slate-600',
  CANCELLED: 'bg-slate-200 text-slate-600',
}

export function RequestBadge({ status }: { status: RequestStatus }) {
  return <span className={`inline-flex rounded-full px-2.5 py-1 text-xs font-semibold ${REQUEST_TONE[status]}`}>{REQUEST_LABEL[status]}</span>
}

export const QUOTATION_LABEL: Record<QuotationStatus, string> = {
  DRAFT: 'Draft',
  SENT: 'Open offer',
  ACCEPTED: 'Accepted',
  REJECTED: 'Declined by you',
  EXPIRED: 'Expired',
}

export const OPEN_REQUEST: RequestStatus[] = ['SUBMITTED', 'UNDER_REVIEW', 'QUOTED']
