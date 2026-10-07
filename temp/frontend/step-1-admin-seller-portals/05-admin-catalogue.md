# T05: Admin category and brand management

| Field | Value |
| --- | --- |
| Status | `not_started` |
| Implemented | No |
| Depends on | T03 |
| Blocks | T07, T09 |

## Goal

Let administrators maintain the category tree and brand list used by seller listing forms and the future storefront.

## API contract

Categories:

- `GET /api/admin/categories` returns `{ categories }` with active and inactive nodes;
- `POST /api/admin/categories` creates and returns `{ category }` with status 201;
- `PATCH /api/admin/categories/{id}` updates or moves a category and returns `{ category }`;
- `DELETE /api/admin/categories/{id}` returns 204 for an unused leaf;
- categories have at most three levels with depths 0, 1, and 2;
- current GST rates come from backend validation and invalid rates return 400.

Brands:

- `GET /api/admin/brands?q=&cursor=&limit=` returns `{ items, nextCursor }` alphabetically and includes inactive brands;
- `POST /api/admin/brands` creates and returns `{ brand }` with status 201;
- `PATCH /api/admin/brands/{id}` returns the updated `{ brand }`;
- `DELETE /api/admin/brands/{id}` returns 204 for an unused brand;
- a category or brand in use returns 409 on deletion.

## Deliverables

- Build `/admin/categories` as a navigable three-level tree.
- Show name, slug, GST rate, default HSN code, sort order, active state, and depth.
- Support adding a top-level or child category with valid parent choices.
- Support editing, moving, activation, deactivation, and deletion.
- Warn that a slug edit changes the future public URL.
- Explain why a fourth level is unavailable before submission.
- Build `/admin/brands` with debounced search, cursor pagination, active state, create, edit, and delete.
- Preserve search query in the URL and cancel stale search requests.
- Confirm deletion and slug changes.

## Category interaction design

Use a nested list or tree with buttons and explicit text labels.
Do not rely on drag and drop as the only way to move a category.
The edit form must offer a parent select that excludes the category itself, its descendants, and parents that would make the result deeper than level three.
The backend remains authoritative and its loop or depth rejection must still be shown.

Display GST basis points as a percentage but send an integer basis-point value.
Allow the backend to generate a slug when creating by leaving the slug blank.
Treat an intentionally cleared nullable default HSN code as `null`, not an empty string.

## Acceptance criteria

- The seeded three-level tree renders in stable `sortOrder` order.
- An admin can add, edit, move, activate, and deactivate a category.
- Parent choices prevent obvious loops and invalid fourth levels.
- Backend depth, rate, sibling-name, slug, and delete conflicts display clearly.
- Inactive nodes remain visible and labelled in the admin tree.
- Brand search does not flash results from an older request.
- Brand cursor pagination keeps the search term.
- Create and edit forms distinguish generated slug from explicit slug.
- Successful deletion removes the item without attempting to parse a 204 body.
- The tree and brand list are usable at phone and desktop widths.

## Verification plan

- Unit test tree flattening, parent-option filtering, and GST display conversion.
- Test search cancellation and cursor query construction.
- Test confirmation and 204 handling for deletes.
- Through the real API, create a three-level path, try a refused fourth level, move a node, deactivate a branch, add and edit a brand, and exercise a delete conflict.
- Run web typecheck, lint, relevant tests, and build.

## Completion evidence

Implementation evidence: Pending.

Automated test evidence: Pending.

Manual evidence: Pending.

Notes or deviations: None recorded.
