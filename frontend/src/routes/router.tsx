import type { ComponentType } from 'react'
import { createBrowserRouter, type RouteObject } from 'react-router-dom'
import { GuestRoute, ProtectedRoute } from '@/components/ProtectedRoute'
import { AccountLayout } from '@/components/layout/AccountLayout'
import { Layout } from '@/components/layout/Layout'
import { Spinner } from '@/components/ui/feedback'
import { HomePage } from '@/pages/HomePage'

/**
 * Route-level code splitting: every page except the landing page is fetched when first visited,
 * which keeps the initial download small as the app grows.
 */
function page<M extends Record<string, unknown>>(load: () => Promise<M>, name: keyof M, props?: Record<string, unknown>): Pick<RouteObject, 'lazy'> {
  return {
    lazy: async () => {
      const Page = (await load())[name] as ComponentType<Record<string, unknown>>
      return { Component: props ? () => <Page {...props} /> : Page }
    },
  }
}

export const router = createBrowserRouter([
  {
    path: '/',
    element: <Layout />,
    HydrateFallback: () => <Spinner label="Loading Vella Market" />,
    children: [
      { index: true, element: <HomePage /> },

      // Storefront
      { path: 'shop', ...page(() => import('@/pages/ShopPage'), 'ShopPage') },
      { path: 'search', ...page(() => import('@/pages/ShopPage'), 'ShopPage', { mode: 'search' }) },
      { path: 'categories', ...page(() => import('@/pages/CategoriesPage'), 'CategoriesPage') },
      { path: 'categories/:slug', ...page(() => import('@/pages/CategoriesPage'), 'CategoryRedirect') },
      { path: 'products/:slug', ...page(() => import('@/pages/ProductDetailPage'), 'ProductDetailPage') },

      // Authentication (signed-in users are redirected away)
      {
        element: <GuestRoute />,
        children: [
          { path: 'register', ...page(() => import('@/pages/auth/RegisterPage'), 'RegisterPage') },
          { path: 'login', ...page(() => import('@/pages/auth/LoginPage'), 'LoginPage') },
          { path: 'forgot-password', ...page(() => import('@/pages/auth/ForgotPasswordPage'), 'ForgotPasswordPage') },
        ],
      },
      { path: 'verify-otp', ...page(() => import('@/pages/auth/VerifyOtpPage'), 'VerifyOtpPage') },

      // Signed-in customers
      {
        element: <ProtectedRoute />,
        children: [
          { path: 'wishlist', ...page(() => import('@/pages/WishlistPage'), 'WishlistPage') },
          { path: 'cart', ...page(() => import('@/pages/CartPage'), 'CartPage') },
          { path: 'checkout', ...page(() => import('@/pages/CheckoutPage'), 'CheckoutPage') },
          { path: 'payment/return', ...page(() => import('@/pages/PaymentReturnPage'), 'PaymentReturnPage') },
          { path: 'track', ...page(() => import('@/pages/TrackPage'), 'TrackPage') },
          { path: 'track/:orderNumber', ...page(() => import('@/pages/TrackPage'), 'TrackPage') },
          { path: 'request-product', ...page(() => import('@/pages/account/RequestProductPage'), 'RequestProductPage') },
          {
            path: 'account',
            element: <AccountLayout />,
            children: [
              { index: true, ...page(() => import('@/pages/account/AccountPage'), 'AccountPage') },
              { path: 'orders', ...page(() => import('@/pages/OrdersPage'), 'OrdersPage') },
              { path: 'orders/:id', ...page(() => import('@/pages/OrderDetailPage'), 'OrderDetailPage') },
              { path: 'requests', ...page(() => import('@/pages/account/RequestsPage'), 'RequestsPage') },
              { path: 'requests/:id', ...page(() => import('@/pages/account/RequestDetailPage'), 'RequestDetailPage') },
              { path: 'addresses', ...page(() => import('@/pages/account/AddressesPage'), 'AddressesPage') },
              { path: 'profile', ...page(() => import('@/pages/account/ProfilePage'), 'ProfilePage') },
            ],
          },
        ],
      },

      // Public information pages. Text is managed in the admin area (content API).
      { path: 'about', ...page(() => import('@/pages/ContentPage'), 'ContentPage', { slug: 'about', fallbackTitle: 'About Us' }) },
      { path: 'faq', ...page(() => import('@/pages/ContentPage'), 'ContentPage', { slug: 'faq', fallbackTitle: 'Frequently Asked Questions' }) },
      { path: 'terms', ...page(() => import('@/pages/ContentPage'), 'ContentPage', { slug: 'terms', fallbackTitle: 'Terms and Conditions' }) },
      { path: 'privacy', ...page(() => import('@/pages/ContentPage'), 'ContentPage', { slug: 'privacy', fallbackTitle: 'Privacy Policy' }) },
      { path: 'contact', ...page(() => import('@/pages/ContactPage'), 'ContactPage') },

      // Simulated provider page: exists only in development builds (the mock gateway is refused in production).
      ...(import.meta.env.DEV ? [{ path: 'dev/mock-pay', ...page(() => import('@/pages/DevMockPayPage'), 'DevMockPayPage') }] : []),

      { path: '*', ...page(() => import('@/pages/NotFoundPage'), 'NotFoundPage') },
    ],
  },
])
