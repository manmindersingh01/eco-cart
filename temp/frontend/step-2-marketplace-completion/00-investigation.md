# 00: Investigation and implementation inventory

| Field | Value |
| --- | --- |
| Status | Complete for source investigation |
| Implemented | Yes, documentation only |
| Runtime verified | No |
| Depends on | None |
| Evidence | Read-only inspection of the two Git snapshots in README and the working-tree remarks |

## Main finding

Most remaining work is frontend delivery and integration, not a new backend build.
The current frontend branch contains the first admin/seller delivery plus a substantial backend snapshot.
The locally available `origin/main` contains more backend work that has not yet been integrated.
Even that newer backend has no buyer shopping pages beyond the existing home and sign-in shell.
Do not interpret API existence as a completed user journey.

## Capability matrix

Paths below are relative to the repository root.
The newer-backend column describes the inspected `origin/main` snapshot, without claiming its tests were run.

| Capability | Current local evidence | Additional newer-backend evidence | Frontend work | Backend work to schedule |
| --- | --- | --- | --- | --- |
| Existing portal foundation | `apps/web/src/app/admin`, `seller`, `components/ui`, `lib/page-auth.ts` | Same page inventory, with backend context changes | Preserve and add regression coverage | Reconcile merge semantics |
| Email and phone accounts | Auth module, `/api/me`, email sign-in form | Hashed phone OTP and combined account roles | Phone sign-in, account profile, multi-role navigation | Integrate upstream auth, do not duplicate it |
| Seller joining | Admin-created seller and read-only tax identifiers in seller profile | `modules/sellers/applications.ts`, `/api/account/seller-application`, admin seller reject | Application/edit/status journey and admin application review | Integrate existing application and document contracts |
| Seller documents | `modules/sellers/documents.ts`, `types.ts`, `jobs.ts`, seller/admin document APIs and tests | Applicant access to requested-document routes | Seller upload/status and administrator request/review screens | Retain confirmed administrator-requested workflow and 10 MB limit; verify existing backend |
| Minimum buying quantity | `catalogue/types.ts`, `products.ts`, `stock.ts`, cart service, import rows, public types | Same capability carried forward | Product create/edit field, product/card notice, quantity controls, cart errors | Existing semantics need regression tests, not a second implementation |
| Four photos and one video | `images.ts` caps non-failed photos at 4; `videos.ts` enforces one optional video | Public media DTOs and video processing retained | Editor upload/video states, cover selection, product gallery and thumbnail | Confirm whether requested counts are maxima or required counts |
| Listing moderation | `catalogue/moderation.ts`, screening jobs, admin moderation and product action APIs | AI screening and worker integration | Seller submit/withdraw/status and administrator review queue | Integrate and prove cache invalidation and permissions |
| CSV/XLSX import | `imports/service.ts`, `rows.ts`, `jobs.ts`, route tests | `imports/mapping.ts`, `ai-mapping.test.ts`, mapping tests | Upload, mapping, progress, errors and retry guidance | Reuse existing import and suggestion contracts |
| Public catalogue | `catalogue/storefront.ts`, `storefront-types.ts`, `apps/web/src/lib/storefront.ts` | Same plus similar-product endpoint | Real home, category, product and search pages | Preserve anonymous cache wrappers and tag changes |
| Keyword search | `search/service.ts`, `/api/search`, gap report | Meaning/photo search and embeddings | Search/filter/sort/pagination and no-match states | No new keyword engine |
| Buyer account | `/api/me` and Better Auth update/verification handlers | Expanded role resolution and profile support | Name/email/phone edit and verification | Integrate existing behaviour; inspect exact Better Auth API first |
| Addresses | `addresses/service.ts`, account address routes and tests | Present | Address book, default, checkout selector | Reuse server validation |
| Cart and coupons | `cart/service.ts`, pricing/coupons, cart and admin coupon APIs | Cleanup jobs and upstream hardening | Guest/account cart, coupon UI, admin coupon editor | Verify login merge and minimum-quantity semantics |
| Checkout/payment | `checkout/service.ts`, `payments/service.ts`, checkout and webhook routes | Refund hardening and demo flow | COD and online checkout, pending/failure/result recovery | Integrate and prove exact-once effects |
| Orders and fulfilment | Local orders module primarily creates/confirms/expires orders | `orders/fulfilment.ts`, `views.ts`, account/seller/admin order APIs and shipment actions | Role-specific order views, cancellation, dispatch, delivery | Integrate; local creation helpers are not a full order-management API |
| Invoices | Invoice services, PDF jobs, invoice APIs | Attached to order views | Invoice status/list/download/retry | Verify private downloads and cancellation PDFs |
| Returns/refunds | No complete local returns module | `modules/returns`, return-photo APIs, admin refund/cancel actions | Buyer requests, seller visibility, administrator decisions and refund recording | Integrate; do not mistake recording a refund for sending money |
| Seller money | Local ledger records sales and commission only | Bank accounts, ledger, payouts, adjustments, statement services/tests | Masked bank details, earnings, administrator reconciliation and statements | Integrate; never automate real bank transfers |
| Reviews | `reviews/service.ts`, public/mine/admin APIs | Delivered-order verification | Product reviews, own review form and admin moderation | Reuse rating refresh and visibility |
| Policy pages | `content/service.ts`, `types.ts`, admin/public APIs | Present | Administrator Markdown editor, published policy routes, company footer | Approved copy still needed, safe rendering implementation needed |
| Failed background work | Worker queues exist | Admin email/queue list and retry APIs | Operations dashboard with safe retry controls | Integrate existing admin services |
| AI platform and usage | AI service/client, request log/limits, admin usage API | Embedding, natural/photo search, assistant, import mapping | Optional search, assistant, listing suggestions, usage and search-gap reports | Integrate and reuse local stand-ins |
| Automation | Vitest integration tests and Linux CI with PostgreSQL, Mailpit, SeaweedFS and ffmpeg | `apps/web/scripts/demo-flow.ts`, root `demo:flow` script | Playwright browser journeys and accessibility checks | Isolated E2E launcher/fixtures and CI artifacts missing |

