# 04: Administrator order actions

Status: complete.
Depends on: 03.

## Read first

Read [the shared completion rules](README.md#completion-rules), root AGENTS.md and [handover section 7.2](../../../docs/frontend-handover.md).
Read the matching flow in docs/system-design.md and the existing route handler, service and types before changing a screen.
Verify payloads against the code instead of copying an old plan.

## One-session scope

Add cancellation with a reason, recording an already-made refund, marking a parcel delivered and re-rendering invoice PDFs. Use existing endpoints and confirm consequential actions.

## Acceptance

Refund wording explicitly says no money is moved; paise conversion is exact; stale actions refresh; invoice rendering shows pending and failure states.
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

Delivered on `frontend/step-3-admin-order-actions`, based on task 03 commit `89d6059`.
Task 03 was pushed with its upstream branch set before this task started.

The order detail now has confirmed cancellation with a required reason, recording an already-made Razorpay refund, confirmed parcel delivery and confirmed invoice PDF regeneration.
Refund amounts reuse the exact decimal-to-paise parser and all mutations use existing endpoints.
Every request refreshes the server view, including conflicts and uncertain failures.
Duplicate submissions are disabled while saving and refreshing.

The invoice contract exposes PDF availability and accepts regeneration with HTTP 202.
It does not expose the completion or failure of that specific render job.
The screen therefore shows request pending, request failure and generation queued states, and explains that an existing download may still be the previous PDF.
It never treats queue acceptance or an old download as proof that a new PDF has finished.
Detailed background job management remains task 22; no backend contract was added.

Focused browser checks cover the four actions, stale cancellation, exact paise and important errors at the agreed three Chrome sizes.

### Browser verification

```powershell
$env:E2E_CHROME = '1'
pnpm test:e2e --project=chrome-desktop --project=chrome-medium --project=chrome-phone admin-orders.spec.ts
```

Exit 0: `6 passed (3.2m)`.
Chrome sizes were 1440 x 900, 768 x 1024 and 390 x 844.
Evidence is in `apps/web/.e2e/runs/d7a621349af9/`; its database and bucket were cleaned successfully.
Reviewed the dark cancellation dialog and the desktop and mobile refund screenshots.
Keyboard access, light/dark accessibility and horizontal-overflow checks passed.

The browser journey confirmed a real cash-on-delivery parcel through the administrator action and observed cash collected.
The refund journey used a seeded captured payment through the existing confirmation service, then real browser cancellation and refund endpoints.
It checked required reasons, the confirmation warning, a stale second tab returning 409 and refreshing its controls, rejection of a partial amount, and an exact `12345` paise request for `123.45` rupees.
Refund completion removed the action and added the event to order history.
The invoice request test showed a controlled 503 failure, then a real 202 acceptance and queued message.
Live provider payment and refund execution were not exercised; this screen only records an external refund.

### Repository verification

```text
pnpm check
All matched files use Prettier code style!
Lint: exit 0
Typecheck: core, web and worker Done
Core: 75 files passed; 996 tests passed
Web: 51 files passed; 264 tests passed
Worker: 1 file passed; 11 tests passed
Build: Compiled successfully in 10.6s
Generating static pages (91/91)
```

Exit 0.
`git diff --check` passed.
Fetched origin and confirmed `origin/main` at `10fbc5f` is already an ancestor of this branch.
No backend contracts or migrations changed.
The unrelated root frontend-handover.md and remarks2.md remain untouched.

### Findings resolved during verification

Started Docker Desktop and ran `pnpm db:up` because local services were stopped at the initial test attempt.
Cleaned the failed setup's disposable resources with the existing harness helper.
The desktop cancellation dialog exposed insufficient contrast on the shared danger button in dark mode (2.14:1).
Adjusted its dark-mode text colour to meet the accessibility check without changing the light theme.
Changed the administrator payment badge from the buyer wording "Refund on its way" to "Refund due", and used visible field names in refund validation messages.
