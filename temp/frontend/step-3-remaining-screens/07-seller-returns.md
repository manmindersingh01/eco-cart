# 07: Seller return visibility

Status: complete.
Depends on: 05.

## Read first

Read [the shared completion rules](README.md#completion-rules), root AGENTS.md and [handover section 7.3](../../../docs/frontend-handover.md).
Read the matching flow in docs/system-design.md and the existing route handler, service and types before changing a screen.
Verify payloads against the code instead of copying an old plan.

## One-session scope

Build /seller/returns with status filters and a read-only detail view using seller return endpoints. Open private photos with ?as=seller.

## Acceptance

Only this seller's returns appear; dual-role accounts use seller context; no approval or refund controls appear.
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

Implemented on `frontend/step-3-seller-returns`, based on task 06 commit `bd6e1d9`.
Added `/seller/returns` and `/seller/returns/[id]` and the seller navigation link.
The list supports all returns or one status, cursor pagination and clear empty/invalid-list states.
Changing the status resets the cursor; detail Back links preserve the originating status and cursor.
The detail shows the buyer, original item, quantity, reason, administrator note, decision date and protected photo links with `?as=seller`.
It links to the seller order and can refresh the latest state.
Both pages require seller context, including for accounts that also buy.
Another seller receives the same missing-return page as an unknown ID.
No approval, rejection or refund recording controls are provided.
Seller return services omit refund records, so the page uses the return status and explains that refund entries appear in the seller ledger.
No backend contracts or migrations changed.

### Browser verification

```powershell
$env:E2E_CHROME = '1'
pnpm test:e2e --project=chrome-desktop --project=chrome-medium --project=chrome-phone --grep=AO01
```

Exit 0: `3 passed (5.0m)`.
Chrome sizes: 1440 x 900, 768 x 1024 and 390 x 844.
Evidence: `apps/web/.e2e/runs/d2caecb8f762/`.
The disposable database and bucket were cleaned.
The journey creates and delivers an order, uploads and processes a real return photo, then opens the buyer's request as the owning dual-role seller.
It compares the seller list IDs with the seller API, checks cursor navigation, Back preservation, filter reset and an empty filtered result.
It verifies private photo access with `?as=seller`, refusal of another seller for both the return and photo, and exclusion from that seller's API list.
No approval, rejection or refund-recording buttons appear.
After the administrator records a refund through the existing API, keyboard refresh shows the refunded state and decision note without a false missing-refund message.
Invalid status and cursor URLs show a recoverable error.
Signed-out users are redirected and a buyer is refused seller access.
Light/dark accessibility and overflow checks passed; desktop dark and mobile light screenshots were inspected.
No live payment provider was called.

### Repository verification

```text
pnpm check
All matched files use Prettier code style!
Lint: exit 0
Typecheck: core, web and worker Done
Core: 75 files passed; 996 tests passed
Web: 51 files passed; 264 tests passed
Worker: 1 file passed; 11 tests passed
Build: Compiled successfully in 15.2s
Generating static pages (95/95)
```

Exit 0.
`git diff --check` passed.
Fetched origin and confirmed its main branch is already included.
Fixed a lint finding in the test's link-reading code before the final repository checks.
The unrelated root frontend-handover.md and remarks2.md remain untouched.
