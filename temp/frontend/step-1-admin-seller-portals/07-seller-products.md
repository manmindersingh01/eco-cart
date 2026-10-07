# T07: Seller product list and draft creation

| Field | Value |
| --- | --- |
| Status | `not_started` |
| Implemented | No |
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

Implementation evidence: Pending.

Automated test evidence: Pending.

Manual evidence: Pending.

Notes or deviations: None recorded.
