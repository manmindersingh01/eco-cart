# 05: Catalogue lifecycle, minimum quantity, media and imports

| Field | Value |
| --- | --- |
| Status | complete |
| Implemented | Yes |
| Depends on | 02; 04 for complete applicant-to-seller journey |
| Blocks | Publishable catalogue for storefront and purchase tests |

## Source and backend boundary

Read design sections 5.5, 6.2, 6.7 and 8.
Reuse `catalogue/types.ts`, `products.ts`, `moderation.ts`, `images.ts`, `videos.ts`, `screening.ts`, `imports` and existing product editor components/helpers.
Backend product lifecycle endpoints already include submit, move-to-draft, archive, admin approve/reject/take-down and moderation queue.
Photo upload/order/metadata routes and video upload/register/delete routes already exist.
Imports already expose upload, register, list/detail, mapping and signed error report.
Do not add SQL or a competing state machine in UI code.

## Ordered frontend changes

### Product fields and minimum quantity

Extend `components/seller/product-create-form.tsx`, `product-listing-editor.tsx` and `lib/product-editor.ts` to retain and submit `minOrderQuantity`.
Use a whole-number input defaulting to 1, range 1 through 1000 and a concrete explanation: minimum 10 means the buyer orders at least 10 units of the chosen variant.
Do not drop an existing minimum when saving unrelated fields.
Keep editable-while-published fields consistent with service permissions; do not disable a supported minimum/stock edit just because title edits need a draft.

### Media

Audit the existing photo editor's local upload rules against the backend cap of four non-failed photos.
Show a clear featured/cover photo and up to three supporting photos.
Cover selection must use existing ordering, not a parallel unsynchronised featured flag.
Add a video editor showing none, uploading, processing, ready and failed states, size/type guidance, converted preview and confirmed removal/replacement.
Use server-supplied limits and the shared contract; one video is optional unless D4 changes it.
Preserve direct signed POST uploads and retry/cancellation cleanup.
Never preview a private original as a public product asset.

### Moderation

Add submit, withdrawal/move-to-draft and archive actions only when the current status permits them.
Show missing photo/variant/HSN/category/brand requirements and screening/rejection reasons from the service.
Add proposed `/admin/moderation` with status filters, keyset pages and listing detail/decision controls.
Preview relevant media and commercial data before approving or rejecting.
Confirm take-down and explain why a listing disappears publicly.
Refresh stale detail on 409; preserve review notes where safe.

### Imports

Add proposed `/seller/imports` and `/seller/imports/[id]`.
Upload CSV/XLSX through storage, register it, display inspected columns/sample rows, map columns, confirm and poll processing.
Use current `IMPORT_FIELD_INFO`, including minimum quantity, rather than hard-coding a second field list.
Display counts and signed row-error report download without suggesting completed rows were rolled back if the backend permits partial success.
Handle invalid size/type, too many rows/columns, duplicate SKU, unknown category/brand and stale mapping conflicts.
Keep successful imported products as drafts for review, media and submission.
Use deterministic mapping now; optional AI mapping UI belongs to task 11.

## Backend work

Existing business features should be reused after task 02.
Add regression tests or fix proven holes in field propagation, media cap races, import parsing or lifecycle permissions.
Ensure moderation and media jobs invalidate storefront tags through core services.
If D4 makes media mandatory, implement it in submission validation and update existing-listing policy before changing UI requirements.

## Automated acceptance

| ID | Scenario | Required outcome |
| --- | --- | --- |
| C01 | Create/edit minimum 10, reload, edit description only | Minimum stays 10 in API, UI and imported/listed product |
| C02 | Minimum invalid or stock below minimum | Server refuses invalid field; purchasability reflects stock floor |
| C03 | Four photos, reorder cover, attempt fifth including concurrent requests | Correct cap and selected card thumbnail; no server bypass |
| C04 | Video upload, conversion failure, retry and duplicate registration | One usable converted video; understandable failures; no original exposed |
| C05 | Submit invalid then valid listing; reject, correct, approve and take down | Legal transitions only; public visibility matches decisions |
| C06 | Seller B attempts Seller A's media/product/import identifiers | No cross-seller read/write/download |
| C07 | Valid CSV and XLSX including minimum quantity | Correct drafts and values, stable progress after refresh |
| C08 | Mixed valid/invalid rows and duplicate SKU | Accurate counts, downloadable errors, no accidental duplicate drafts on replay |

Add proposed `e2e/catalogue-lifecycle.spec.ts`, `media.spec.ts` and `imports.spec.ts`.
Reuse generated image/video/spreadsheet fixtures from `@ecokart/core/testing`.
Use bounded job polling and real SeaweedFS objects.
Run relevant core and route tests, worker tests, lint/typecheck and these browser suites.
Completion evidence records persisted product IDs and test-only fixture identities in ignored test attachments without publishing private signed URLs.

## Implementation and verification log

Implementation started on 21 October 2026 on `step-2-marketplace-completion`, from `661b7fedc09481eccd7ce408e27bb88a4f325af3`.
The starting worktree was clean.
See [the task evidence](evidence/2026-10-21-catalogue.md) for implemented behaviour, acceptance mapping, commands and remaining checks.
The existing moderation API lists open reviews with risk filters, not arbitrary product status filters.
The administrator screen uses that contract; seller product lists retain their status filters, and reviewed detail remains accessible after a decision.
The existing four-photo limit, usable main-photo requirement and optional single-video policy are retained.
AI mapping controls remain task 11 work.

Completed and verified on 21 October 2026.
All C01 through C08 acceptance cases passed through the browser journeys and relevant core/API regression tests.
The final catalogue run passed 18 tests across Chromium, Firefox and WebKit at desktop and phone widths, followed by six installed Chrome tests and 14 smoke tests.
`pnpm check` exited 0: formatting, lint, typecheck, 1,271 tests and the production build passed.
Actual Safari, VoiceOver and browser zoom checks remain task 12 release work; exact manual steps are in the linked evidence.
