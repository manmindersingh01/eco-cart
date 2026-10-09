# T05: Admin category and brand management

| Field | Value |
| --- | --- |
| Status | `implemented_pending_manual_verification` |
| Implemented | No - code and automated checks pass; final browser verification is deferred |
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

Implementation evidence, 9 October 2026:

- Added Categories and Brands to the protected administrator navigation and administrator overview.
- Built `/admin/categories` as a server-rendered three-level tree containing active and inactive categories.
- Each category shows its name, slug, depth, GST rate, default HSN code, sort order, and active state.
- Added top-level and child creation, editing, moving, activation, deactivation, and confirmed deletion.
- Parent choices exclude the edited category, its descendants, and parents that would place any part of its subtree below depth two.
- Category depth-two rows explain why another child cannot be added before the administrator reaches the form.
- Create forms allow the backend to generate a slug, while edits show and confirm the explicit slug change warning.
- GST percentages convert exactly to integer basis points, sort order accepts whole numbers only, and a cleared default HSN code is sent as `null`.
- Built `/admin/brands` as an alphabetical, responsive list with active-state labels, creation, editing, activation, deactivation, and confirmed deletion.
- Brand search waits 300 milliseconds, cancels stale requests, and retains the query in the URL.
- Opaque cursor pagination retains the search query and keeps a browser-visit history for Previous navigation.
- Category and brand mutations retain backend validation messages, place field issues beside inputs, and offer refreshed data after HTTP 409 conflicts.
- Delete actions accept an empty HTTP 204 response without attempting to parse JSON.
- HTTP 401 responses offer a safe return to sign-in, while the server-side administrator guard protects both initial pages.

Important files:

- `apps/web/src/app/admin/categories/page.tsx`
- `apps/web/src/app/admin/brands/page.tsx`
- `apps/web/src/components/admin/category-manager.tsx`
- `apps/web/src/components/admin/brand-manager.tsx`
- `apps/web/src/lib/admin-catalogue.ts`
- `apps/web/src/lib/admin-catalogue.test.ts`

Automated test evidence, 9 October 2026:

- `pnpm --filter @ecokart/web typecheck` passed after Next.js route generation.
- `pnpm lint` passed with no findings.
- `pnpm --filter @ecokart/web test` passed 14 test files and 79 tests in 7.62 seconds.
- New tests prove stable depth-first tree flattening, breadcrumb paths, depth-aware parent filtering, GST conversion, nullable HSN serialization, brand search-and-cursor URL construction, and stale-request cancellation.
- Existing web API tests prove category and brand authentication, administrator permission checks, validation, creation, editing, deletion, conflict responses, full-tree inclusion, search, and cursor pagination.
- `pnpm --filter @ecokart/core test` passed 24 test files and 299 tests in 10.66 seconds.
- The core catalogue tests cover depth and loop protection, sibling uniqueness, GST validation, audit records, in-use deletion conflicts, stable ordering, brand uniqueness, search, and opaque cursors.
- `pnpm --filter @ecokart/web build` compiled successfully and produced dynamic `/admin/categories` and `/admin/brands` routes.

Real local-service evidence, 9 October 2026:

- Confirmed the local PostgreSQL, Mailpit, and object-storage containers were healthy.
- Signed in the development administrator through the real email-code flow without printing or logging the code.
- Submitted GST rate 1200 basis points and received HTTP 400 with the exact GST issue.
- Created a top, middle, and bottom three-level category path and confirmed the backend-generated slug.
- Attempted a fourth level and received HTTP 400 with the maximum-three-level message.
- Moved the bottom category to depth one, cleared its default HSN code to `null`, and deactivated the top category.
- Attempted to delete the top category while it still had a child and received HTTP 409.
- Deleted the now-unused middle leaf and received an empty HTTP 204 response.
- Created two brands, searched with a one-item limit, followed the opaque cursor, and received the distinct second brand.
- Edited one brand's name and slug, deactivated it, and deleted the unused second brand with an empty HTTP 204 response.
- Confirmed both protected pages server-rendered the verification data.
- Confirmed signed-out requests to both administrator catalogue APIs received HTTP 401.
- Category `89b54849-8664-4fde-80a1-35635834bf93` and brand `ff7cb919-fc3b-415a-9905-5528c8182708` remain inactive in the local development database for the deferred browser pass.

