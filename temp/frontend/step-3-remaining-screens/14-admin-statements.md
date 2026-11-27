# 14: Administrator settlement statements

Status: complete.
Depends on: 12.

## Read first

Read [the shared completion rules](README.md#completion-rules), root AGENTS.md and [handover section 7.5](../../../docs/frontend-handover.md).
Read the matching flow in docs/system-design.md and the existing route handler, service and types before changing a screen.
Verify payloads against the code instead of copying an old plan.

## One-session scope

Add statement history, date range request, status polling and private downloads to seller detail using administrator context.

## Acceptance

Pending, ready and failed states work; invalid date ranges are shown; private links do not persist signed URLs.
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

## Implementation - 26 November 2026

Batched with task 13 on `frontend/step-3-admin-payouts-statements`, based on task 12 documentation commit `86461ef`.
Implementation commit: `192a7b4`.
Seller detail now includes statement requests, cursor-paginated history, worker status polling and private CSV downloads.
The existing request and status components are shared with seller earnings and retain seller access by default.
Administrator requests use the seller-specific administrator endpoint; status and file reads omit `?as=seller`.
Statement, ledger and originating balance cursors stay separate.
Requests use the existing date validation and preserve dates after rejection.
Processing, ready, failed, empty, unavailable status and unavailable file states are shown.
Polling stops after completion or navigation; failed reads have a retry control.
The shared download control keeps the signed storage link out of client state and page markup.
No backend contract or migration changed.

## Browser verification

Chrome sizes: 1440 x 900, 768 x 1024 and 390 x 844.

```powershell
$env:E2E_CHROME = '1'
pnpm test:e2e --project=chrome-desktop --project=chrome-medium --project=chrome-phone admin-ledger-actions.spec.ts admin-statements.spec.ts
```

Run `6363fe4a0e28`: exit 0, `6 passed (3.3m)` across the two tasks.
The initial run `aeea20000a22` exited 1 with three payout journeys passing and three statement journeys failing at an immediate URL assertion.
The assertion now waits for navigation to remove the ledger cursor while retaining the statement cursor; the complete journeys then passed.
Checks cover empty, processing and failed history, a status-read failure and retry, and cancellation of polling after client navigation.
A cursor supplied by the real list API exercises an older statement page independently of the ledger cursor.
An invalid date range preserves both dates and shows a plain-language error.
A new request from that older history page remains visible and polls using administrator access.
The actual worker prepares the private CSV, including the negative closing balance, and the browser downloads and reads it.
File-read errors have a visible recovery message, redirects are not cached and page markup retains only the protected route rather than a signed storage URL.
Another seller cannot use the administrator list/request routes or read the statement status or file.
Malformed statement cursors show a recovery link.
Keyboard access, light/dark accessibility and horizontal-overflow checks passed at all three sizes.
Reviewed desktop and medium light and mobile dark statement screenshots.
Processing and failed examples are seeded states; successful CSV creation uses the actual worker and private local storage.

Also ran the existing seller statement and invoice journey on desktop to check the shared components' default seller access, alongside the payout and bank regressions:

```powershell
pnpm test:e2e --project=chrome-desktop admin-ledger-actions.spec.ts admin-seller-money.spec.ts seller-documents.spec.ts
```

Run `f7de514a18af`: exit 0, `3 passed (2.3m)`.
The seller can still request and poll a statement, download its private CSV and invoice PDF, and refuse another seller's access.
All browser runs cleaned their disposable databases and buckets.

## Repository verification

```text
pnpm check
All matched files use Prettier code style!
Lint: exit 0
Typecheck: core, web and worker Done
Core: 75 files passed; 996 tests passed
Web: 51 files passed; 264 tests passed
Worker: 1 file passed; 11 tests passed
Build: Compiled successfully in 11.5s
Generating static pages (100/100)
```

Final exit 0.
The first gate stopped on an unnecessary type assertion in the CSV download test; it was removed and the entire gate passed.
`git diff --check` passed.
Fetched origin and verified `origin/main` at `10fbc5f` is included, so no integration conflict remained.
No required task 14 checks are deferred.
No live provider credentials were needed for these private local files.
The unrelated root frontend-handover.md and remarks2.md remain untouched.
