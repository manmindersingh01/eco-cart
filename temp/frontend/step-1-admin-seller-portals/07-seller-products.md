# T07: Seller product list and draft creation

| Field | Value |
| --- | --- |
| Status | `implemented_pending_t08_and_manual_verification` |
| Implemented | No - list and creation pass; T08 detail handoff and final browser verification remain |
| Depends on | T05, T06 |
| Blocks | T08 |

## Goal

Let a seller browse their catalogue and create a valid draft with one or more initial variants.

## API contract

- `GET /api/seller/products?status=&cursor=&limit=` returns `{ items, nextCursor }` newest first.
- Status values are `draft`, `pending_review`, `approved`, `rejected`, and `archived`.
- `POST /api/seller/products` returns `{ product }` with status 201.
- Public `GET /api/categories` returns the active category tree.
- Public `GET /api/brands?q=&cursor=&limit=` returns active brands alphabetically.

A product creation body includes:

- `categoryId`;
- nullable `brandId`;
- title from 3 to 150 characters;
- optional description up to 5000 characters;
- up to 8 highlights, each up to 200 characters;
- up to 30 attribute name/value entries;
- nullable HSN code with 4, 6, or 8 digits;
- up to 3 option names;
- 1 to 100 variants.

Each variant includes SKU, an option-value object, price in paise, MRP in paise, stock, and optional active state.
MRP must be at least the selling price.

## Deliverables

- Build `/seller/products` with status filtering, newest-first cards or rows, cursor pagination, and a clear create action.
- Show title, category, status, price range, total stock, thumbnail or placeholder, and last update.
- Show rejection reason prominently when a rejected product appears in returned detail data.
- Build `/seller/products/new` as a guided but single-page draft form.
- Load active categories and brands from the existing public APIs.
- Use a leaf-aware category selector with visible breadcrumb paths.
- Search brands without loading an unbounded list.
- Support dynamic highlights, attributes, option names, and variants.
- Convert rupee inputs to paise exactly.
- After creation, navigate to `/seller/products/{id}` for photos and further editing.

## Variant form rules

Option names define each variant's option keys.
When an option name changes before creation, update the matching key without silently losing entered values.
Reject duplicate option names ignoring case.
Require every variant to have exactly one value for every configured option name.
Prevent duplicate variant option combinations in the browser and still show the backend conflict if received.
Keep SKU visible at phone width.

The first form state should support a simple product with no named options and one variant.
Do not force a seller to create colour or size options.

## Acceptance criteria

- Seeded products render with correct INR values and status labels.
- Status filtering and next-page navigation preserve the selected filter.
- Empty and no-match states offer an appropriate next action.
- A pending seller can create a draft.
- A seller can create a simple one-variant draft.
- A seller can create a product with multiple option names and variants.
- Category paths disambiguate repeated child names.
- Brand search handles loading, no matches, pagination, and clearing.
- Client-side limits match backend limits but backend issues remain authoritative.
- Entered data survives validation and conflict responses.
- The new product opens in the detail editor after creation.

## Verification plan

- Unit test currency conversion, option-key mapping, duplicate combination detection, and request serialization.
- Test list filter and cursor URL construction.
- Through the real API, create one simple draft and one two-variant draft as a seeded seller.
- Verify a rejected MRP/price combination displays `variants.0.mrpPaise must be at least pricePaise` or the current backend text.
- Run web typecheck, lint, relevant tests, and build.

## Completion evidence

Implementation evidence, 10 October 2026:

