# Marketplace completion: backend alignment and frontend delivery

Prepared on 20 October 2026.
This folder tracks the implementation plan and each task's completion evidence.
The initial delivery was documentation only; subsequent implementation and test results are recorded in the task files.

## Stage boundary

Stage 2 delivers and verifies the local application, including automated tests, against local services and provider stand-ins.
Stage 3 is the final deployment and finalisation stage, covering AWS infrastructure, deployment automation, backups and restore, production monitoring, live provider configuration and final client sign-off.
Task 12 is the Stage 2 local release gate and handover to Stage 3; it does not implement production deployment.
Production inputs listed there are handover items, not prerequisites for completing local development with test data and stand-ins.

## Start here

Read [the investigation](00-investigation.md), then execute tasks 01 through 12 in order.
Each task is a bounded implementation brief with prerequisites, backend and frontend work, acceptance tests, and evidence requirements.
Read the current repository instructions and the matching system design section before implementing a task.
Recheck the actual integrated code before copying any API payload from this snapshot.

The first frontend delivery remains the existing `temp/frontend/step-1-admin-seller-portals` work.
Do not rebuild those screens.
Extend them and protect them with browser regression tests.
The user reports that delivery as done; its old tracker still lists manual checks as pending.
Carry that discrepancy as historical evidence debt, not proof of a broken feature or permission to fabricate results.

## Source snapshots and authority

| Source | Snapshot | How used |
| --- | --- | --- |
| Original application snapshot | `bf44e579ffcba709715e964f31dd917d8e3ce5b1` | Frontend and backend inspected for the original investigation |
| Task 00 verification checkout | `901b685fdd74281966de5b13545a850b6d18ee6d` | Rechecked application code/configuration unchanged from the original snapshot; planning documents committed |
| Locally available `origin/main` | `8c73cd7751f38661ffafd8e31902aff9243ff388` | Newer backend inspected with `git show` and `git ls-tree` |
| User requests | Root `remarks.md`, read on 20 October 2026 | Requested documents, minimum quantity, and media presentation |
| Architecture | `docs/system-design.md`, including the newer snapshot | Services, permissions, money, transactions, and caching |
| Backend tracker | `docs/backend-spec.md` | Historical build order; status cells lag some code |

The original source investigation performed no fetch, pull, merge, migration, dependency installation, app execution or application test.
`origin/main` means the local remote-tracking reference, not a claim about the live GitHub head.
Your existing changes to `ADITYA.md` and `remarks.md` must be preserved.
An upstream instruction or decision is not silently adopted into this checkout: task 02 reconciles it explicitly.
The user has confirmed retaining the existing inclusive 10 MB document limit (10 * 1024 * 1024 bytes).
The user has also confirmed retaining the existing administrator-requested document workflow.
Document uploads need frontend coverage and verification of the existing backend, with no new submission lifecycle or size-policy change.

## Delivery order and tracking

Use the existing `frontend/step-N-description` naming convention for frontend deliveries.
The proposed sequence starts at 2 because delivery 1 already exists.
Use focused `backend/description` branches only where task 03 establishes a real backend gap.
Do not put this entire programme into one pull request.
Each branch should start from the reviewed integration head containing its dependencies, rather than an old hard-coded `windows/fixes` base.
Confirm actual remote names again when implementation starts.