Manual evidence: Deferred until the final combined Chrome and Safari pass requested by the developer.

### Deferred manual verification steps

1. Run `pnpm dev` and sign in as an administrator using the newest code in Mailpit.
2. Open `/admin` and confirm Categories and Brands appear in both the navigation and available-tools area.
3. Open `/admin/categories` in the latest Chrome at 1280 pixels or wider.
4. Confirm the seeded tree uses stable sort order and shows all three levels with inactive nodes clearly labelled.
5. Confirm every row shows name, slug, GST percentage, default HSN code, sort order, active state, and level.
6. Add a top-level category with a blank slug and confirm the refreshed tree shows the backend-generated slug.
7. Add a child and grandchild, then confirm the grandchild has no Add child action and displays the three-level explanation.
8. Edit the child and inspect its Parent choices.
   Confirm its own row, its descendants, and any parent that would push its subtree to a fourth level are absent.
9. Move the child to another valid parent and confirm the tree immediately shows its new path and depth.
10. Clear default HSN code, change GST and sort order, save, and confirm the refreshed values match the backend response.
11. Enter an unsupported GST percentage and confirm the exact backend validation message is shown beside GST.
12. Try duplicate sibling names and slugs and confirm the backend messages remain visible without clearing the form.
13. Change a category slug, cancel the confirmation, and confirm no request is sent.
14. Repeat the slug change, accept the confirmation, and confirm the new slug is shown after refresh.
15. Deactivate and reactivate a category through their confirmations and confirm inactive descendants remain visible.
16. Try to delete a category that has a child or is in use and confirm the HTTP 409 message appears with a reload action.
17. Delete an unused leaf and confirm it disappears without an empty-response parsing error.
18. Open `/admin/brands` and confirm the initial list is alphabetical and includes inactive brands with text labels.
19. Type a search term, pause for less than 300 milliseconds, and confirm no request is made before the delay.
20. Type two different terms quickly and confirm results from the older request never replace the newest results.
21. Refresh the searched page and confirm the `q` URL value restores the same query and list.
22. When more than one page is available, use Next and Previous and confirm the opaque `cursor` and search query remain in the URL.
23. Create a brand with a blank slug and confirm the generated slug appears after refresh.
24. Edit a brand's name, active state, and slug.
   Cancel the first slug confirmation, accept the second, and confirm only the accepted edit is saved.
25. Trigger duplicate-name, duplicate-slug, and in-use-delete errors and confirm their backend messages remain clear and recoverable.
26. Delete an unused brand and confirm it disappears without an empty-response parsing error.
27. Repeat both page workflows using only Tab, Shift+Tab, Space, Enter, and Escape.
28. Confirm dialogs trap focus, Escape closes safely, focus returns to the trigger, notices are announced, and every control has visible focus.
29. Repeat the visual checks in the latest Chrome and Safari at 390 by 844 and at 1280 pixels or wider.
30. Confirm the tree and brand records remain readable on a phone and there is no clipped content or page-level horizontal scrolling.
31. Open both routes while signed out and while signed in as a buyer or seller.
   Confirm protected catalogue data never appears and the account reaches sign-in or access denied as appropriate.
32. Record browser versions, routes, viewports, and observed results here during the final combined browser pass.
33. If every check passes, change `Status` to `complete`, change `Implemented` to `Yes`, and update T05 in `README.md` to `Yes`.

Notes or deviations:

- The current Vitest environment is Node-based and has no browser DOM or component-testing library.
  UI behavior is covered by pure frontend tests, existing route tests, typecheck, lint, production compilation, server-rendered page checks, and the real API workflow, with the combined browser pass deferred as requested.
- The first real-service probe used a search term that was not contiguous in either generated brand name, so it stopped after creating its category path and two brands.
  That development-only data remains available for manual testing, and the corrected probe then completed the full workflow above.
