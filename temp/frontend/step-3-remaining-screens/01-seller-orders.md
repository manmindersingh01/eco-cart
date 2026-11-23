# 01: Seller order list and detail

Status: complete.
Depends on: None.

## Read first

Read [the shared completion rules](README.md#completion-rules), root AGENTS.md and [handover section 7.1](../../../docs/frontend-handover.md).
Read the matching flow in docs/system-design.md and the existing route handler, service and types before changing a screen.
Verify payloads against the code instead of copying an old plan.

## One-session scope

Build /seller/orders and /seller/orders/[id] using seller order reads. Add status tabs, cursor navigation, buyer delivery details and seller-only lines. Link invoices with ?as=seller and add the menu entry.

## Acceptance

Two sellers see only their own lines; dual-role accounts use seller context; empty tabs, invalid IDs and invoice failures are clear.
Also meet the shared loading, error, permission, accessibility and browser checks.
Do not add backend behaviour to fill a missing contract; stop and report it.

## Manual prerequisites

Use [the preparation checklist](00-manual-preparation.md).
Provider credentials are not required to implement this task with local services and stand-ins.
For AI tasks, real provider success remains unverified until credentials and catalogue embeddings are ready.

## Evidence to record

Record the commit, changed routes, commands and exit codes, observed acceptance results, browser sizes, and any deferred checks.
Use planned, in_progress, implemented_pending_verification, blocked or complete honestly.
Do not mark complete while required checks are missing.

## Implementation, 21 November 2026

The seller menu now links to `/seller/orders`.
The four status filters retain the selected tab in the address and reset the cursor when changed.
The first page and subsequent pages use `listSellerOrders` with the authenticated seller context.
Order details use `getSellerOrder` and show only the returned seller lines, delivery details, line status, shipment details, seller total and seller invoices.
Invoice downloads retain `?as=seller`; a failed download check shows a message beside the link.
An unavailable PDF has a refresh and administrator recovery explanation.
Invalid and inaccessible order IDs show the same not-found message.
Dispatch and delivery controls remain task 02.

The user approved focused new browser coverage, then agreed on 24 November 2026 to one browser at large, medium and mobile sizes instead of exhaustive scenarios or mandatory Safari checks.

## Completion evidence, 24 November 2026

Delivered on `frontend/step-3-seller-orders`, based on commit `4cb928b`.
The implementation and this evidence are committed together; no deployment is included.
No backend contract, migration or provider configuration changed.
The root `frontend-handover.md` and `remarks2.md` remain untouched.

### Files and integration

- `apps/web/src/app/seller/orders/page.tsx`: four status filters, seller-only order cards and cursor navigation.
- `apps/web/src/app/seller/orders/[id]/page.tsx`: seller lines, totals, address, buyer phone, shipment information and invoices.
- `apps/web/src/app/seller/orders/[id]/not-found.tsx`: invalid or inaccessible orders.
- `apps/web/src/components/seller/order-refresh.tsx` and `invoice-download.tsx`: refresh and invoice error handling.
- `apps/web/src/app/seller/layout.tsx`: Orders menu link.
- `apps/web/e2e/seller-orders.spec.ts`, test fixtures and launcher: focused real-service verification with disposable resources.
- `apps/web/playwright.config.ts`: medium-size Chrome project alongside large and mobile.
- `AGENTS.md`, the tracked frontend handover, this folder's README and preparation guide, and the browser-test README: updated verification policy.

### Environment and observed results

Windows, pnpm 12, PostgreSQL, Mailpit, local object storage and a real background worker.
The browser test used database `ecokart_test_e2e_f44589e4430a` and bucket `ecokart-test-e2e-f44589e4430a`; the launcher confirmed cleanup of both.
AI was disabled and checkout used cash on delivery.
No real payment or AI provider was called.

Chrome passed at 1440 x 900, 768 x 1024 and 390 x 844.
Order-list and detail screenshots were inspected, including light and dark layouts.
Automated accessibility and horizontal-overflow checks passed, and keyboard activation of refresh worked.

The focused journey created a real order containing products from two sellers.
Each seller saw only their own lines; the combined buyer/seller account used seller invoice context.
An unrelated seller could not open a private order or another seller's invoice.
Sign-in and wrong-role redirects, status filters, cursor navigation, reload/back behaviour, empty statuses and invalid IDs/cursors passed.
Refreshing after a real dispatch showed the updated tracking details.
A real invoice PDF downloaded successfully; a controlled HTTP 409 response displayed the invoice error beside its link.
Loading boundaries and unavailable-invoice messages are implemented; exhaustive timing and failure combinations were outside the agreed scope.

### Commands and output

```powershell
$env:E2E_CHROME = '1'
pnpm test:e2e -- --project=chrome-desktop --project=chrome-medium --project=chrome-phone seller-orders.spec.ts
```

Exit 0: `3 passed (1.6m)`.
The environment override was scoped to that command's shell.
The local report and screenshots are in `apps/web/.e2e/runs/f44589e4430a/` (ignored generated artifacts).

```text
pnpm check
All matched files use Prettier code style!
Lint: exit 0
Typecheck: core, web and worker Done
Core: 75 test files passed; 996 tests passed
Web: 51 test files passed; 264 tests passed
Worker: 1 test file passed; 11 tests passed
Build: Compiled successfully in 17.9s
Generating static pages (89/89)
```

Exit 0, including both new seller order routes in the production build.
`git diff --check` also passed.

### Earlier findings and remaining scope

The first final-check attempt found a test-helper lint error; moving the helper to module scope fixed it, and the full check then passed.
Earlier exploratory browser runs exposed an ambiguous alert selector and shared-IP sign-in throttling; both test issues were corrected.
A 21 November Chrome run also returned 404 in an invoice redirect assertion; its cause was not established, and the fresh 24 November run passed the real download in all three sizes without a backend change.
No known failing check remains in the agreed task scope.
Real Safari and additional browsers are optional under the revised policy, not pending completion gates.
Real Razorpay and AI checks are outside this read-only order-screen task.
Dispatch and delivery controls remain task 02.
