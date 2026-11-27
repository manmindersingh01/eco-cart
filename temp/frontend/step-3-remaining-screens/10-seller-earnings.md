# 10: Seller earnings and bank summary

Status: complete.
Depends on: None.

## Read first

Read [the shared completion rules](README.md#completion-rules), root AGENTS.md and [handover section 7.4](../../../docs/frontend-handover.md).
Read the matching flow in docs/system-design.md and the existing route handler, service and types before changing a screen.
Verify payloads against the code instead of copying an old plan.

## One-session scope

Build /seller/earnings with ledger pagination, signed balances and masked bank details. Add the menu entry.

## Acceptance

Negative balances stay negative; money uses Indian grouping; full account numbers never appear; sellers cannot edit the bank account.
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

## Implementation evidence - 26 November 2026

Implemented on `frontend/step-3-seller-earnings`, based on task 09 commit `6534d91`.
Added `/seller/earnings` and the seller menu entry.
The screen reads the current balance, cursor-paginated ledger and masked bank summary through the existing seller services.
Balances retain their sign and use Indian rupee grouping, with plain wording for positive, zero and negative balances.
Ledger entries show signed amounts, type, date, description and transfer reference, with links to an order or return when present.
The balance is the server total across all entries, not a browser sum of the current page.
Bank details show only holder, IFSC, last four digits and last-updated time; there are no seller editing controls.
Empty history, missing bank details, invalid cursors, loading and refresh states are included.
Seller context is required even for accounts that also buy.
Statements and invoice lists remain task 11.
No backend contract or migration changed.

### Browser verification

```powershell
$env:E2E_CHROME = '1'
pnpm test:e2e --project=chrome-desktop --project=chrome-medium --project=chrome-phone seller-earnings.spec.ts
```

Exit 0: `3 passed (2.3m)`.
Chrome sizes: 1440 x 900, 768 x 1024 and 390 x 844.
Evidence: `apps/web/.e2e/runs/1886a97bfb77/`.
The disposable database and bucket were cleaned.
The journey checks signed-out redirects, buyer refusal, a dual-role seller, a negative balance of -₹12,34,567.89, positive and zero balances, cursor pages and unchanged all-entry totals while paging.
Only the account holder, IFSC and last four digits are shown; the full test account number is absent from the page and bank API response.
There are no bank editing controls, and PUT on the seller bank endpoint returns 405.
Another seller sees their own empty history and missing bank state.
A real administrator adjustment becomes visible after keyboard refresh, and invalid cursors have a recovery link.
Light/dark accessibility and overflow checks passed.
No live provider was used.

The first runs hit ECONNRESET on the sign-in helper's read-only identity check after navigation.
The helper now uses Playwright's bounded transport retry for that GET only; HTTP errors and writes are never retried.
The final three-size run passed with that fix.
Reviewed desktop dark and mobile light screenshots.

### Repository verification

```text
pnpm check
All matched files use Prettier code style!
Lint: exit 0
Typecheck: core, web and worker Done
Core: 75 files passed; 996 tests passed
Web: 51 files passed; 264 tests passed
Worker: 1 file passed; 11 tests passed
Build: Compiled successfully in 13.5s
Generating static pages (98/98)
```

Exit 0.
`git diff --check` passed.
The unrelated root frontend-handover.md and remarks2.md remain untouched.
