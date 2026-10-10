# T08: Product editor, variants, and photos

| Field | Value |
| --- | --- |
| Status | `implemented_pending_manual_verification` |
| Implemented | No - implementation and automated verification pass; final browser pass pending |
| Depends on | T07 |
| Blocks | T09 |

## Goal

Complete the seller catalogue workflow with listing detail edits, variant and stock management, direct photo upload, image processing feedback, ordering, metadata changes, and safe deletion.

## API contract

Product:

- `GET /api/seller/products/{id}` returns `{ product }` with variants and images;
- `PATCH /api/seller/products/{id}` returns the whole updated `{ product }`;
- `DELETE /api/seller/products/{id}` returns 204 for a draft or rejected listing.

Variants:

- `POST /api/seller/products/{id}/variants` returns the whole `{ product }` with status 201;
- `PATCH /api/seller/products/{id}/variants/{variantId}` returns the whole `{ product }`;
- `DELETE /api/seller/products/{id}/variants/{variantId}` returns the whole `{ product }`;
- SKU and option identity changes are limited to draft or rejected products;
- price, MRP, stock, and active state can change at any product status.

Images:

- `POST /api/seller/products/{id}/images/uploads` accepts `{ contentType, size }` and returns a signed form with status 201;
- the browser posts the file directly to the returned object-storage `url` with every returned field and the file;
- `POST /api/seller/products/{id}/images` accepts `{ uploadKey, alt?, variantId? }` and returns the whole `{ product }` with status 202;
- `PUT /api/seller/products/{id}/images/order` accepts every current image id in `{ imageIds }`;
- `PATCH /api/seller/products/{id}/images/{imageId}` edits `alt` and nullable `variantId`;
- `DELETE /api/seller/products/{id}/images/{imageId}` returns the whole `{ product }`;
- processing images eventually become `ready` with URLs or `failed` with a plain failure reason.

## Deliverables

- Build `/seller/products/[id]` with summary, listing, variants, photos, status, and danger sections.
- Show category breadcrumb, brand, effective HSN context, price range, total stock, dates, and rejection reason.
- Allow listing-detail edits only in `draft` or `rejected` state.
- Allow permitted stock, price, MRP, and active changes at every status.
- Allow add, identity edit, and delete for variants only when the backend permits it.
- Keep at least one variant and explain any refusal from the backend.
- Confirm product and variant deletion.
- Implement direct photo upload with type and 10 MB client checks.
- Show per-file requesting, uploading, registering, processing, ready, and failed states.
- Poll only while at least one image is processing.
- Stop polling when the page is hidden or unmounted and resume safely when needed.
- Allow alt text, nullable variant association, ordering, and deletion.
- Provide button-based image reordering even if drag and drop is added.

## Upload sequence

1. Validate file type and size in the browser for immediate feedback.
2. Request the signed upload form from the EcoKart API.
3. Build `FormData` from every returned field.
4. Append the file using the field name expected by the signed form.
5. POST directly to object storage without adding an incompatible JSON content type.
6. Register the returned key with the EcoKart image endpoint.
7. Replace local upload progress with the returned processing image.
8. Poll product detail with capped intervals until every processing image is ready or failed.

Do not serve the original upload.
Render only the backend's ready image URLs.
Do not retry a failed image job from the browser unless a backend retry endpoint exists.

## Editing and stale-data behavior

Use separate save boundaries for listing details, each variant, image metadata, and image order.
Do not send the entire product when only one section changed.
After each mutation, replace local server state with the whole product returned by the API.
On 409, retain unsaved input, show the conflict, and offer reload.

## Acceptance criteria

- The page renders all fields from `ProductView` accurately.
- Draft and rejected products expose full editing while other statuses expose only permitted variant commercial controls.
- Price, MRP, stock, and active changes update summary values from the returned product.
- Adding and deleting variants updates the page without stale totals.
- JPEG, PNG, WebP, and AVIF files up to 10 MB follow the three-call upload flow.
- Unsupported or oversized files fail before requesting a signed form.
- A successful image reaches `ready` and uses the returned thumbnail, card, or full URL appropriately.
- A too-small or damaged image reaches `failed` and shows `failureReason`.
- Image polling stops after terminal states and on unmount.
- Image ordering sends every current image id and reflects the returned order.
- Variant association supports clearing with `null`.
- Product deletion returns to the list without a JSON parse failure.
- The complete editor remains usable on a phone.