- Added Products to the protected seller navigation and activated Manage products on the seller overview for pending and approved sellers.
- Built `/seller/products` as a server-rendered, newest-first product list with All, Draft, Pending review, Approved, Rejected, and Archived filters.
- Added opaque cursor pagination that retains the selected status and remembers Previous-page cursors during the current browser visit.
- Product rows and phone cards show thumbnail or placeholder, title, category, plain-text status, Indian-formatted price or price range, total stock, and last update in India time.
- Added status-specific empty states with View all products and Create draft actions where appropriate.
- Built `/seller/products/new` as a guided single-page draft form with product identity, optional brand, description, HSN code, highlights, attributes, option names, and variants.
- The form starts with one optionless variant and never forces a seller to add colour, size, or another option.
- Loaded active categories through `/api/categories`, flattened only leaf categories, and displayed full breadcrumb paths for repeated names.
- Added category loading, empty, failure, and retry states.
- Loaded active brands through `/api/brands` ten at a time with a 300 millisecond search delay, stale-request cancellation, no-match state, cursor-based Load more, selection, and clearing.
- Added up to eight dynamic highlights, 30 attributes, three option names, and 100 variants with accessible add and remove actions.
- Variant SKUs remain visible at every width alongside option values, exact rupee inputs, MRP, stock, and active state.
- Renaming an option keeps every variant value in its stable position and serializes that value under the new option key.
- Added case-insensitive duplicate option-name and variant-combination checks while preserving backend issues as the authoritative response.
- Converted rupees to integer paise with decimal-string arithmetic and checked MRP against selling price before submission.
- Kept every entered value after local validation, HTTP 400, HTTP 409, and unexpected request failures.
- Added safe HTTP 401 sign-in recovery and HTTP 403 seller access-denied recovery.
- A successful creation returns to the product list with a Draft created notice until T08 delivers the detail editor route.

Important files:

- `apps/web/src/app/seller/products/page.tsx`
- `apps/web/src/app/seller/products/new/page.tsx`
- `apps/web/src/components/seller/product-pagination.tsx`
- `apps/web/src/components/seller/product-create-form.tsx`
- `apps/web/src/lib/seller-products.ts`
- `apps/web/src/lib/seller-products.test.ts`

Automated test evidence, 10 October 2026:

- `pnpm --filter @ecokart/web typecheck` passed after Next.js route generation.
- `pnpm lint` passed with no findings.
- `pnpm --filter @ecokart/web test` passed 16 test files and 91 tests in 12.99 seconds.
- New tests prove exact rupee-to-paise conversion, simple variant serialization, stable option-value mapping after a rename, case-insensitive duplicate combinations, leaf breadcrumb paths, backend-compatible MRP wording, and status-plus-cursor URLs.
- Existing web route tests prove draft creation and listing, status filtering, editing, variant changes, exact validation responses, seller ownership isolation, signed-out and wrong-role refusal, photos, and deletion.
- `pnpm --filter @ecokart/core test` passed 24 test files and 299 tests in 18.34 seconds.
- The core catalogue tests cover pending-seller creation, every product and variant limit, duplicate SKUs and combinations, active leaf category and brand rules, summaries, cursors, row-level security, and lifecycle restrictions.
- `pnpm --filter @ecokart/web build` compiled successfully and produced dynamic `/seller/products` and `/seller/products/new` routes.

Real local-service evidence, 10 October 2026:

- Started the documented PostgreSQL, Mailpit, and object-storage services, then ran the web app and worker together.
- Signed in as `seller1@ecokart.test` through the real email-code flow without printing or logging the code or session value.
- Loaded the active public category tree and selected a real leaf category.
- Loaded one active brand, followed its opaque cursor when available, and confirmed the next page did not repeat the first brand.
- Submitted an MRP below its selling price and received HTTP 400 with `variants.0.mrpPaise must be at least pricePaise`.
- Created simple draft `3441609a-db05-475b-8305-85ae7b7b7de1` with no option names, one variant, ₹199.95 selling price, ₹249 MRP, and stock 12.
- Confirmed the simple draft returned draft status and a 19,995 paise minimum-price summary.
- Created draft `42ba7a47-da9b-4caa-8b50-c9652020c169` with Colour and Size options and two variants.
- Confirmed the second draft retained both variants, summarized stock as 13, and summarized the highest price as 27,500 paise.
- Requested one draft per page, followed the opaque next cursor, and received a distinct older draft while retaining the Draft filter.
- Confirmed `/seller/products` and `/seller/products/new` server-rendered for the seller and a signed-out product-list API request received HTTP 401.
- Both drafts remain in the local development database for the deferred browser pass and T08 editor work.

Manual evidence: Deferred until the final combined Chrome and Safari pass requested by the developer.

### Deferred manual verification steps