| Order | Task | Dependencies | Proposed branch | Implemented | Status |
| --- | --- | --- | --- | --- | --- |
| 00 | [Investigation and gap inventory](00-investigation.md) | None | Documentation only | Yes, investigation only | Complete; source and documentation verified; runtime unverified |
| 01 | [Automation prerequisites](01-automation-prerequisites.md) | 00 | Current `step-2-marketplace-completion` branch | Yes | Complete; 24 browser tests, harness verification and `pnpm check` passed |
| 02 | [Backend integration and role compatibility](02-integration-and-roles.md) | 01 | `frontend/step-3-backend-alignment` | No | Planned |
| 03 | [Remarks decisions and backend changes](03-remarks-backend.md) | 02 | No separate backend branch unless verification exposes a defect | No | Existing document workflow and 10 MB limit confirmed |
| 04 | [Seller applications and verification](04-seller-onboarding.md) | 02 | `frontend/step-4-seller-onboarding` | No | Planned |
| 05 | [Catalogue lifecycle, quantity, media, imports](05-catalogue-operations.md) | 02; 04 for applicant journey | `frontend/step-5-catalogue-operations` | No | Planned |
| 06 | [Public shop and keyword search](06-storefront.md) | 05 | `frontend/step-6-storefront` | No | Planned |
| 07 | [Buyer account, addresses, cart, coupons](07-account-and-cart.md) | 06 | `frontend/step-7-account-cart` | No | Planned |
| 08 | [Checkout, orders, fulfilment, invoices](08-checkout-and-orders.md) | 07 | `frontend/step-8-checkout-orders` | No | Planned |
| 09 | [Returns, refunds, seller money](09-returns-and-settlements.md) | 08 | `frontend/step-9-returns-settlements` | No | Planned |
| 10 | [Reviews, policies, operations tools](10-content-and-operations.md) | 08; 09 for refund support | `frontend/step-10-content-operations` | No | Planned |
| 11 | [AI features and reporting](11-ai-features.md) | 05, 06, 10 | `frontend/step-11-ai-features` | No | Planned |
| 12 | [Release, CI, and proof](12-release-and-evidence.md) | 01 through 11, or explicit scope decision | `frontend/step-12-release` | No | Planned |

Task numbers are a recommended chronological execution sequence.
The dependency column is the actual blocking relationship.
For example, any unresolved mandatory-media decision must not block the existing requested-document screen, catalogue work under current limits, or checkout.
Prioritise payment integrity, order accuracy, catalogue, and the buyer journey over AI convenience.
Reassess the 31 October launch scope after task 02; do not promise this whole programme fits the remaining days.

## Completion contract for every task

Use `planned`, `in_progress`, `blocked`, `implemented_pending_verification`, and `complete` consistently.
Change `Implemented` to `Yes` only after all included acceptance cases pass.
An existing backend file means `present in code`, not `verified in this run`.
Required runtime evidence is the exact command, date, commit, environment, exit code, and observed results.
Use [the evidence template](evidence-template.md) in each task's completion section.
Every automated case needs a stable test identifier linked to a test file and result artifact.
Screenshots support appearance; they do not prove persistence, permissions, money, or concurrency.
Any intentionally deferred criterion needs its reason, owner, and release impact.

Run `pnpm lint`, `pnpm typecheck`, and relevant package tests for each code task.
Run `pnpm check` at each delivery gate; it already runs format, lint, typecheck, tests, and build in order.
Do not run all those commands twice without a failure or intervening change.
Add and run the task's browser suite once task 01 provides it.
Proposed test scripts in this plan do not exist yet unless explicitly described as existing.

## Backend implementation boundaries

Reuse the inspected backend rather than building duplicate modules.
Only add backend behaviour for approved remarks gaps, proven integration defects, or a missing contract that blocks an included screen.
Keep pages and routes free of SQL; call core services.
Preserve RLS, audit logs, order events, keyset pagination, integer paise, and transaction-safe queue writes.
Use `invalidateStorefront` in core transactions, including worker writes; do not restore the old route-level `revalidateTag` approach.
Update architecture/specification documents in the same implementation change when an agreed contract changes.

## Documentation validation

The investigation is based on read-only source and Git inspection.
Formatting and relative-link checks are documentation checks only.
Application tests were not run for the original documentation delivery; later task evidence records their own test runs.
Record actual documentation check results in the final handover, without copying historical test counts as current proof.

Documentation check evidence, 20 October 2026:

- `pnpm exec prettier --check temp/frontend/step-2-marketplace-completion` returned exit code 0 and `All matched files use Prettier code style!`.
- A PowerShell relative-link scan of all 15 Markdown files returned exit code 0 and `PASS: 15 Markdown files; all relative links resolve.`.
- Repository-wide `git diff --check` reported existing trailing whitespace in the user's edited `remarks.md`, line 2.
  That file was left unchanged by this documentation task.
- No application tests or browser journeys were run for that original documentation-only delivery.

Task 00 finalisation evidence is recorded in [the investigation](00-investigation.md#completion-evidence).
Task 01 implementation and verification are recorded in [the automation task](01-automation-prerequisites.md).
It provides working root browser commands, real local OTP/upload journeys, automated accessibility/keyboard checks and CI configuration.
The final local verification passed 24 browser tests, four harness unit tests, three expected-failure probes and the repository's 1,048 package tests plus production build.
Tasks 02 through 12 remain planned.
