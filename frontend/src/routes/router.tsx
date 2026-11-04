import { createBrowserRouter } from 'react-router-dom'
import { GuestRoute, ProtectedRoute } from '@/components/ProtectedRoute'
import { Layout } from '@/components/layout/Layout'
import { CategoriesPage, CategoryRedirect } from '@/pages/CategoriesPage'
import { HomePage } from '@/pages/HomePage'
import { NotFoundPage } from '@/pages/NotFoundPage'
import { PlaceholderPage } from '@/pages/PlaceholderPage'
import { ProductDetailPage } from '@/pages/ProductDetailPage'
import { ShopPage } from '@/pages/ShopPage'
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
          { path: 'cart', element: placeholder('Shopping Cart') },
          { path: 'checkout', element: placeholder('Checkout') },
          { path: 'account', element: placeholder('My Dashboard') },
          { path: 'account/orders', element: placeholder('My Orders') },
          { path: 'account/orders/:id', element: placeholder('Order Details') },
          { path: 'account/profile', element: placeholder('My Profile') },
          { path: 'account/addresses', element: placeholder('Delivery Addresses') },
          { path: 'track', element: placeholder('Order Tracking') },
          { path: 'request-product', element: placeholder('Request a Product') },
        ],
      },

      // Static content (loaded from the content API in a later slice)
      { path: 'about', element: placeholder('About Us') },
      { path: 'contact', element: placeholder('Contact Us') },
      { path: 'faq', element: placeholder('Frequently Asked Questions') },
      { path: 'terms', element: placeholder('Terms and Conditions') },
      { path: 'privacy', element: placeholder('Privacy Policy') },

      { path: '*', element: <NotFoundPage /> },
    ],
  },
])
