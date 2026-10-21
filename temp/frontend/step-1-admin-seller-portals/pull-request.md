# Pull request: admin and seller portal foundation

## Target

Target the reviewed `windows/fixes` successor used by this branch.

## Problem and result

EcoKart had backend support for authentication, settings, seller administration, catalogue administration, seller profiles, and draft product management, but it did not have a complete user-facing implementation for those capabilities.
This change delivers the responsive administrator and seller portals, email-code authentication, draft listing and photo management, and a public home page backed only by the catalogue APIs that currently exist.

## Delivered routes

- `/` provides the public EcoKart introduction, active category hierarchy, and bounded active-brand discovery.
- `/sign-in` provides the email-code authentication journey.
- `/admin`, `/admin/settings`, `/admin/sellers`, `/admin/sellers/new`, `/admin/sellers/[id]`, `/admin/categories`, and `/admin/brands` provide the current administrator tools.
- `/seller`, `/seller/profile`, `/seller/products`, `/seller/products/new`, and `/seller/products/[id]` provide the current seller tools.
- Custom loading, not-found, access-denied, and unexpected-error states cover route recovery.

## Public API boundary

The public page uses `GET /api/categories` and `GET /api/brands?q=&cursor=&limit=`.
It does not invent products or link to unavailable category, brand, product, search, cart, or checkout routes.
Category and brand reads are cached for one hour and the matching administrator mutations revalidate those caches.

## Explicit non-goals

Backend step 7 listing submission and review, step 8 imports, step 9 public product search, and later cart, checkout, payment, order, fulfilment, return, invoice, and earnings work remain outside this pull request.
Production email and SMS delivery and end-to-end test infrastructure also remain outside this pull request.

## Automated verification

| Check | Result on 18 October 2026 |
| --- | --- |
| `pnpm format:check` | Passed |
| `pnpm lint` | Passed |
| `pnpm typecheck` | Passed in core, web, and worker |
| `pnpm test` | Passed 407 tests across 43 test files |
| `pnpm build` | Passed with Next.js 16.3.7 |
| `pnpm check` | Passed the complete CI-equivalent sequence |

## Manual verification

| Role | Chrome phone | Chrome desktop | Safari phone | Safari desktop |
| --- | --- | --- | --- | --- |
| Visitor or buyer | Pending final journey | Pending final journey | Pending | Pending |
| Administrator | Pending final journey | Pending final journey | Pending | Pending |
| Seller | Pending final journey | Pending final journey | Pending | Pending |

Automated Chrome rendering passed at 390 by 844 and 1440 by 900 with no page-level horizontal overflow.
Manual role, keyboard, screen-reader, 200 percent zoom, and Safari checks remain before the pull request completion gate can be marked complete.
