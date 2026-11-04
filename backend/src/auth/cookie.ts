import type { Response } from 'express';
import type { IssuedTokens } from './token.service';

export const REFRESH_COOKIE = 'vella_rt';

/** httpOnly, Lax, path-scoped to the auth routes, and Secure in production. */
export const refreshCookieBase = () => ({
  httpOnly: true,
  secure: process.env.NODE_ENV === 'production',
  sameSite: 'lax' as const,
  path: '/api/v1/auth',
});

export function setRefreshCookie(res: Response, tokens: IssuedTokens) {
  res.cookie(REFRESH_COOKIE, tokens.refreshToken, { ...refreshCookieBase(), expires: tokens.refreshExpiresAt });
}

export function clearRefreshCookie(res: Response) {
  res.clearCookie(REFRESH_COOKIE, refreshCookieBase());
}
