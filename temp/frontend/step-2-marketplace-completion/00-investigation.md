# 00: Investigation and implementation inventory

| Field | Value |
| --- | --- |
| Status | `complete` for source investigation and documentation verification |
| Implemented | Yes, documentation only |
| Runtime verified | No |
| Depends on | None |
| Evidence | Source snapshots, capability coverage and reproducible documentation checks recorded below |
| Verified on | 20 October 2026, Asia/Kolkata |
| Verification checkout | `901b685fdd74281966de5b13545a850b6d18ee6d` |

## Main finding

Most remaining work is frontend delivery and integration, not a new backend build.
The current frontend branch contains the first admin/seller delivery plus a substantial backend snapshot.
The locally available `origin/main` contains more backend work that has not yet been integrated.
Even that newer backend has no buyer shopping pages beyond the existing home and sign-in shell.
Do not interpret API existence as a completed user journey.

The original application snapshot is `bf44e579ffcba709715e964f31dd917d8e3ce5b1`.
At task 00 finalisation, HEAD is `901b685fdd74281966de5b13545a850b6d18ee6d` and the available `origin/main` reference is still `8c73cd7751f38661ffafd8e31902aff9243ff388`.
The intervening commit changes documentation only; application code, workspace manifests, lockfile and CI configuration are unchanged.
The inventory therefore remains valid for this checkout, subject to task 02's later integration.

## Stage 2 boundary

This folder covers local application development and its automated verification.
Stage 3 covers final deployment and finalisation, including infrastructure, backups/restore, production monitoring and live provider configuration.
Task 12 produces a local release result and records Stage 3 handover items; local development uses test data and existing provider stand-ins.
No fetch, merge, app execution, dependency installation or production action is required to complete this investigation task.

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

## Coverage of remaining capabilities

Every capability in the inventory has a delivery or verification task.
Task numbers identify work to implement later; this mapping does not mark those capabilities tested or complete.

| Capabilities | Delivery and verification tasks |
| --- | --- |
| Existing portal foundation, email/phone accounts, combined roles and backend integration | [01 automation](01-automation-prerequisites.md), [02 integration](02-integration-and-roles.md), [07 account](07-account-and-cart.md) |
| Seller joining and administrator-requested documents | [03 existing-policy verification](03-remarks-backend.md), [04 onboarding](04-seller-onboarding.md) |
| Minimum quantity, photos/video, moderation and CSV/XLSX imports | [03 contract verification](03-remarks-backend.md), [05 catalogue](05-catalogue-operations.md) |
| Public catalogue, keyword search and public quantity/media presentation | [06 storefront](06-storefront.md) |
| Addresses, guest/account cart and coupons | [07 account and cart](07-account-and-cart.md) |
| Checkout/payment, orders, fulfilment and invoices | [08 checkout and orders](08-checkout-and-orders.md) |
| Returns/refunds, bank details, seller ledger, payouts and statements | [09 returns and settlements](09-returns-and-settlements.md) |
| Reviews, policy pages and failed background work | [10 content and operations](10-content-and-operations.md) |
| AI platform/usage, listing suggestions, import mapping, meaning/photo search, similar products, assistant and search-gap reports | [11 AI features](11-ai-features.md) |
| Automated infrastructure, browser regression and local release evidence | [01 automation](01-automation-prerequisites.md), [12 local release](12-release-and-evidence.md) |

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

## Completion evidence

Implementation evidence is this updated inventory, its capability-to-task mapping, and the README's verified source snapshots and Stage 2 boundary.
Only documentation is changed by task 00 finalisation.

| Check | Exact command or procedure | Observed result |
| --- | --- | --- |
| Snapshot identity | `git rev-parse HEAD origin/main` | Exit 0; checkout `901b685fdd74281966de5b13545a850b6d18ee6d`, available upstream `8c73cd7751f38661ffafd8e31902aff9243ff388` |
| Application/configuration drift | `git diff --stat bf44e579ffcba709715e964f31dd917d8e3ce5b1 HEAD -- apps packages .github pnpm-workspace.yaml pnpm-lock.yaml package.json` | Exit 0; no differences |
| Document contract | Read `packages/core/src/modules/sellers/types.ts` and its document service/routes | Administrator-requested workflow; PDF/JPEG/PNG; inclusive `10 * 1024 * 1024` byte maximum; open requests retain approval blockers |
| Newer capabilities | `git ls-tree -r --name-only origin/main packages/core/src/modules apps/web/src/app/api` | Exit 0; applications, fulfilment, returns, statements, assistant, natural/photo search and background-work services present in upstream snapshot |
| Automation availability | Read root/web manifests and workspace catalog; search for Playwright configuration | Vitest exists; declared Playwright/axe dependencies and browser-runner configuration are absent; task 01 remains necessary |
| Capability coverage | Compare each capability matrix row with the coverage table above | All listed capabilities mapped to tasks 01 through 12 |
| Formatting | `pnpm exec prettier --check temp/frontend/step-2-marketplace-completion` | Exit 0; `All matched files use Prettier code style!` |
| Relative links | PowerShell procedure below | Exit 0; `PASS: 15 Markdown files; all relative link targets exist.` |
| Whitespace | `git diff --check -- temp/frontend/step-2-marketplace-completion` | Exit 0; no whitespace errors; Git reported only its configured LF-to-CRLF conversion notices |
| Section anchor | `rg -n '^## Completion evidence' temp/frontend/step-2-marketplace-completion/00-investigation.md` | Exit 0; heading exists for README's completion-evidence link |

Run formatting and whitespace checks from the repository root:

```powershell
pnpm exec prettier --check temp/frontend/step-2-marketplace-completion
git diff --check -- temp/frontend/step-2-marketplace-completion
```

Run this relative-link check from the repository root:

```powershell
$planFiles = Get-ChildItem -LiteralPath 'temp/frontend/step-2-marketplace-completion' -Filter '*.md'
$brokenLinks = @()
foreach ($planFile in $planFiles) {
  $planText = Get-Content -Raw -LiteralPath $planFile.FullName
  foreach ($planMatch in [regex]::Matches($planText, '\]\(([^)]+)\)')) {
    $planTarget = $planMatch.Groups[1].Value.Split('#')[0]
    if ($planTarget -and $planTarget -notmatch '^https?://') {
      if (-not (Test-Path -LiteralPath (Join-Path $planFile.DirectoryName $planTarget))) {
        $brokenLinks += "$($planFile.Name): $planTarget"
      }
    }
  }
}
if ($brokenLinks.Count) {
  $brokenLinks
  throw 'Broken relative Markdown links'
}
Write-Output "PASS: $($planFiles.Count) Markdown files; all relative link targets exist."
```

The script checks target-file existence; the `completion-evidence` section anchor is checked against this document's heading separately.
No application tests, lint/typecheck, build or browser journeys are needed for this documentation-only task, and none is claimed as run.
Runtime correctness remains unverified here and is covered by the later implementation tasks.

## Handover

Task 00 is complete: source investigation and documentation checks passed.
The next task is [01: Automation prerequisites](01-automation-prerequisites.md).
It can rely on the verified source inventory, retained administrator-requested 10 MB document policy, capability coverage and local Stage 2 boundary.
It must create the missing isolated browser-testing setup before later tasks claim end-to-end test coverage.
