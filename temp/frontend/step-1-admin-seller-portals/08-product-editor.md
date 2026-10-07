# T08: Product editor, variants, and photos

| Field | Value |
| --- | --- |
| Status | `not_started` |
| Implemented | No |
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

Implementation evidence: Pending.

Automated test evidence: Pending.

Manual evidence: Pending.

Notes or deviations: None recorded.
