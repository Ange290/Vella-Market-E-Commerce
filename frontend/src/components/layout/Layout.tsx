import { Heart, Search, ShoppingCart, User } from 'lucide-react'
import { Link, NavLink, Outlet } from 'react-router-dom'

const nav = [
  { to: '/shop', label: 'Shop' },
  { to: '/categories', label: 'Categories' },
  { to: '/request-product', label: 'Request a Product' },
  { to: '/track', label: 'Track Order' },
]

export function Layout() {
  return (
    <div className="flex min-h-screen flex-col bg-white">
      <a
        href="#main"
        className="sr-only focus:not-sr-only focus:absolute focus:left-2 focus:top-2 focus:z-50 focus:rounded focus:bg-white focus:px-3 focus:py-2"
      >
        Skip to content
      </a>

      <header className="sticky top-0 z-40 border-b border-slate-200 bg-white/95 backdrop-blur">
        <div className="mx-auto flex h-16 max-w-7xl items-center gap-6 px-4">
          <Link to="/" className="flex items-center gap-2 text-xl font-extrabold tracking-tight text-navy-900">
            <span className="grid h-8 w-8 place-items-center rounded-lg bg-navy-900 text-white">V</span>
            Vella<span className="text-accent-500">Market</span>
          </Link>

          <nav aria-label="Primary" className="hidden items-center gap-6 md:flex">
            {nav.map((n) => (
              <NavLink
                key={n.to}
                to={n.to}
                className={({ isActive }) =>
                  `text-sm font-medium transition-colors hover:text-royal-600 ${isActive ? 'text-royal-600' : 'text-slate-600'}`
                }
              >
                {n.label}
              </NavLink>
            ))}
          </nav>

          <form role="search" action="/search" className="ml-auto hidden max-w-sm flex-1 lg:block">
            <label htmlFor="site-search" className="sr-only">
              Search products
            </label>
            <div className="relative">
              <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
              <input
                id="site-search"
                name="q"
                type="search"
                placeholder="Search products…"
                className="w-full rounded-full border border-slate-200 bg-surface py-2 pl-9 pr-4 text-sm focus:border-royal-500 focus:bg-white"
              />
            </div>
          </form>

          <div className="ml-auto flex items-center gap-1 lg:ml-0">
            <IconLink to="/wishlist" label="Wishlist" icon={<Heart className="h-5 w-5" />} />
            <IconLink to="/cart" label="Cart" icon={<ShoppingCart className="h-5 w-5" />} />
            <IconLink to="/login" label="Account" icon={<User className="h-5 w-5" />} />
          </div>
        </div>
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
            <p className="mt-3 text-sm text-slate-400">
              Shop from trusted Chinese suppliers and receive your order at your door.
            </p>
          </div>
          <FooterCol title="Company" links={[['/about', 'About Us'], ['/contact', 'Contact Us'], ['/faq', 'FAQ']]} />
          <FooterCol title="Shop" links={[['/shop', 'All Products'], ['/categories', 'Categories'], ['/request-product', 'Request a Product']]} />
          <FooterCol title="Legal" links={[['/terms', 'Terms & Conditions'], ['/privacy', 'Privacy Policy']]} />
        </div>
        <div className="border-t border-white/10 py-4 text-center text-xs text-slate-500">
          © {new Date().getFullYear()} Vella Market. All rights reserved.
        </div>
      </footer>
    </div>
  )
}

function IconLink({ to, label, icon }: { to: string; label: string; icon: React.ReactNode }) {
  return (
    <Link
      to={to}
      aria-label={label}
      className="grid h-10 w-10 place-items-center rounded-full text-slate-600 transition-colors hover:bg-royal-50 hover:text-royal-600"
    >
      {icon}
    </Link>
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
