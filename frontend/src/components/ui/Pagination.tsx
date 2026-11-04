import { ChevronLeft, ChevronRight } from 'lucide-react'

interface Props {
  page: number
  totalPages: number
  onChange: (page: number) => void
}

/** Compact page list: 1 … 4 5 [6] 7 8 … 20 */
function pageList(page: number, total: number): (number | 'gap')[] {
  const pages = new Set([1, total, page - 1, page, page + 1])
  const sorted = [...pages].filter((p) => p >= 1 && p <= total).sort((a, b) => a - b)
  const out: (number | 'gap')[] = []
  sorted.forEach((p, i) => {
    if (i > 0 && p - sorted[i - 1] > 1) out.push('gap')
    out.push(p)
  })
  return out
}

export function Pagination({ page, totalPages, onChange }: Props) {
  if (totalPages <= 1) return null
  const btn = 'grid h-9 min-w-9 place-items-center rounded-lg px-2 text-sm font-medium transition-colors'
  return (
    <nav aria-label="Pagination" className="mt-8 flex items-center justify-center gap-1">
      <button type="button" aria-label="Previous page" disabled={page <= 1} onClick={() => onChange(page - 1)} className={`${btn} text-slate-600 hover:bg-slate-100 disabled:opacity-40`}>
        <ChevronLeft className="h-4 w-4" />
      </button>
      {pageList(page, totalPages).map((p, i) =>
        p === 'gap' ? (
          <span key={`g${i}`} className="px-1 text-slate-400" aria-hidden>
            …
          </span>
        ) : (
          <button
            key={p}
            type="button"
            aria-current={p === page ? 'page' : undefined}
            aria-label={`Page ${p}`}
            onClick={() => onChange(p)}
            className={`${btn} ${p === page ? 'bg-navy-900 text-white' : 'text-slate-700 hover:bg-slate-100'}`}
          >
            {p}
          </button>
        ),
      )}
      <button type="button" aria-label="Next page" disabled={page >= totalPages} onClick={() => onChange(page + 1)} className={`${btn} text-slate-600 hover:bg-slate-100 disabled:opacity-40`}>
        <ChevronRight className="h-4 w-4" />
      </button>
    </nav>
  )
}
