# 03: Administrator order list and detail

Status: complete.
Depends on: None.

## Read first

Read [the shared completion rules](README.md#completion-rules), root AGENTS.md and [handover section 7.2](../../../docs/frontend-handover.md).
Read the matching flow in docs/system-design.md and the existing route handler, service and types before changing a screen.
Verify payloads against the code instead of copying an old plan.

## One-session scope

Build /admin/orders and /admin/orders/[id] with status, order-number and needs-refund filters. Show payments, parcels, events and invoices.

## Acceptance

Filters reset the cursor; Back preserves filters; wrong roles cannot open the page; server totals and history are displayed unchanged.
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

## Implementation evidence - 25 November 2026

Implemented on `frontend/step-3-admin-orders`, based on task 02 commit `9c46f49`.
Delivered on the `frontend/step-3-admin-orders` branch.

### Delivered

- `/admin/orders` lists orders with full order-number, status and needs-refund filters, server totals and cursor pagination.
- Applying filters starts at the first page; detail links and Back to orders preserve the selected filters and cursor.
- `/admin/orders/[id]` shows the buyer and delivery snapshot, item snapshots, server totals, distinct parcels, payments, chronological events and invoices.
- Invoice downloads use the existing private download route with administrator permissions; unavailable PDFs show a refresh message.
- Added Orders to the administrator menu, with loading, invalid-filter, empty-list and missing-order states.
- Session checks protect both pages; data reads use existing services and request context without caching private data.

No backend contracts changed.
Cancellation, refund recording, delivery overrides and invoice regeneration remain task 04.
The root frontend-handover.md and remarks2.md were left untouched.

### Verification

Focused browser coverage uses real local checkout, dispatch, order services and invoice generation.
It checks roles, cursor navigation, filter reset and return, order data, invoice access, empty/error states, keyboard filtering, light/dark accessibility and horizontal overflow.
The agreed browser sizes are Chrome at 1440 x 900, 768 x 1024 and 390 x 844.
The three-size browser run passed, including the real cash-on-delivery checkout and dispatch, original event count and notes, invoice redirect, buyer/seller refusal and signed-out redirect.
Reviewed the desktop dark detail, medium list and mobile light detail screenshots; no visible layout issues were found.

```powershell
$env:E2E_CHROME = '1'
pnpm test:e2e --project=chrome-desktop --project=chrome-medium --project=chrome-phone --grep=AO01
```

Exit 0: `3 passed (1.6m)` in the final run, including the Clear-filter regression check.
Evidence is in `apps/web/.e2e/runs/69e9db80315d/`.
The browser environment used disposable local resources, with AI and online payment disabled.
Live Razorpay behaviour and the positive paid-cancelled refund journey remain outside this focused screen check; existing service tests cover refund eligibility.
No real provider credentials are needed for this task.
The browser run's disposable database and bucket were cleaned successfully.

```text
pnpm check
All matched files use Prettier code style!
Lint: exit 0
Typecheck: core, web and worker Done
Core: 75 files passed; 996 tests passed
Web: 51 files passed; 264 tests passed
Worker: 1 file passed; 11 tests passed
Build: Compiled successfully in 12.0s
Generating static pages (91/91)
```

Exit 0.
`git diff --check` passed.
The complete check passed before the final filter-form reset fix; lint and typecheck were rerun after that fix, and the final browser run above tested it at all three sizes.

### Findings resolved during verification

Docker Desktop was stopped at the first browser attempt.
Started Docker Desktop and ran `pnpm db:up`; PostgreSQL, Mailpit and object storage became healthy.
Cleaned the failed setup's disposable resources using the harness cleanup helper.
Fixed a payment-label type error and a lint finding before the final checks.
The first desktop test compared raw URL strings after Back navigation; changed it to compare the preserved filter values because query ordering and empty parameters do not change the result.
An added browser check reproduced a Clear-filter issue: the URL and results reset, but the status dropdown retained its previous value.
Keyed the filter form by its URL state so navigation resets the visible controls too.
