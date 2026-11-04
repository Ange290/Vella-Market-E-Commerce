import type { Money } from '@/types/api'

/** Formats a decimal-string amount for display. Display only — arithmetic is always done by the server. */
export function formatMoney(m: Money | null | undefined, fallbackCny?: string): string {
  if (!m) return fallbackCny !== undefined ? `¥${formatNumber(fallbackCny, 2)}` : '—'
  const decimals = m.amount.includes('.') ? m.amount.split('.')[1].length : 0
  try {
    return new Intl.NumberFormat(undefined, {
      style: 'currency',
      currency: m.currency,
      minimumFractionDigits: decimals,
      maximumFractionDigits: decimals,
    }).format(Number(m.amount))
  } catch {
    return `${m.currency} ${formatNumber(m.amount, decimals)}`
  }
}

export function formatNumber(value: string | number, decimals = 0): string {
  return new Intl.NumberFormat(undefined, { minimumFractionDigits: decimals, maximumFractionDigits: decimals }).format(Number(value))
}

export function formatDate(iso: string, withTime = false): string {
  return new Intl.DateTimeFormat(undefined, withTime ? { dateStyle: 'medium', timeStyle: 'short' } : { dateStyle: 'medium' }).format(new Date(iso))
}

export function daysRange(min: number, max: number): string {
  return min === max ? `${min} days` : `${min}–${max} days`
}

/** Resolves an API-served asset path (e.g. /uploads/x.png) against the page origin. */
export function assetUrl(url: string | null | undefined): string | undefined {
  return url ?? undefined
}
