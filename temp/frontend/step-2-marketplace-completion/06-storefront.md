# 06: Public shop, product pages and keyword search

| Field | Value |
| --- | --- |
| Status | Planned |
| Implemented | No |
| Depends on | 05 |
| Blocks | Buyer cart and full purchase journey |

## Read and reuse

Read design sections 6.8, 7 and 8, `catalogue/storefront.ts`, `storefront-types.ts`, `search/service.ts`, `apps/web/src/lib/storefront.ts` and the cache handler.
Existing APIs include `/api/home`, `/api/categories/[slug]/products`, `/api/products/[slug]`, `/api/search`, `/api/brands`, `/api/company`.
Public wrappers already provide `readHomePage`, `readCategoryPage`, `readProductPage`, content/review/company reads.
Do not keep the old claim that product APIs are unavailable after backend integration.

## Frontend work

Replace the home introduction-only presentation with real new-arrival/category product sections while preserving the visual system and account controls.
Add proposed `/categories/[slug]`, `/products/[slug]` and `/search` pages.
Render category breadcrumbs/children using the existing tree and DTOs.
Add real product cards with ready cover photo, alt text, rupee price/range, MRP where meaningful, rating, availability and minimum buying quantity.
Link only to real pages and remove obsolete coming-soon copy once those journeys work.

Keep filters/sort/search/cursor in URL state for reload, sharing and back navigation.
Use the exact supported sorts and query keys; price filters must convert rupees to integer paise without float rounding errors.
Reset cursors when query/filter/sort changes and preserve opaque cursors unmodified.
Use keyset pagination, not page-number OFFSET assumptions.
Show keyword similar-word fallback honestly and distinguish no results, loading, error and rate limit states.

Product detail needs ordered featured/supporting images, optional converted video/poster with controls and no forced autoplay, description, highlights, attributes, variant options, seller label, price and minimum notice.
Start quantity at the product minimum and only allow available variant choices.
Public variants expose availability, not exact stock; do not invent or leak stock counts or private SKU/tax identifiers.
Wire Add to cart in task 07; before then omit or clearly disable unfinished actions with an explanation.
Add metadata, stable canonical URLs and not-found behaviour using actual server results.
Do not render raw Markdown or model text as HTML.

## Backend and caching work

Reuse existing public reads and service-based invalidation; no new catalogue read engine is needed.
Server-render public data with anonymous cached wrappers and the installed Next.js cache guidance.
Keep account controls separate from cached public product data.
Do not cache search paths that intentionally log and rate-limit each request.
Prove visibility changes caused by approve/reject/take-down, seller suspension, category/brand changes, price/minimum changes and worker media completion.
Test warmed cache entries, including previously missing slugs, rather than only cold reads.

## Automated acceptance

| ID | Scenario | Required result |
| --- | --- | --- |
| F01 | Home/category/detail with approved, rejected, draft and suspended-seller fixtures | Only allowed published products visible |
| F02 | Filters, price range, sort, cursor, back/reload | Correct stable results and retained URL state; no duplicates on unchanged dataset |
| F03 | Cover reorder and ready video | Card uses cover; detail shows ordered gallery and converted video |
| F04 | Minimum 10 with variant stock below floor | Minimum displayed; unavailable choice cannot be added |
| F05 | Warm caches, then mutate via admin and worker | New public reads reflect invalidation without process restart |
| F06 | Unknown slug, malformed filter, empty search, rate limit | Appropriate 404/validation/empty/retry UI, no crash |
| F07 | Phone/desktop, keyboard gallery and axe scan | No document overflow; labelled controls and accessible media |

Add proposed `e2e/storefront.spec.ts`, `search.spec.ts` and `storefront-cache.spec.ts`.
Retain existing storefront, search and cache integration tests.
Run relevant package tests and proposed browser suites plus lint/typecheck.
Completion evidence is pending.