## Verification plan

- Unit test upload request construction, signed-form assembly, polling termination, and image-order payloads.
- Test state-based edit permissions and variant mutation payloads.
- Through real SeaweedFS and the worker, upload one valid image and confirm all generated sizes load.
- Upload one invalid or too-small image and confirm the displayed failure reason.
- Edit stock and confirm `totalStock` changes from the server response.
- Delete a draft and confirm it disappears from the seller list.
- Run web typecheck, lint, relevant tests, and build.

## Completion evidence

Implementation evidence, 10 October 2026:

- Added the server-rendered `/seller/products/[id]` route with seller authentication, row-level-security context, ownership isolation, and route-level not-found handling.
- Added a product summary with status, category path, brand, slug, effective HSN and GST source, price range, total stock, creation and update dates, and a prominent rejection reason.
- Added separate listing, variant, photo, and deletion save boundaries that replace local state with the whole product returned by each mutation.
- Limited listing identity edits, option-name changes, variant identity changes, variant creation, variant deletion, photo changes, and product deletion to draft and rejected products.
- Kept price, MRP, stock, and active controls available at every product status.
- Reused the bounded brand picker and active leaf-category loading from T07 in the listing editor.
- Added exact rupee-to-paise variant updates, server validation messages, retained inputs on conflicts, and explicit Reload latest actions for stale data.
- Added confirmed variant deletion, a last-variant guard, and confirmed product deletion that handles an empty HTTP 204 response before returning to the list.
- Added JPEG, PNG, WebP, and AVIF checks and the 10 MB limit before a signed-upload request is made.
- Added direct multipart upload to the returned object-storage URL using every signed field, followed by image registration through the EcoKart API.
- Added requesting, uploading, registering, processing, ready, and failed states with per-file errors and backend failure reasons.
- Added capped image polling that continues only while an image is processing, pauses while the document is hidden, resumes with its existing backoff, and stops on terminal state or unmount.
- Rendered only the backend's processed card or gallery URLs and never the original upload key.
- Added image alt text, nullable variant association, button-based ordering that submits every image id, and confirmed image deletion.
- Changed successful T07 creation to open the new product editor and linked product-list titles to their editor.
- Added a product-deleted notice to the seller product list.

Important files:

- `apps/web/src/app/seller/products/[id]/page.tsx`
- `apps/web/src/components/seller/product-editor.tsx`
- `apps/web/src/components/seller/product-listing-editor.tsx`
- `apps/web/src/components/seller/product-variant-editor.tsx`
- `apps/web/src/components/seller/product-photo-editor.tsx`
- `apps/web/src/lib/product-editor.ts`
- `apps/web/src/lib/product-editor.test.ts`

Automated test evidence, 10 October 2026:

- `pnpm --filter @ecokart/web typecheck` passed after Next.js route generation.
- `pnpm lint` passed with no findings.
- `pnpm --filter @ecokart/web test` passed 17 test files and 98 tests in 11.93 seconds.
- The new unit tests cover edit permissions, commercial-only payloads for locked products, exact rupee conversion, changed-field payloads, upload type and size refusal, signed-form construction, polling termination and capped delays, and complete image-order payloads.
- Existing web route tests cover product ownership, every product and variant mutation, signed uploads, registration, image metadata and ordering, deletion, validation, role refusal, and HTTP response shapes.
- `pnpm --filter @ecokart/core test` passed 24 test files and 299 tests in 15.82 seconds.
- `pnpm --filter @ecokart/web build` compiled successfully and produced dynamic product detail and product-image API routes.

Real local-service evidence, 10 October 2026:

