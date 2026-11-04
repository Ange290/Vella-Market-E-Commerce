import { createBrowserRouter } from 'react-router-dom'
import { GuestRoute, ProtectedRoute } from '@/components/ProtectedRoute'
import { Layout } from '@/components/layout/Layout'
import { CartPage } from '@/pages/CartPage'
import { CategoriesPage, CategoryRedirect } from '@/pages/CategoriesPage'
import { CheckoutPage } from '@/pages/CheckoutPage'
import { DevMockPayPage } from '@/pages/DevMockPayPage'
import { HomePage } from '@/pages/HomePage'
import { NotFoundPage } from '@/pages/NotFoundPage'
import { OrderDetailPage } from '@/pages/OrderDetailPage'
import { OrdersPage } from '@/pages/OrdersPage'
import { PaymentReturnPage } from '@/pages/PaymentReturnPage'
import { PlaceholderPage } from '@/pages/PlaceholderPage'
import { ProductDetailPage } from '@/pages/ProductDetailPage'
import { ShopPage } from '@/pages/ShopPage'
import { TrackPage } from '@/pages/TrackPage'
import { WishlistPage } from '@/pages/WishlistPage'
import { ForgotPasswordPage } from '@/pages/auth/ForgotPasswordPage'
import { LoginPage } from '@/pages/auth/LoginPage'
import { RegisterPage } from '@/pages/auth/RegisterPage'
import { VerifyOtpPage } from '@/pages/auth/VerifyOtpPage'

// Pages still on the roadmap render a clearly labelled placeholder (see docs/ARCHITECTURE.md).
const placeholder = (title: string) => <PlaceholderPage title={title} />

export const router = createBrowserRouter([
  {
    path: '/',
    element: <Layout />,
    children: [
      { index: true, element: <HomePage /> },

      // Storefront
      { path: 'shop', element: <ShopPage /> },
      { path: 'search', element: <ShopPage mode="search" /> },
      { path: 'categories', element: <CategoriesPage /> },
      { path: 'categories/:slug', element: <CategoryRedirect /> },
      { path: 'products/:slug', element: <ProductDetailPage /> },

      // Authentication (signed-in users are redirected away)
      {
        element: <GuestRoute />,
        children: [
          { path: 'register', element: <RegisterPage /> },
          { path: 'login', element: <LoginPage /> },
          { path: 'forgot-password', element: <ForgotPasswordPage /> },
        ],
      },
      { path: 'verify-otp', element: <VerifyOtpPage /> },

      // Signed-in customers
      {
        element: <ProtectedRoute />,
        children: [
          { path: 'wishlist', element: <WishlistPage /> },
          { path: 'cart', element: <CartPage /> },
          { path: 'checkout', element: <CheckoutPage /> },
          { path: 'payment/return', element: <PaymentReturnPage /> },
          { path: 'account', element: placeholder('My Dashboard') },
          { path: 'account/orders', element: <OrdersPage /> },
          { path: 'account/orders/:id', element: <OrderDetailPage /> },
          { path: 'account/profile', element: placeholder('My Profile') },
          { path: 'account/addresses', element: placeholder('Delivery Addresses') },
          { path: 'track', element: <TrackPage /> },
          { path: 'track/:orderNumber', element: <TrackPage /> },
          { path: 'request-product', element: placeholder('Request a Product') },
        ],
      },

      // Static content (loaded from the content API in a later slice)
      { path: 'about', element: placeholder('About Us') },
      { path: 'contact', element: placeholder('Contact Us') },
      { path: 'faq', element: placeholder('Frequently Asked Questions') },
      { path: 'terms', element: placeholder('Terms and Conditions') },
      { path: 'privacy', element: placeholder('Privacy Policy') },

      // Simulated provider page: exists only in development builds (the mock gateway is refused in production).
      ...(import.meta.env.DEV ? [{ path: 'dev/mock-pay', element: <DevMockPayPage /> }] : []),

      { path: '*', element: <NotFoundPage /> },
    ],
  },
])
