# 03: Remarks decisions and targeted backend changes

| Field | Value |
| --- | --- |
| Status | Planned verification; existing document policy confirmed |
| Implemented | No |
| Depends on | 02 |
| Blocks | Only any changed mandatory-media rule; existing document UI can proceed |

## Required decisions before conflicting changes

| ID | Decide | Existing contract | Requested difference | Action |
| --- | --- | --- | --- | --- |
| D1 | Document workflow: confirmed by the user | Files belong to admin-created verification requests; open requests block approval | Keep existing workflow | Resolved; build frontend against current request/upload/review contracts |
| D2 | Document size limit: confirmed by the user | 10 * 1024 * 1024 bytes, inclusive upper bound | Use the existing 10 MB policy | Resolved; retain existing limit and boundary, with no size-policy migration |
| D3 | Document-related business fields: retain existing permissions | Application permits tax details; approved seller profile limits contact edits | Keep current contracts for this request | No expanded field permissions or re-verification workflow is planned |
| D4 | Are four photos and a video required or allowed? | Up to four photos and one optional video; listing validation already requires a usable main photo | Wording could imply exact mandatory counts | Preserve current optional limits pending explicit confirmation |

The user has confirmed the existing administrator-requested workflow and 10 MB limit, superseding the earlier document recommendation.
Keep existing business-field permissions as well; no new document-related backend feature is requested.
Proceed with existing-policy frontend work while D4 remains open.
If the project lead confirms that remarks supersede the design, update the design and backend spec/change log in the same implementation change.

## R1: Verify and reuse the existing administrator-requested document policy

Start with `modules/sellers/types.ts`, `documents.ts`, `jobs.ts`, `service.ts`, `applications.ts` and seller/admin document route handlers.
Reuse the existing private document lifecycle, storage adapter, worker validation and supported file formats.
An administrator requests a document, the seller or authorised applicant uploads it, and the administrator reviews it under current rules.
No new submission type, endpoint, schema field or policy migration is planned for this requirement.
Limit sellers to their own business; allow pending applicants only through the explicit applicant context.
Do not let the browser mark a file accepted or bypass document review.
Existing open requests must continue to block approval until accepted or cancelled according to the service.

Retain the existing inclusive limit of 10 * 1024 * 1024 bytes (10,485,760 bytes), labelled 10 MB in the current UI policy.
Reuse that limit consistently in validation schemas, signed POST conditions, actual stored-object checks, worker handling, error messages and frontend metadata.
Check content bytes as well as declared MIME and extension; reuse existing PDF/image sanitation.
Use the existing PDF, JPEG and PNG support rather than promising all image formats.
Reject encrypted, malformed or unsafe PDFs according to the existing worker policy.
Keep originals and checked files private and downloads signed with short expiry.
Record administrator request/review/cancel actions in audit logs.
Existing accepted files and already-issued upload forms keep the same size policy; no size-limit migration or grandfathering rule is needed.
Use transactions, row locks and queue sends already in the service; test registration/review races.

Document existing endpoint methods, request shapes, response envelopes, statuses and errors alongside the frontend implementation evidence.
Change backend code only if verification exposes a defect, with a reproducing test and a focused fix.

## R2: Minimum quantity is already backend work completed in source

Reuse product-level `minOrderQuantity`, default 1, range 1 through 1000.
No new price threshold or automatic rule for Rs 50 products is requested.
A seller sets the minimum explicitly regardless of price.
Keep field support in product create/update, imports, cards/detail reads, purchasability, cart and fresh checkout validation.
Keep quantity as an integer; do not reinterpret the minimum as a multiple or combine variants.
Only change backend code if tests expose a missing path or a confirmed product decision changes semantics.
Do not snapshot an invented minimum into historical orders unless the agreed design requires it.

## R3: Media backend is mostly present

Reuse `MAX_IMAGES_PER_PRODUCT = 4` and single-video uniqueness.
The first ready photo in seller ordering is the public cover; preserve processing/failure rules rather than showing an unverified original.
Use existing upload, register, delete, reorder and video conversion services.
Keep video originals private and only converted MP4/poster public.
The worker requires ffmpeg/ffprobe; no file bytes should pass through the Next.js request.
Add mandatory counts only after D4, with coherent submission validation and treatment of older listings.

## Automated acceptance

| ID | Scenario | Required assertion |
| --- | --- | --- |
| B01 | Document size 0, 10,485,759, 10,485,760 and 10,485,761 bytes | Empty and oversized files refused; both valid sizes accepted at signing, registration and worker stages when content is otherwise valid |
| B02 | Fake MIME, wrong bytes, malformed/encrypted PDF, unsupported image | Validation failure; no public exposure or accepted document |
| B03 | Buyer/applicant/seller/admin and another seller's identifiers | Correct ownership/status access; no cross-seller signed link |
| B04 | Administrator request, seller upload, review and approval blocker | Only authorised actors perform each step; open requests block approval until accepted or cancelled; no seller self-acceptance |
| B05 | Duplicate upload/review, stale signed form, concurrent final approval | Deterministic conflict or idempotent result; no approval bypass |
| B06 | Minimum 0, 1, 10, 1000, 1001, fraction and omitted value | Valid range/default; minimum 10 allows 11; no float accepted |
| B07 | Raise minimum after cart creation, insufficient stock, checkout race | Fresh validation refuses stale invalid order |
| B08 | Fifth photo, duplicate concurrent video, failed replacement, reorder | Caps enforced server-side; valid cover/video only |

Extend existing `sellers/documents.test.ts`, seller route tests, catalogue tests, import row tests, cart tests and checkout tests.
Add schema-rule tests if schema changes.
Run `pnpm --filter @ecokart/core test`, `pnpm --filter @ecokart/web test`, `pnpm lint`, `pnpm typecheck` and relevant worker tests.
Record proposed cases as unrun until executed.

## Completion evidence

Pending.
Record D1 and D2 as resolved by the user's instruction to keep the existing administrator-requested workflow and 10 MB policy.
Retain D3's existing field permissions and record any D4 answer, backend defect fixes, current API contract and actual command outputs.
If no backend change is needed for R2/R3, mark those subparts verified with test evidence rather than inventing new implementation work.