- Started the documented PostgreSQL, Mailpit, SeaweedFS, web, and worker services.
- Signed in as `seller1@ecokart.test` through the real email-code flow without printing the code or session value.
- Opened retained draft `42ba7a47-da9b-4caa-8b50-c9652020c169`, edited its listing, increased a variant's stock by three, and confirmed the returned product total increased.
- Added a third variant, confirmed it appeared in the returned product, deleted it, and confirmed it disappeared.
- Uploaded a generated 1000 by 800 JPEG through a real signed SeaweedFS form and registered image `ca4f5fac-8c2c-48ee-bfcf-9fd5e886d85a`.
- Observed that image move from processing to ready through the running worker and confirmed its thumbnail, card, and gallery URLs each returned HTTP 200.
- Uploaded a generated 500 by 400 PNG and observed image `ba156741-c056-41a4-a8d9-8e8f912bd08f` move to failed with `The image is too small; it needs at least 600 pixels on its longer side`.
- Updated the ready image alt text, associated it with a variant, cleared that association with `null`, reversed the complete image order, and confirmed every returned value.
- Loaded the server-rendered editor and confirmed it contained the edited title, ready-image alt text, and failed-image reason.
- Created disposable draft `ed090a7c-3ab1-49a6-9ace-b96d60f1de4b`, received an empty HTTP 204 on deletion, and received HTTP 404 when reading it afterwards.
- Kept the edited draft and both terminal-state images in the local development database for the deferred browser pass.

Manual evidence: Deferred until the final combined Chrome and Safari pass requested by the developer.

### Deferred manual verification steps

1. Run `pnpm db:up`, then run `pnpm dev` and sign in as `seller1@ecokart.test` using the newest code in Mailpit.
2. Open `/seller/products/42ba7a47-da9b-4caa-8b50-c9652020c169` in the latest Chrome at 1280 pixels or wider.
3. Confirm the summary shows Draft, the full category path, brand, slug, effective HSN and GST source, INR price range, total stock, and India-time dates.
4. Confirm the listing editor shows the saved title and description and exposes category, brand, HSN, highlights, attributes, and the existing option names.
5. Change one listing value, save it, and confirm the success message and summary both use the server-returned product.
6. In browser developer tools, change that product through a second tab before saving the first tab.
7. Confirm an HTTP 409 retains the first tab's unsaved values, explains the conflict, and offers Reload latest.
8. Change a variant price, MRP, stock, and active state separately and confirm the summary price and stock update from each returned product.
9. Add a variant with values for every option name, edit its SKU and option values, then delete it through the confirmation dialog.
10. Confirm the final remaining variant cannot be deleted and the reason is visible.
11. Upload one JPEG, PNG, WebP, and AVIF file no larger than 10 MB and confirm each row shows requesting, uploading, registering, and processing before a terminal state.
12. Select an unsupported file and a file larger than 10 MB and confirm each fails before `/images/uploads` appears in the Network panel.
13. While an image is processing, hide the tab for longer than five seconds and confirm product polling stops in the Network panel.
14. Return to the tab and confirm polling resumes, never waits longer than five seconds, and stops after every image is ready or failed.
15. Confirm ready images use a processed card or gallery URL and no page element loads the original upload key.
16. Confirm the retained too-small image shows its exact backend failure reason and offers no browser retry action.
17. Edit the ready image alt text, associate it with each variant, clear the association, and confirm each save uses the returned value.
18. Move images earlier and later and confirm the complete ordered id list is sent and the returned order renders immediately.
19. Delete an image through its confirmation dialog and confirm it disappears without changing another image.
20. Create a disposable draft, open its editor, delete it through the Danger zone, and confirm the browser returns to `/seller/products?deleted=1` with a notice instead of a JSON error.
21. If rejected and approved products are available, confirm rejected exposes full editing and its rejection reason, while approved locks listing identity and keeps commercial variant controls usable.
22. Repeat every editor control using only Tab, Shift+Tab, Space, Enter, and arrow keys.
23. Confirm focus is visible, each field has a label, dialogs restore focus, errors are announced, and status never relies only on colour.
24. Repeat the visual and interaction checks in the latest Chrome and Safari at 390 by 844 and at 1280 pixels or wider.
25. Confirm cards form one readable phone column, every SKU and action remains visible, uploads remain understandable, and no page-level horizontal scrolling appears.
26. Open the retained product while signed out and while signed in as a buyer or administrator.
27. Confirm product data never renders before sign-in or seller access-denied handling.
28. Record browser versions, routes, viewports, and observed results here during the final combined browser pass.
29. If every check passes, change `Status` to `complete`, change `Implemented` to `Yes`, and update T08 in `README.md` to `Yes`.

Notes or deviations:

- The current Vitest environment is Node-based and has no browser DOM or component-testing library.
- UI behavior is covered by pure frontend tests, existing route tests, typecheck, lint, production compilation, server-rendered route checks, and the real HTTP workflow, with the combined browser pass deferred as requested.
