import { createBrowserRouter } from 'react-router-dom'
import { Layout } from '@/components/layout/Layout'
import { HomePage } from '@/pages/HomePage'
import { PlaceholderPage } from '@/pages/PlaceholderPage'

// Every customer-facing route from the spec is registered now; pages are replaced by real
// implementations module by module (see docs/ARCHITECTURE.md roadmap).
const placeholders: [path: string, title: string][] = [
  ['shop', 'Shop'],
  ['categories', 'Categories'],
  ['categories/:slug', 'Category'],
  ['products/:slug', 'Product Details'],
  ['search', 'Search Results'],
  ['cart', 'Shopping Cart'],
  ['checkout', 'Checkout'],
  ['register', 'Create Account'],
  ['login', 'Log In'],
  ['verify-otp', 'Verify Your Account'],
  ['forgot-password', 'Forgot Password'],
  ['account', 'My Dashboard'],
  ['account/orders', 'My Orders'],
  ['account/orders/:id', 'Order Details'],
  ['track', 'Order Tracking'],
  ['wishlist', 'Wishlist'],
  ['account/profile', 'My Profile'],
  ['account/addresses', 'Delivery Addresses'],
  ['request-product', 'Request a Product'],
  ['about', 'About Us'],
  ['contact', 'Contact Us'],
  ['faq', 'Frequently Asked Questions'],
  ['terms', 'Terms and Conditions'],
  ['privacy', 'Privacy Policy'],
  ['*', 'Page not found'],
]

export const router = createBrowserRouter([
  {
    path: '/',
    element: <Layout />,
    children: [
      { index: true, element: <HomePage /> },
      ...placeholders.map(([path, title]) => ({ path, element: <PlaceholderPage title={title} /> })),
    ],
  },
])
