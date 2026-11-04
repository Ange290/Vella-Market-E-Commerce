/**
 * Fetch wrapper for the Vella Market REST API.
 *
 * - The short-lived access token is kept in memory only (never localStorage), so XSS cannot read a
 *   long-lived credential. The refresh token lives in an httpOnly cookie managed by the server.
 * - On a 401 the client refreshes once (single-flight, so parallel requests share one refresh —
 *   important because refresh tokens rotate) and retries the request.
 * - Only public configuration may live in VITE_* variables.
 */
const BASE_URL = (import.meta.env.VITE_API_URL as string | undefined) ?? '/api/v1'

export class ApiError extends Error {
  readonly status: number
  readonly code?: string
  readonly issues?: { code: string; message: string; itemId?: string }[]
  readonly body?: unknown

  constructor(status: number, message: string, code?: string, issues?: ApiError['issues'], body?: unknown) {
    super(message)
    this.name = 'ApiError'
    this.status = status
    this.code = code
    this.issues = issues
    this.body = body
  }
}

let accessToken: string | null = null
let refreshing: Promise<string | null> | null = null
let onSessionLost: (() => void) | null = null

export const tokenStore = {
  get: () => accessToken,
  set: (t: string | null) => {
    accessToken = t
  },
  /** Called when a refresh fails, so the UI can drop the signed-in state. */
  onSessionLost: (fn: (() => void) | null) => {
    onSessionLost = fn
  },
}

/** Exchanges the refresh cookie for a new access token. Shared by all concurrent callers. */
export function refreshAccessToken(): Promise<string | null> {
  refreshing ??= (async () => {
    try {
      const res = await fetch(`${BASE_URL}/auth/refresh`, { method: 'POST', credentials: 'include' })
      if (!res.ok) throw new Error('refresh failed')
      const data = (await res.json()) as { accessToken: string }
      accessToken = data.accessToken
      return accessToken
    } catch {
      accessToken = null
      return null
    } finally {
      // Keep the settled promise for one tick so racing callers resolve to the same result.
      setTimeout(() => {
        refreshing = null
      }, 0)
    }
  })()
  return refreshing
}

type Query = Record<string, string | number | boolean | undefined | null>

export interface RequestOptions {
  method?: 'GET' | 'POST' | 'PATCH' | 'PUT' | 'DELETE'
  body?: unknown
  query?: Query
  /** Send the bearer token (default true when one exists). */
  auth?: boolean
  headers?: Record<string, string>
  signal?: AbortSignal
}

function buildUrl(path: string, query?: Query) {
  if (!query) return `${BASE_URL}${path}`
  const params = new URLSearchParams()
  for (const [k, v] of Object.entries(query)) {
    if (v !== undefined && v !== null && v !== '') params.set(k, String(v))
  }
  const qs = params.toString()
  return `${BASE_URL}${path}${qs ? `?${qs}` : ''}`
}

async function send(path: string, opts: RequestOptions): Promise<Response> {
  const isForm = typeof FormData !== 'undefined' && opts.body instanceof FormData
  const headers: Record<string, string> = { ...(opts.headers ?? {}) }
  if (opts.body !== undefined && !isForm) headers['Content-Type'] = 'application/json'
  if (opts.auth !== false && accessToken) headers.Authorization = `Bearer ${accessToken}`
  return fetch(buildUrl(path, opts.query), {
    method: opts.method ?? 'GET',
    credentials: 'include',
    headers,
    signal: opts.signal,
    body: opts.body === undefined ? undefined : isForm ? (opts.body as FormData) : JSON.stringify(opts.body),
  })
}

export async function api<T = unknown>(path: string, opts: RequestOptions = {}): Promise<T> {
  let res = await send(path, opts)

  if (res.status === 401 && opts.auth !== false && !path.startsWith('/auth/')) {
    const token = await refreshAccessToken()
    if (token) {
      res = await send(path, opts)
    } else {
      onSessionLost?.()
    }
  }

  const text = await res.text()
  let body: any
  try {
    body = text ? JSON.parse(text) : undefined
  } catch {
    body = undefined
  }
  if (!res.ok) {
    const message = Array.isArray(body?.message) ? body.message.join('. ') : (body?.message as string | undefined)
    throw new ApiError(res.status, message ?? res.statusText ?? 'Request failed', body?.code, body?.issues, body)
  }
  return body as T
}

/** A readable message for any thrown value. */
export function errorMessage(err: unknown, fallback = 'Something went wrong. Please try again.'): string {
  if (err instanceof ApiError) {
    if (err.status === 0 || err.status >= 500) return fallback
    return err.message
  }
  if (err instanceof TypeError) return 'Cannot reach the server. Check your connection and try again.'
  return fallback
}
