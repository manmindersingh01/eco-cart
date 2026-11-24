# 02: Dispatch and delivery

Status: complete.
Depends on: 01.

Implementation started on `frontend/step-3-seller-dispatch`, based on task 01 commit `8c78847`.
Use the existing shipment APIs for selected confirmed lines and delivery confirmation.
Keep server conflict messages visible while refreshing the order, and prevent duplicate submissions while a request is pending.
Verification follows the agreed Chrome large, medium and mobile scope.

## Read first

Read [the shared completion rules](README.md#completion-rules), root AGENTS.md and [handover section 7.1](../../../docs/frontend-handover.md).
Read the matching flow in docs/system-design.md and the existing route handler, service and types before changing a screen.
Verify payloads against the code instead of copying an old plan.

## One-session scope

Extend seller order detail with line selection, courier, tracking number and optional HTTPS link. Use shipment creation and delivered endpoints. Confirm delivery and refresh server values.

## Acceptance

Split an order into two parcels; reject stale or cancelled lines with the server's 409 message; marking COD delivered updates payment state; repeat actions do not duplicate shipments.
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

## Completion evidence, 24 November 2026

Implemented locally on `frontend/step-3-seller-dispatch`, based on `8c78847`.
The implementation and this evidence are committed together on this branch; no deployment is included.
The root `frontend-handover.md` and `remarks2.md` remain untouched.

### Implementation

`apps/web/src/components/seller/dispatch-manager.tsx` adds selection of confirmed order lines, courier name, tracking number and an optional HTTPS link.
Selected whole lines form one parcel; remaining lines can be dispatched separately.
Submission is locked while saving and refreshing to prevent repeat clicks.
Server errors and validation issues remain visible after refreshing, including stale-line conflicts.
Each distinct shipment has one delivery confirmation dialog, with a cash-on-delivery explanation.
Delivered parcels no longer offer the action.
The order page passes only the seller's returned lines to these controls and refreshes server values after each request.
No backend contracts, migrations or payment calculations changed.
The seller response exposes the payment method, not a payment-state field; the UI does not invent a payment status.

The shared primary button now uses dark text on its light green background in dark mode, fixing the contrast failure observed in the new form.
The tracked frontend handover describes the completed dispatch and delivery controls.

### Verification

Used Chrome at 1440 x 900, 768 x 1024 and 390 x 844, under the agreed focused testing policy.
The real local journey dispatched an order in two seller parcels through the new form, confirmed both deliveries and checked that the buyer's cash-on-delivery payment state became `paid`.
A repeat dispatch returned 409 rather than creating another parcel.
The existing core fulfilment tests also passed, covering already-dispatched and cancelled lines, ownership, invalid tracking details, last-parcel cash collection and repeated delivery.
Browser coverage remains focused rather than testing every combination of line selections and failures.
Accessibility, light/dark mode and horizontal-overflow checks passed; screenshots of the desktop dark form and mobile light form were inspected.

```powershell
$env:E2E_CHROME = '1'
pnpm test:e2e -- --project=chrome-desktop --project=chrome-medium --project=chrome-phone seller-orders.spec.ts
```

Exit 0: `3 passed (1.9m)`.
The environment override was scoped to the command shell.
Evidence is in `apps/web/.e2e/runs/a0e18496dd2d/`.
Its disposable database and bucket were cleaned successfully.
AI was disabled and no real payment provider was used.

```text
pnpm check
All matched files use Prettier code style!
Lint: exit 0
Typecheck: core, web and worker Done
Core: 75 files passed; 996 tests passed
Web: 51 files passed; 264 tests passed
Worker: 1 file passed; 11 tests passed
Build: Compiled successfully in 9.4s
Generating static pages (89/89)
```

Exit 0.
`git diff --check` passed.

### Findings resolved during verification

Fixed the new component's lint and formatting findings.
Corrected a required-field test selector and allowed theme transitions to settle before checking contrast.
An HTML 404 from the shipment URL came from a test server that had not compiled the existing route.
Moving the generated `.next-e2e` cache into `.e2e/backups/task02-stale-next-cache` and starting fresh restored the route without a backend change.
The fresh-cache desktop run passed, followed by the final passing three-size run.
No known failing check remains within the agreed scope.
