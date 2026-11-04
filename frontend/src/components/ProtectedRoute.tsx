import { Navigate, Outlet, useLocation } from 'react-router-dom'
import { Spinner } from '@/components/ui/feedback'
import { useAuth } from '@/lib/auth'

/** Renders child routes only for signed-in users; others are sent to login and returned afterwards. */
export function ProtectedRoute({ staffOnly = false }: { staffOnly?: boolean }) {
  const { status, isStaff } = useAuth()
  const location = useLocation()

  if (status === 'loading') return <Spinner label="Checking your session" />
  if (status === 'anonymous') return <Navigate to="/login" replace state={{ from: location.pathname + location.search }} />
  if (staffOnly && !isStaff) return <Navigate to="/" replace />
  return <Outlet />
}

/** Keeps signed-in users away from login/register screens. */
export function GuestRoute() {
  const { status } = useAuth()
  const location = useLocation()
  if (status === 'loading') return <Spinner />
  if (status === 'authenticated') return <Navigate to={(location.state as { from?: string } | null)?.from ?? '/account'} replace />
  return <Outlet />
}
