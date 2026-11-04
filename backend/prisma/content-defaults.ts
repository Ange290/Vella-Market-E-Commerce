/**
 * Default text for the public pages. Seeded once; admins edit it afterwards in the dashboard.
 *
 * IMPORTANT: the Terms and Privacy Policy are a *working draft* describing how the platform behaves.
 * They are not legal advice and must be reviewed by a qualified lawyer (and completed with the company's
 * legal name, address, contact details and applicable-law clauses) before launch.
 */
export const PLACEHOLDER_MARKER = 'Placeholder content';

export const CONTENT_DEFAULTS: Record<string, { title: string; body: string }> = {
  about: {
    title: 'About Vella Market',
    body: `# About Vella Market

Vella Market helps people in Rwanda, and soon across the region, buy products from trusted Chinese suppliers and receive them at their door.

## What we do

- **A curated catalogue.** Browse products we have already vetted, with clear prices, sizes, colours and delivery times.
- **Sourcing on request.** Can't find it? Send us a product link or a photo. We find it, quote you a transparent price, and buy it for you.
- **Transparent pricing.** Before you pay you see every charge: the product, shipping, our service fee and any taxes. No surprises.
- **Secure payment.** Pay with mobile money or card through a verified payment partner. We never see or store your card details.
- **Tracked delivery.** Follow your order from the supplier in China to your address.

## Our promise

We tell you what you will pay, what happens next, and where your parcel is. If something goes wrong, our team is here to help.

[Browse the shop](/shop) or [request a product](/request-product).`,
  },
  faq: {
    title: 'Frequently Asked Questions',
    body: `# Frequently Asked Questions

## Ordering

**How do I place an order?**
Add products to your cart, choose your delivery address and delivery method, review the itemised total, and pay. You need a verified account to check out.

**Can you buy something that isn't in your catalogue?**
Yes. Use [Request a Product](/request-product) and send a link or photo. We reply with a quotation showing the product cost, shipping, service fee and taxes. If you accept, it becomes an order.

**How long is a quotation valid?**
Each quotation shows its expiry date. After that you can ask us for a new one.

## Prices and payment

**What currencies do you show?**
Prices are held in Chinese yuan (CNY) and converted to the currency you choose using our current exchange rate. Your order is charged in the currency shown at checkout, and the rate used is recorded on your order.

**How can I pay?**
MTN Mobile Money, Airtel Money and bank cards are supported. Mobile money is paid in Rwandan francs.

**What does the total include?**
The product price, shipping, our service fee and applicable taxes. All of them are listed before you pay.

**Is my payment safe?**
Payments are completed on our payment partner's secure page. We never see or store your card details.

## Delivery

**How long does delivery take?**
Each product page shows its processing time and shipping time. These are estimates; customs and carrier delays can affect them.

**How do I track my order?**
Open [Track Order](/track) and enter your order reference, or open the order in your account. You will see every status update and, once shipped, the carrier's tracking events.

**Will I pay customs or import duties?**
Any taxes we charge are shown at checkout. If your country's customs authority applies additional charges on arrival, they are not controlled by us.

## Cancellations and refunds

**Can I cancel my order?**
You can cancel online until you have paid. After payment, contact support and we will help.

**How do refunds work?**
Approved refunds are returned to the payment method you used. The time it takes depends on your bank or mobile-money provider.

## Account

**I didn't get my verification code.**
Check your spam folder, then use "Resend code". Codes expire after 5 minutes.

**I forgot my password.**
Use [Forgot password](/forgot-password) to receive a reset code by email.

Still need help? [Contact us](/contact).`,
  },
  terms: {
    title: 'Terms and Conditions',
    body: `# Terms and Conditions

> **Draft.** This text describes how Vella Market works. It must be reviewed by a qualified lawyer and completed with the operating company's legal details before launch.

## 1. About these terms
By creating an account or placing an order you agree to these terms. If you do not agree, please do not use the service.

## 2. Accounts
You must provide accurate information and keep your login details private. You are responsible for activity on your account. We may suspend accounts that are used fraudulently or abusively.

## 3. Products and prices
Product information is provided by our suppliers and may contain small errors. Prices are held in Chinese yuan and converted to your chosen currency at the exchange rate shown at checkout. The total you pay is shown before you confirm your order and includes the product cost, shipping, our service fee and any applicable taxes.

## 4. Orders and payment
An order is created when you confirm checkout and becomes active once your payment has been confirmed by our payment provider. We may cancel an order if a product is unavailable or a payment cannot be verified; in that case you are refunded in full.

## 5. Sourcing requests and quotations
You may ask us to source a product. A quotation is an offer valid until the date shown. When you accept it, an order is created for the quoted amount. We are not obliged to quote every request.

## 6. Delivery
Delivery times are estimates and are not guaranteed. Risk in the goods passes to you on delivery. Customs duties or taxes charged by authorities in your country on arrival, if any, are your responsibility unless stated at checkout.

## 7. Cancellations and refunds
You may cancel an order online before you pay. After payment, contact support. Refunds are made to the original payment method. Items that arrive damaged, incorrect or significantly different from the listing should be reported to support promptly with photos.

## 8. Prohibited items
You may not order goods that are illegal to import into the destination country. We may refuse any order or request at our discretion.

## 9. Liability
To the extent permitted by law, we are not liable for indirect or consequential losses, or for delays caused by carriers, customs or events outside our control. Nothing in these terms limits liability that cannot be limited by law.

## 10. Changes
We may update these terms. The version in force when you place an order applies to that order.

## 11. Contact
Questions about these terms? Use our [contact form](/contact).`,
  },
  privacy: {
    title: 'Privacy Policy',
    body: `# Privacy Policy

> **Draft.** This text describes how Vella Market handles data. It must be reviewed by a qualified lawyer and completed with the data controller's legal details before launch.

## What we collect
- **Account details:** your name, email address, phone number, country and delivery addresses.
- **Order information:** the items you buy, prices, delivery details, and order and shipment history.
- **Payment information:** the payment method type, amount, status and provider reference. **We never see or store your card number or mobile-money PIN**; these are entered on our payment partner's secure page.
- **Support and requests:** messages you send us and product requests you submit, including links and photos.
- **Technical data:** limited security information such as IP address and browser type, used to protect your account.

## How we use it
- to create your account, verify your email and keep it secure;
- to process, ship and track your orders and give you support;
- to take payments and issue refunds through our payment provider;
- to send service messages such as verification codes and order updates;
- to prevent fraud and meet legal obligations.

## Who we share it with
We share only what is needed with: our payment provider (to take payment), carriers and logistics partners (to deliver your order, including your name, address and phone number), suppliers (to fulfil your order; we do not give them your contact details unless needed), and email/SMS providers (to send verification codes). We do not sell your personal data.

## Security
Passwords are stored using strong one-way hashing. Verification codes are stored hashed and expire after 5 minutes. Sessions use short-lived tokens, and access to administrative tools is restricted and logged.

## Your choices and rights
You can view and update your profile and addresses in your account. You may ask us to correct or delete your data, subject to records we must keep (for example order and payment records). Contact us using the form on our [contact page](/contact).

## Retention
We keep account and order data for as long as your account is active and as needed to meet legal, tax and dispute-handling requirements.

## Changes
If we change this policy we will update this page.`,
  },
};
