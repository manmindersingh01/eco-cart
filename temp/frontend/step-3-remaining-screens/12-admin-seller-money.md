# 12: Administrator balances, bank details and ledger

Status: complete.
Depends on: None.

## Read first

Read [the shared completion rules](README.md#completion-rules), root AGENTS.md and [handover section 7.5](../../../docs/frontend-handover.md).
Read the matching flow in docs/system-design.md and the existing route handler, service and types before changing a screen.
Verify payloads against the code instead of copying an old plan.

## One-session scope

Build /admin/payouts and extend seller detail with ledger and bank-account entry/replacement. Show only the returned last four digits.

## Acceptance

Bank forms start empty and clear sensitive input after success; missing bank account is clear; balances paginate and sort using the API.
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

Branch: `frontend/step-3-admin-seller-money`, based on task 11 commit `15d204c`.
Implementation commit: `24065f9`.
Added `/admin/payouts` and the Payouts menu link.
The list uses the existing balance service, including its largest-first order, non-zero filter and cursor pagination.
Seller detail now includes the full signed balance, masked bank summary, bank entry/replacement and newest-first ledger pages.
Balance and ledger cursors stay separate, with a link back to the originating balance page.
Bank forms start empty, hide the number during entry and confirm only its last four digits.
Successful saves clear all fields, while unsuccessful attempts also clear the number.
The existing API validates and seals the number, returns only its last four digits and records the audit entry.
No backend contract or migration changed.
Payout recording, adjustments and administrator statements remain in tasks 13 and 14.

## Browser verification

Chrome sizes: 1440 x 900, 768 x 1024 and 390 x 844.

```powershell
$env:E2E_CHROME = '1'
pnpm test:e2e --project=chrome-desktop --project=chrome-medium --project=chrome-phone admin-seller-money.spec.ts
```

Run `9bead651dfd5`: exit 0, `3 passed (2.3m)`.
The preceding run `5f7e07bf15a6` exited 1 because the test used an exact label-text selector that did not match the required-field marker.
The form was present; corrected selectors use the accessible textbox name and the password field's labelled ID.
Both runs cleaned their disposable databases and buckets.
The passing journey compares each balance page's seller order against the real API, checks positive and negative balances and verifies no repeated sellers across the cursor boundary.
It saves and replaces a bank account, verifies the missing-account message, confirmation masking, server validation errors and empty fields after success and reload.
The number is also cleared after a failed save attempt.
Responses and rendered page content never contain the full saved account number.
Buyer and seller accounts are refused access, including bank writes; the seller can read the updated last four digits through their own API.
Ledger pages keep the full signed balance and use the server's newest-first cursor without repeating entries.
Malformed balance and ledger cursors show recovery links.
Keyboard confirmation and focus restoration, light/dark accessibility and horizontal-overflow checks passed at all three sizes.
Reviewed desktop dark, medium light and mobile light seller-money screenshots.
Tests used real local services, sealed fake bank details and existing protected HTTP routes.
No provider credentials or external transfers were needed.

## Repository verification

```text
pnpm check
All matched files use Prettier code style!
Lint: exit 0
Typecheck: core, web and worker Done
Core: 75 files passed; 996 tests passed
Web: 51 files passed; 264 tests passed
Worker: 1 file passed; 11 tests passed
Build: Compiled successfully in 13.1s
Generating static pages (100/100)
```

Exit 0.
`git diff --check` passed.
Fetched origin and verified `origin/main` at `10fbc5f` is an ancestor of this branch, so no integration conflict remained.
No required task 12 checks are deferred.
The unrelated root frontend-handover.md and remarks2.md remain untouched.
