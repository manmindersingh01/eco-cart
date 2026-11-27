# 06: Buyer return tracking

Status: complete.
Depends on: 05.

## Read first

Read [the shared completion rules](README.md#completion-rules), root AGENTS.md and [handover section 7.3](../../../docs/frontend-handover.md).
Read the matching flow in docs/system-design.md and the existing route handler, service and types before changing a screen.
Verify payloads against the code instead of copying an old plan.

## One-session scope

Build /account/returns and /account/returns/[id], add account navigation and show status, notes and private photos.

## Acceptance

A different buyer cannot see the return; cursor navigation works; requested, approved, rejected and refunded states use plain wording.
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

Implemented on `frontend/step-3-buyer-returns`, based on task 05 commit `77db665`.
Added the private buyer return list and detail pages, with account navigation and links from returned order lines.
The list uses existing service cursor pagination and shows the requested date, item, order number, quantity and status.
The detail page shows the reason, decision note and date, recorded refund amount and method, and protected links to attached photos.
Requested means "Awaiting review", rejected means "Not approved", and refunded means "Refund recorded".
Approval wording says a refund has not yet been recorded.
Back to returns preserves the originating cursor; a refresh button reads the latest decision.
Signed-out users must sign in, and another buyer receives the same missing-return page as an unknown ID.
Photo links pass through the existing authorised route and do not retain signed storage URLs.
No backend contract or migration changed.

### Browser verification

```powershell
$env:E2E_CHROME = '1'
pnpm test:e2e --project=chrome-desktop --project=chrome-medium --project=chrome-phone admin-orders.spec.ts
```

Exit 0: `9 passed (6.1m)`.
Chrome sizes: 1440 x 900, 768 x 1024 and 390 x 844.
Evidence: `apps/web/.e2e/runs/4ef16d8297a1/`.
The disposable database and bucket were cleaned.
BR01 checks signed-out access, an empty account, 21-row pagination, cursor-preserving Back links and invalid cursor/ID handling.
AO01 follows a real photo-backed request into tracking, reads an approval note, records a bank refund through the existing service and verifies the updated refund state.
Another buyer receives the missing-return page and cannot download the photo.
Requested, approved and refunded states were exercised in the browser; rejection uses the shared plain-language mapping and existing service coverage, without an additional browser scenario.
Light/dark accessibility and overflow checks passed, and desktop light and mobile dark screenshots were inspected.
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
Build: Compiled successfully in 13.6s
Generating static pages (93/93)
```

Exit 0.
`git diff --check` passed.
Fetched origin and confirmed its main branch is already included.
The unrelated root frontend-handover.md and remarks2.md remain untouched.

### Findings during verification

Fixed a typed Back-link error by passing the pathname and cursor as a structured URL.
The first browser run read the return ID before the detail navigation completed, then requested `/returns/returns/approve` and received 404.
Added an explicit wait for the return detail URL before reading its ID.
Stopped that run, verified its owned processes had ended, and cleaned its disposable resources before restarting.
