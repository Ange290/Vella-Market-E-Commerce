import { useQueryClient } from '@tanstack/react-query'
import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react'
import { api, refreshAccessToken, tokenStore } from '@/lib/api'
import type { Role, SessionUser } from '@/types/api'

type Status = 'loading' | 'authenticated' | 'anonymous'

interface AuthContextValue {
  user: SessionUser | null
  status: Status
  isStaff: boolean
  login: (identifier: string, password: string) => Promise<SessionUser>
  loginWithCode: (identifier: string, code: string) => Promise<SessionUser>
  /** Completes sign-up after the emailed code is verified; signs the user in. */
  verifyRegistration: (email: string, code: string) => Promise<SessionUser>
  logout: () => Promise<void>
}

const AuthContext = createContext<AuthContextValue | null>(null)

interface AuthResponse {
  accessToken: string
  user: SessionUser
}

interface MeResponse {
  id: string
  email: string
  role: Role
  profile: { fullName: string } | null
}

export function AuthProvider({ children }: { children: ReactNode }) {
  const queryClient = useQueryClient()
  const [user, setUser] = useState<SessionUser | null>(null)
  const [status, setStatus] = useState<Status>('loading')

  const clear = useCallback(() => {
    tokenStore.set(null)
    setUser(null)
    setStatus('anonymous')
    queryClient.removeQueries({ predicate: (q) => q.queryKey[0] !== 'public' })
  }, [queryClient])

  // Restore a previous session from the httpOnly refresh cookie. The refresh helper is
  // single-flight, so React StrictMode's double effect cannot rotate the token twice.
  useEffect(() => {
    let cancelled = false
    tokenStore.onSessionLost(clear)
    ;(async () => {
      const token = await refreshAccessToken()
      if (!token) {
        if (!cancelled) setStatus('anonymous')
        return
      }
      try {
        const me = await api<MeResponse>('/users/me')
        if (!cancelled) {
          setUser({ id: me.id, email: me.email, role: me.role, fullName: me.profile?.fullName ?? null })
          setStatus('authenticated')
        }
      } catch {
        if (!cancelled) clear()
      }
    })()
    return () => {
      cancelled = true
      tokenStore.onSessionLost(null)
    }
  }, [clear])

  const adopt = useCallback((res: AuthResponse) => {
    tokenStore.set(res.accessToken)
    setUser(res.user)
    setStatus('authenticated')
    return res.user
  }, [])

  const value = useMemo<AuthContextValue>(
    () => ({
      user,
      status,
      isStaff: user?.role === 'ADMIN' || user?.role === 'STAFF',
      login: async (identifier, password) => adopt(await api<AuthResponse>('/auth/login', { method: 'POST', body: { identifier, password }, auth: false })),
      loginWithCode: async (identifier, code) => adopt(await api<AuthResponse>('/auth/login/otp/verify', { method: 'POST', body: { identifier, code }, auth: false })),
      verifyRegistration: async (email, code) => adopt(await api<AuthResponse>('/auth/verify-otp', { method: 'POST', body: { email, code }, auth: false })),
      logout: async () => {
        try {
          await api('/auth/logout', { method: 'POST', auth: false })
        } finally {
          clear()
        }
      },
    }),
    [user, status, adopt, clear],
  )

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>
}

export function useAuth(): AuthContextValue {
  const ctx = useContext(AuthContext)
  if (!ctx) throw new Error('useAuth must be used inside <AuthProvider>')
  return ctx
}
