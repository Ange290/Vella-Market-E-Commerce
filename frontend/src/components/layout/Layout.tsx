import { Heart, LayoutDashboard, LogOut, Menu, Package, Search, ShoppingCart, User, X } from 'lucide-react'
import { useEffect, useRef, useState, type FormEvent, type ReactNode } from 'react'
import { Link, NavLink, Outlet, useLocation, useNavigate, useSearchParams } from 'react-router-dom'
import { useCart } from '@/features/catalog/hooks'
import { useAuth } from '@/lib/auth'
import { useCurrency } from '@/lib/currency'
import { useToast } from '@/lib/toast'

const nav = [
  { to: '/shop', label: 'Shop' },
  { to: '/categories', label: 'Categories' },
  { to: '/request-product', label: 'Request a Product' },
  { to: '/track', label: 'Track Order' },
]

function Logo() {
  return (
    <Link to="/" className="flex items-center gap-2 text-xl font-extrabold tracking-tight text-navy-900">
      <span className="grid h-8 w-8 place-items-center rounded-lg bg-navy-900 text-white">V</span>
      <span>
        Vella<span className="text-accent-500">Market</span>
      </span>
    </Link>
  )
}

function SearchBox({ className = '', onDone }: { className?: string; onDone?: () => void }) {
  const navigate = useNavigate()
  const [params] = useSearchParams()
  const location = useLocation()
  const [q, setQ] = useState(location.pathname === '/search' ? (params.get('q') ?? '') : '')

  const submit = (e: FormEvent) => {
    e.preventDefault()
    const term = q.trim()
    if (term) navigate(`/search?q=${encodeURIComponent(term)}`)
    onDone?.()
  }

  return (
    <form role="search" onSubmit={submit} className={className}>
      <label htmlFor="site-search" className="sr-only">
        Search products
      </label>
      <div className="relative">
        <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" aria-hidden />
        <input
          id="site-search"
          type="search"
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder="Search products…"
          className="w-full rounded-full border border-slate-200 bg-surface py-2 pl-9 pr-4 text-sm focus:border-royal-500 focus:bg-white focus:outline-none"
        />
      </div>
    </form>
  )
}

function CurrencyPicker() {
  const { currency, options, setCurrency } = useCurrency()
  if (options.length < 2) return null
  return (
    <div>
      <label htmlFor="currency" className="sr-only">
        Display currency
      </label>
      <select id="currency" value={currency} onChange={(e) => setCurrency(e.target.value)} className="h-9 rounded-full border border-slate-200 bg-white px-2 text-sm font-medium text-slate-700 focus:border-royal-500 focus:outline-none">
        {options.map((c) => (
          <option key={c.code} value={c.code}>
            {c.code}
          </option>
        ))}
      </select>
    </div>
  )
}

function AccountMenu() {
  const { user, status, logout, isStaff } = useAuth()
  const toast = useToast()
  const navigate = useNavigate()
  const [open, setOpen] = useState(false)
  const ref = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!open) return
    const close = (e: MouseEvent | KeyboardEvent) => {
      if (e instanceof KeyboardEvent ? e.key === 'Escape' : !ref.current?.contains(e.target as Node)) setOpen(false)
    }
    document.addEventListener('mousedown', close)
    document.addEventListener('keydown', close)
    return () => {
      document.removeEventListener('mousedown', close)
      document.removeEventListener('keydown', close)
    }
  }, [open])

  if (status !== 'authenticated' || !user) {
    return (
      <Link to="/login" aria-label="Log in" className="inline-flex h-10 items-center gap-2 rounded-full px-3 text-sm font-semibold text-slate-700 hover:bg-royal-50 hover:text-royal-600">
        <User className="h-5 w-5" aria-hidden />
        <span className="hidden sm:inline">Log in</span>
      </Link>
    )
  }

  const item = 'flex w-full items-center gap-2 px-4 py-2 text-sm text-slate-700 hover:bg-slate-50'
  return (
    <div className="relative" ref={ref}>
      <button type="button" aria-haspopup="menu" aria-expanded={open} onClick={() => setOpen((o) => !o)} className="inline-flex h-10 items-center gap-2 rounded-full pl-1 pr-3 text-sm font-semibold text-slate-700 hover:bg-royal-50">
        <span className="grid h-8 w-8 place-items-center rounded-full bg-navy-900 text-xs font-bold text-white">{(user.fullName ?? user.email).slice(0, 1).toUpperCase()}</span>
        <span className="hidden max-w-28 truncate sm:inline">{user.fullName?.split(' ')[0] ?? 'Account'}</span>
      </button>
      {open && (
        <div role="menu" className="absolute right-0 z-50 mt-2 w-56 overflow-hidden rounded-xl border border-slate-200 bg-white py-1 shadow-xl">
          <p className="truncate px-4 py-2 text-xs text-slate-500">{user.email}</p>
          <Link role="menuitem" to="/account" className={item} onClick={() => setOpen(false)}>
            <User className="h-4 w-4" aria-hidden /> My dashboard
          </Link>
          <Link role="menuitem" to="/account/orders" className={item} onClick={() => setOpen(false)}>
            <Package className="h-4 w-4" aria-hidden /> My orders
          </Link>
          <Link role="menuitem" to="/wishlist" className={item} onClick={() => setOpen(false)}>
            <Heart className="h-4 w-4" aria-hidden /> Wishlist
          </Link>
          {isStaff && (
            <Link role="menuitem" to="/admin" className={item} onClick={() => setOpen(false)}>
              <LayoutDashboard className="h-4 w-4" aria-hidden /> Admin dashboard
            </Link>
          )}
          <button
            role="menuitem"
            type="button"
            className={`${item} border-t border-slate-100 text-red-600`}
            onClick={async () => {
              setOpen(false)
              await logout().catch(() => undefined)
              toast.info('You have been logged out.')
              navigate('/')
            }}
          >
            <LogOut className="h-4 w-4" aria-hidden /> Log out
          </button>
        </div>
      )}
    </div>
  )
}