1. Run `pnpm dev` and sign in as `seller1@ecokart.test` using the newest code in Mailpit.
2. Open `/seller` and confirm Products appears in the seller navigation and Manage products opens `/seller/products`.
3. Open `/seller/products` in the latest Chrome at 1280 pixels or wider.
4. Confirm the real T07 drafts show title, leaf category, Draft status, exact INR price or price range, total stock, photo placeholder, and India-time last update.
5. Confirm status is communicated through text as well as colour.
6. Select each status filter and confirm the `status` query parameter survives refresh.
7. Confirm an empty filtered result offers View all products and Create draft without losing access to the filter controls.
8. If more than 20 products exist, use Next page twice and Previous page twice.
   Confirm the status remains in the URL, the cursor stays opaque, and Previous restores the exact earlier page during this visit.
9. Open `/seller/products/new` and confirm active leaf categories load with full breadcrumb paths.
10. Confirm a parent category cannot be selected and repeated leaf names remain distinguishable by their path.
11. Temporarily stop the web request or use browser request blocking for `/api/categories`, confirm the failure and Retry categories state, then restore it and retry successfully.
12. Confirm the brand picker initially loads only a bounded page and Load more appears when another page exists.
13. Type two different brand searches quickly and confirm results from the older request never replace the newest results.
14. Confirm loading, no-match, pagination, selection, clearing, and empty-search states are understandable.
15. Create a simple draft with no option names and one variant.
   Enter ₹199.95 and confirm the saved list price is ₹199.95 rather than a rounded value.
16. Confirm Add variant is unavailable until an option name exists.
17. Add Colour and Size option names and two variants with different values.
18. Enter values in both variants, rename Colour to Finish, and confirm every entered colour value remains beside the same variant.
19. Enter option names that differ only by capital letters and confirm creation is refused without clearing the form.
20. Enter the same option combination twice with different capitalisation and surrounding spaces.
   Confirm the duplicate is refused before submission and both variants remain visible.
21. Add and remove highlights and attributes and confirm their count badges and maximum-disabled actions match 8 and 30.
22. Add variants and confirm the count, removal controls, stock, active state, price, MRP, SKU, and option inputs remain usable.
23. Enter an MRP below price and confirm `variants.0.mrpPaise must be at least pricePaise` appears beside MRP and in the error summary.
24. Submit invalid SKU, price, stock, HSN, category, brand, title, highlight, attribute, option, and variant values.
   Confirm backend messages remain intact, appear beside a matching field when possible, and never clear entered data.
25. Submit a valid simple draft and confirm the browser returns to `/seller/products?created=...`, shows Draft created, and lists the new product.
26. Submit a valid two-option, two-variant draft and confirm both prices contribute to the displayed range and both stocks contribute to total stock.
27. Repeat list filtering, pagination, brand search, category selection, dynamic row controls, validation, and creation using only Tab, Shift+Tab, Space, Enter, and arrow keys.
28. Confirm focus is visible, labels target their fields, loading and error states are announced, SKU remains visible, and disabled actions remain understandable.
29. Repeat the visual checks in the latest Chrome and Safari at 390 by 844 and at 1280 pixels or wider.
30. Confirm list records become readable cards, form sections use a single readable phone column, and there is no clipped content or page-level horizontal scrolling.
31. Open both routes while signed out and while signed in as a buyer or administrator.
   Confirm product data and the creation form never render before sign-in or seller access-denied handling.
32. Use a pending disposable seller and confirm it can open the creation form and save a private draft.
33. After T08 supplies `/seller/products/[id]`, confirm successful creation navigates to the new product's detail editor and that a rejected product shows its rejection reason prominently there.
34. Record browser versions, routes, viewports, and observed results here during the final combined browser pass.
35. If every check passes, change `Status` to `complete`, change `Implemented` to `Yes`, and update T07 in `README.md` to `Yes`.

Notes or deviations:

- The backend specification explicitly says example products are not included in `pnpm db:seed` because approval arrives in backend step 7.
  The two real T07 drafts above provide stable local list data instead of claiming seeded products exist.
- `ProductSummary`, returned by the list API, has no rejection reason.
  T08 must show `rejectionReason` from the product detail response in the detail editor.
- `/seller/products/[id]` and its photo and editing interface belong to T08 and do not exist yet.
  T07 returns successful creation to the valid product list with a notice; T08 must change this to the planned detail-editor handoff.
- The current Vitest environment is Node-based and has no browser DOM or component-testing library.
  UI behavior is covered by pure frontend tests, existing route tests, typecheck, lint, production compilation, server-rendered route checks, and the real HTTP workflow, with the combined browser pass deferred as requested.
