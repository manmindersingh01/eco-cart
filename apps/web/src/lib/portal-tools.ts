import type { Route } from 'next'

export type PortalTool = {
  href: Route
  label: string
  description: string
  action: string
}

export const adminTools = [
  {
    href: '/admin/orders',
    label: 'Orders',
    description:
      'Find orders, track fulfilment and handle cancellations, refunds and invoices.',
    action: 'Manage orders',
  },
  {
    href: '/admin/returns',
    label: 'Returns',
    description:
      'Review return requests and record refunds made outside EcoKart.',
    action: 'Review returns',
  },
  {
    href: '/admin/reviews',
    label: 'Review moderation',
    description: 'Review customer feedback and manage its public visibility.',
    action: 'Moderate reviews',
  },
  {
    href: '/admin/coupons',
    label: 'Coupons',
    description: 'Create and maintain discount codes and their usage limits.',
    action: 'Manage coupons',
  },
  {
    href: '/admin/content',
    label: 'Policy pages',
    description: 'Edit and publish the marketplace policy pages.',
    action: 'Manage policies',
  },
  {
    href: '/admin/background-work',
    label: 'Background work',
    description: 'Check queued work and review or retry failed emails.',
    action: 'View background work',
  },
  {
    href: '/admin/ai',
    label: 'AI usage',
    description:
      "Review AI calls, failures, tokens, reported costs and today's allowance.",
    action: 'View AI usage',
  },
  {
    href: '/admin/search-gaps',
    label: 'Search gaps',
    description:
      'See text searches that found no products to help plan the catalogue.',
    action: 'View search gaps',
  },
  {
    href: '/admin/payouts',
    label: 'Payouts',
    description:
      'Review seller balances and record transfers made outside EcoKart.',
    action: 'Manage payouts',
  },
  {
    href: '/admin/settings',
    label: 'Platform settings',
    description:
      'Manage commerce values, payment options, the return window, AI limits, moderation terms and company details.',
    action: 'Manage settings',
  },
  {
    href: '/admin/sellers',
    label: 'Sellers',
    description:
      'Create seller accounts, maintain business details and manage approval or suspension.',
    action: 'Manage sellers',
  },
  {
    href: '/admin/seller-documents',
    label: 'Document review',
    description:
      'Review private seller verification documents and request corrections.',
    action: 'Review documents',
  },
  {
    href: '/admin/categories',
    label: 'Categories',
    description:
      'Maintain the three-level category tree, GST rates, HSN defaults and public visibility.',
    action: 'Manage categories',
  },
  {
    href: '/admin/brands',
    label: 'Brands',
    description: 'Search and maintain the brand choices available to sellers.',
    action: 'Manage brands',
  },
  {
    href: '/admin/moderation',
    label: 'Product moderation',
    description:
      'Review submitted listings and decide which products may be published.',
    action: 'Moderate products',
  },
] as const satisfies readonly PortalTool[]

export const sellerTools = [
  {
    href: '/seller/profile',
    label: 'Business profile',
    description:
      'Review legal, tax, address, invoice, commission and status details. Update your display name and customer support contacts.',
    action: 'View business profile',
  },
  {
    href: '/seller/documents',
    label: 'Documents',
    description:
      'Upload and follow the review of your business verification documents.',
    action: 'View documents',
  },
  {
    href: '/seller/products',
    label: 'Products',
    description:
      'Create and manage product listings, variants, media and listing suggestions. Pending sellers can prepare drafts while public selling waits for approval.',
    action: 'Manage products',
  },
  {
    href: '/seller/orders',
    label: 'Orders',
    description:
      'Find orders waiting for dispatch, record tracking and mark parcels delivered.',
    action: 'Manage orders',
  },
  {
    href: '/seller/returns',
    label: 'Returns',
    description:
      "Follow returns for your products and the administrator's decisions.",
    action: 'View returns',
  },
  {
    href: '/seller/earnings',
    label: 'Earnings',
    description:
      'Review your ledger, masked bank details and settlement statements.',
    action: 'View earnings',
  },
  {
    href: '/seller/invoices',
    label: 'Invoices',
    description: 'Find and download GST invoices for your orders.',
    action: 'View invoices',
  },
  {
    href: '/seller/imports',
    label: 'Catalogue imports',
    description:
      'Import a spreadsheet and review column mapping suggestions before confirming.',
    action: 'Manage imports',
  },
] as const satisfies readonly PortalTool[]

export const adminNavigation = [
  { href: '/admin', label: 'Overview' },
  ...adminTools,
] as const
export const sellerNavigation = [
  { href: '/seller', label: 'Overview' },
  ...sellerTools,
] as const