function IconLink({ to, label, icon, badge }: { to: string; label: string; icon: ReactNode; badge?: number }) {
  return (
    <Link to={to} aria-label={badge ? `${label} (${badge})` : label} className="relative grid h-10 w-10 place-items-center rounded-full text-slate-600 transition-colors hover:bg-royal-50 hover:text-royal-600">
      {icon}
      {!!badge && <span className="absolute right-0.5 top-0.5 grid h-5 min-w-5 place-items-center rounded-full bg-accent-500 px-1 text-[11px] font-bold text-white">{badge > 99 ? '99+' : badge}</span>}
    </Link>
  )
}

export function Layout() {
  const [menuOpen, setMenuOpen] = useState(false)
  const { data: cart } = useCart()
  const location = useLocation()

  useEffect(() => {
    setMenuOpen(false)
    window.scrollTo({ top: 0 })
  }, [location.pathname])

  return (
    <div className="flex min-h-screen flex-col bg-white">
      <a href="#main" className="sr-only focus:not-sr-only focus:absolute focus:left-2 focus:top-2 focus:z-50 focus:rounded focus:bg-white focus:px-3 focus:py-2">
        Skip to content
      </a>

      <header className="sticky top-0 z-40 border-b border-slate-200 bg-white/95 backdrop-blur">
        <div className="mx-auto flex h-16 max-w-7xl items-center gap-3 px-4 lg:gap-6">
          <button type="button" className="grid h-10 w-10 place-items-center rounded-full hover:bg-slate-100 md:hidden" aria-label={menuOpen ? 'Close menu' : 'Open menu'} aria-expanded={menuOpen} onClick={() => setMenuOpen((o) => !o)}>
            {menuOpen ? <X className="h-5 w-5" /> : <Menu className="h-5 w-5" />}
          </button>
          <Logo />
          <nav aria-label="Primary" className="hidden items-center gap-6 md:flex">
            {nav.map((n) => (
              <NavLink key={n.to} to={n.to} className={({ isActive }) => `text-sm font-medium transition-colors hover:text-royal-600 ${isActive ? 'text-royal-600' : 'text-slate-600'}`}>
                {n.label}
              </NavLink>
            ))}
          </nav>
          <SearchBox className="ml-auto hidden max-w-sm flex-1 lg:block" />
          <div className="ml-auto flex items-center gap-1 lg:ml-0">
            <CurrencyPicker />
            <IconLink to="/wishlist" label="Wishlist" icon={<Heart className="h-5 w-5" aria-hidden />} />
            <IconLink to="/cart" label="Cart" icon={<ShoppingCart className="h-5 w-5" aria-hidden />} badge={cart?.itemCount} />
            <AccountMenu />
          </div>
        </div>
        {menuOpen && (
          <div className="border-t border-slate-100 px-4 pb-4 pt-3 md:hidden">
            <SearchBox onDone={() => setMenuOpen(false)} />
            <nav aria-label="Mobile" className="mt-3 flex flex-col">
              {nav.map((n) => (
                <NavLink key={n.to} to={n.to} className={({ isActive }) => `rounded-lg px-3 py-2.5 text-sm font-medium ${isActive ? 'bg-royal-50 text-royal-600' : 'text-slate-700'}`}>
                  {n.label}
                </NavLink>
              ))}
            </nav>
          </div>
        )}
      </header>

      <main id="main" className="flex-1">
        <Outlet />
      </main>

      <footer className="bg-navy-950 text-slate-300">
        <div className="mx-auto grid max-w-7xl gap-8 px-4 py-12 sm:grid-cols-2 lg:grid-cols-4">
          <div>
            <p className="text-lg font-extrabold text-white">
              Vella<span className="text-accent-500">Market</span>
            </p>
            <p className="mt-3 text-sm text-slate-400">Shop from trusted Chinese suppliers and receive your order at your door.</p>
          </div>
          <FooterCol title="Company" links={[['/about', 'About Us'], ['/contact', 'Contact Us'], ['/faq', 'FAQ']]} />
          <FooterCol title="Shop" links={[['/shop', 'All Products'], ['/categories', 'Categories'], ['/request-product', 'Request a Product']]} />
          <FooterCol title="Legal" links={[['/terms', 'Terms & Conditions'], ['/privacy', 'Privacy Policy']]} />
        </div>
        <div className="border-t border-white/10 py-4 text-center text-xs text-slate-500">© {new Date().getFullYear()} Vella Market. All rights reserved.</div>
      </footer>
    </div>
  )
}

function FooterCol({ title, links }: { title: string; links: [string, string][] }) {
  return (
    <div>
      <p className="text-sm font-semibold text-white">{title}</p>
      <ul className="mt-3 space-y-2 text-sm">
        {links.map(([to, label]) => (
          <li key={to}>
            <Link to={to} className="text-slate-400 hover:text-white">
              {label}
            </Link>
          </li>
        ))}
      </ul>
    </div>
  )
}
