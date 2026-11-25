# 09: Administrator return refunds

Status: complete.
Depends on: 08.

## Read first

Read [the shared completion rules](README.md#completion-rules), root AGENTS.md and [handover section 7.3](../../../docs/frontend-handover.md).
Read the matching flow in docs/system-design.md and the existing route handler, service and types before changing a screen.
Verify payloads against the code instead of copying an old plan.

## One-session scope

Add recording an already-made gateway or bank-transfer refund after approval. Respect maxRefundPaise and show server results after recording.

## Acceptance

Reject excessive amounts; show the right reference fields for each payment method; refresh return and money state; clearly state that EcoKart records the external transfer.
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

Implemented on `frontend/step-3-admin-return-refunds`, based on task 08 commit `c54b832`.
Added refund recording to the administrator return detail page, available only after approval and before a refund is recorded.
The page reads the payment method through the existing administrator order service because ReturnView does not include it.
Cash-on-delivery orders use a bank reference; online orders default to a Razorpay refund ID and also support bank transfer as allowed by the existing service.
Amounts reuse the exact decimal-to-paise parser and must be positive and no greater than maxRefundPaise.
The form and confirmation state that the transfer must already have been made outside EcoKart and that this action moves no money.
A smaller recorded amount also completes the return, so the form explains that before confirmation.
Failure preserves entered values and refreshes the server view; saving and refresh disable duplicate submission.
Success refreshes the return and order reads, displays the server's refund amount, method and date, and removes the recording action.
No backend contract or migration changed.

### Browser verification

```powershell
$env:E2E_CHROME = '1'
pnpm test:e2e --project=chrome-desktop --project=chrome-medium --project=chrome-phone return-refunds.spec.ts
```

Exit 0: `3 passed (2.4m)`.
Chrome sizes: 1440 x 900, 768 x 1024 and 390 x 844.
Evidence: `apps/web/.e2e/runs/923abf5ab9c3/`.
The disposable database and bucket were cleaned.
The focused journey checks buyer refusal, positive exact paise, malformed precision, excess amounts blocked in the form and rejected by the server, method-specific fields and confirmation wording.
It records both a Razorpay refund and a cash-on-delivery bank transfer through the real API, and checks the resulting amount and method on the refreshed page.
A stale second tab receives 409 and loses the recording control after refresh.
A controlled 503 preserves the bank reference for a successful retry.
The seller ledger contains refund and commission reversals for both returns, including the exact -12345 paise refund entries.
Keyboard access, light/dark accessibility and horizontal-overflow checks passed.
Reviewed desktop dark confirmation and mobile light bank-transfer screenshots.
The approved fixtures use frozen test orders followed by the existing payment confirmation, dispatch, delivery, return and approval services.
No live provider payment or bank transfer was performed; this screen only records an external transfer.

### Repository verification

```text
pnpm check
All matched files use Prettier code style!
Lint: exit 0
Typecheck: core, web and worker Done
Core: 75 files passed; 996 tests passed
Web: 51 files passed; 264 tests passed
Worker: 1 file passed; 11 tests passed
Build: Compiled successfully in 9.2s
Generating static pages (97/97)
```

Exit 0.
`git diff --check` passed.
Fetched origin and confirmed its main branch is already included.
The unrelated root frontend-handover.md and remarks2.md remain untouched.

### Findings during verification

The first desktop attempt timed out during OTP sign-in before reaching the refund form.
The new refund fixtures had queued commerce emails ahead of the real OTP; the first OTP was delivered about 100 seconds after creation.
The refund fixtures now keep their outbox records but skip scheduling their setup-only commerce emails, while still running the real payment, delivery and return services.
Browser sign-in and refund requests continue to use the real worker and Mailpit, and the normal OTP timeout is unchanged.
The same first run's medium and mobile refund journeys passed.
Fixed two unnecessary type assertions in the fixture setup before final checks.
