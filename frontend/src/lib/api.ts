/**
 * Thin fetch wrapper for the Vella Market REST API.
 * In development Vite proxies /api to the NestJS server; in production set VITE_API_URL.
 * Only public (non-secret) configuration may ever live in VITE_* variables.
 */
const BASE_URL = (import.meta.env.VITE_API_URL as string | undefined) ?? '/api/v1'

export class ApiError extends Error {
  readonly status: number
  readonly details?: unknown

  constructor(status: number, message: string, details?: unknown) {
    super(message)
    this.name = 'ApiError'
    this.status = status
    this.details = details
  }
}

export async function api<T>(path: string, init: RequestInit = {}): Promise<T> {
  const res = await fetch(`${BASE_URL}${path}`, {
    credentials: 'include',
    ...init,
    headers: { 'Content-Type': 'application/json', ...(init.headers ?? {}) },
  })
  const text = await res.text()
  const body = text ? JSON.parse(text) : undefined
  if (!res.ok) {
    const msg = Array.isArray(body?.message) ? body.message.join(', ') : body?.message
    throw new ApiError(res.status, msg ?? res.statusText, body)
  }
  return body as T
}