## Remarks traceability

| ID | Request | Observed behaviour | Remaining work | Task |
| --- | --- | --- | --- | --- |
| R1 | Retain existing seller verification policy, as confirmed by the user's clarification | Applications upstream accept allowed tax details; document uploads are administrator-requested with a 10 MiB limit | Build seller upload/status and administrator request/review screens using existing field permissions, workflow and inclusive 10 * 1024 * 1024 byte limit | 03, 04 |
| R2 | Seller chooses minimum buying quantity | Product-level `minOrderQuantity`, default 1, allowed 1 through 1000; cart and imports already consume it | Expose field and explain minimum on product/cards/cart; verify server-side bypass protection | 05, 06, 07, 08 |
| R3 | One featured video, one thumbnail photo, three supporting photos | Maximum four non-failed photos; first ready ordered photo is public main photo; one optional video | Reconcile UI upload cap, cover ordering and video workflow; confirm whether all assets are mandatory | 03, 05, 06 |

The minimum is a floor, not a pack multiple.
A minimum of 10 permits 10 or 11 units unless the client separately requests pack multiples.
The field is on the product and applies independently to its variant cart lines under current backend semantics.
Do not silently total quantities across variants to satisfy it.
Insufficient stock for the minimum means unavailable, even if a few units remain.

## Important inconsistencies

1. The old frontend README says product APIs do not exist and uses an old branch base.
   Those statements were accurate for its original delivery but must not guide new implementation.
2. Local `docs/backend-spec.md` labels cart, checkout and import Planned even though implementations and tests exist.
   The newer snapshot improves some statuses but still labels several implemented areas In progress.
   Source, routes and observed test results must be reconciled before marking backend steps complete.
3. Local instructions recommend one role per account.
   The newer design/instructions record a 20 October decision permitting buyer and seller roles on one account.
   Task 02 must integrate the recorded decision and update the frontend's role assumptions together.
4. The user confirmed retaining the existing administrator-requested document workflow and inclusive limit of 10 * 1024 * 1024 bytes, labelled 10 MB.
   The earlier document recommendation is superseded; there is no pending document-policy decision or new document lifecycle to implement.
5. One video is currently optional, and fewer than four photos can be valid.
   Do not make a video or all four photos mandatory without a confirmed requirement.
6. Lockfile peer references to Playwright do not establish an installed test runner.
   No declared `@playwright/test`, `@axe-core/playwright`, Playwright config or E2E script was found in the inspected manifests/tree.
7. The upstream demo defaults to port 3000; local web development is explicitly on 3210.
   Always pass an explicit base URL and update test configuration rather than reintroducing the earlier Windows port issue.

## Reproduce this investigation on Windows

Run these read-only commands from the repository root.
`rg` is the available search tool equivalent to grep.

```powershell
git status --short
git branch -r
git rev-parse HEAD origin/main
git log --oneline HEAD..origin/main
rg --files apps/web/src/app packages/core/src/modules
rg -n 'minOrderQuantity|MAX_DOCUMENT_BYTES|MAX_IMAGES_PER_PRODUCT' packages/core/src
rg -n 'playwright|axe-core' package.json apps/web/package.json pnpm-workspace.yaml
git show origin/main:apps/web/src/app/api/me/route.ts
git show origin/main:packages/core/src/modules/sellers/applications.ts
git ls-tree -r --name-only origin/main apps/web/src/app/api
```

No output from environment files is required or appropriate.
No network freshness or runtime correctness is implied by these commands.

## Evidence

Implementation evidence is this inventory and its linked task briefs.
Test evidence is not applicable to source inspection; no application tests were executed.
Future implementation must replace assumptions with observed integration and browser results.
