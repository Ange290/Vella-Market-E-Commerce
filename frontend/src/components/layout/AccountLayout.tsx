import { ClipboardList, Heart, LayoutDashboard, MapPin, Package, UserCog } from 'lucide-react'
import { NavLink, Outlet } from 'react-router-dom'

const links = [
  { to: '/account', label: 'Dashboard', icon: LayoutDashboard, end: true },
  { to: '/account/orders', label: 'Orders', icon: Package },
  { to: '/account/requests', label: 'Requests', icon: ClipboardList },
  { to: '/wishlist', label: 'Wishlist', icon: Heart },
  { to: '/account/addresses', label: 'Addresses', icon: MapPin },
  { to: '/account/profile', label: 'Profile', icon: UserCog },
]

/** Section navigation shared by all signed-in account pages. */
export function AccountLayout() {
  return (
    <div>
      <div className="border-b border-slate-200 bg-white">
        <nav aria-label="Account" className="mx-auto flex max-w-7xl gap-1 overflow-x-auto px-4">
          {links.map(({ to, label, icon: Icon, end }) => (
            <NavLink key={to} to={to} end={end} className={({ isActive }) => `inline-flex shrink-0 items-center gap-2 border-b-2 px-3 py-3.5 text-sm font-semibold transition-colors ${isActive ? 'border-accent-500 text-navy-900' : 'border-transparent text-slate-500 hover:text-navy-900'}`}>
              <Icon className="h-4 w-4" aria-hidden /> {label}
            </NavLink>
          ))}
        </nav>
      </div>
      <Outlet />
    </div>
  )
}
