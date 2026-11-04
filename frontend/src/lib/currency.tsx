import { useQuery } from '@tanstack/react-query'
import { createContext, useCallback, useContext, useMemo, useState, type ReactNode } from 'react'
import { api } from '@/lib/api'
import type { Currency } from '@/types/api'

const STORAGE_KEY = 'vm_currency'
const PREFERRED_DEFAULT = 'RWF'

interface CurrencyContextValue {
  /** Currency used to display prices. */
  currency: string
  /** Currencies that currently have an exchange rate (CNY is always available). */
  options: Currency[]
  setCurrency: (code: string) => void
}

const CurrencyContext = createContext<CurrencyContextValue | null>(null)

function readStored(): string | null {
  try {
    return localStorage.getItem(STORAGE_KEY)
  } catch {
    return null
  }
}

export function CurrencyProvider({ children }: { children: ReactNode }) {
  const [chosen, setChosen] = useState<string | null>(readStored)
  const { data } = useQuery({
    queryKey: ['public', 'currencies'],
    queryFn: () => api<Currency[]>('/currencies', { auth: false }),
    staleTime: 5 * 60_000,
  })

  // Only currencies with a configured rate can be used to show converted prices.
  const options = useMemo(() => {
    const priced = (data ?? []).filter((c) => c.rateFromCny !== null)
    return priced.some((c) => c.code === 'CNY') ? priced : [{ code: 'CNY', name: 'Chinese Yuan', symbol: '¥', decimals: 2, rateFromCny: '1' }, ...priced]
  }, [data])

  const currency = useMemo(() => {
    if (chosen && options.some((o) => o.code === chosen)) return chosen
    return options.some((o) => o.code === PREFERRED_DEFAULT) ? PREFERRED_DEFAULT : 'CNY'
  }, [chosen, options])

  const setCurrency = useCallback((code: string) => {
    setChosen(code)
    try {
      localStorage.setItem(STORAGE_KEY, code)
    } catch {
      /* private mode: the choice just lasts for this session */
    }
  }, [])

  const value = useMemo(() => ({ currency, options, setCurrency }), [currency, options, setCurrency])
  return <CurrencyContext.Provider value={value}>{children}</CurrencyContext.Provider>
}

export function useCurrency(): CurrencyContextValue {
  const ctx = useContext(CurrencyContext)
  if (!ctx) throw new Error('useCurrency must be used inside <CurrencyProvider>')
  return ctx
}
