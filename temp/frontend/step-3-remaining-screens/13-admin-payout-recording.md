# 13: Payouts and adjustments

Status: complete.
Depends on: 12.

## Read first

Read [the shared completion rules](README.md#completion-rules), root AGENTS.md and [handover section 7.5](../../../docs/frontend-handover.md).
Read the matching flow in docs/system-design.md and the existing route handler, service and types before changing a screen.
Verify payloads against the code instead of copying an old plan.

## One-session scope

Add recording external bank transfers and signed adjustments to seller detail with amount, reference or required reason and confirmation.

## Acceptance

Confirmation shows amount and masked account; labels never imply initiating a transfer; entries cannot be edited or deleted; server rejection preserves useful form values.
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

Batched with task 14 on `frontend/step-3-admin-payouts-statements`, based on task 12 documentation commit `86461ef`.
Implementation commit: `192a7b4`.
Seller detail now records completed external payouts and balance adjustments through the existing administrator routes.
Rupee amounts use the existing exact integer-paise parser.
Adjustment direction is explicit: increase or reduce, with the signed amount and required reason in the confirmation.
Payout confirmation shows the amount, bank account's last four digits, IFSC and transfer reference.
Labels explain that this records a transfer already made outside EcoKart and does not send money.
Missing bank details and non-positive balances disable payout entry.
The server remains responsible for the current balance and duplicate transfer references.
Server rejections preserve useful inputs, while success clears them and refreshes the balance and ledger.
An uncertain response blocks another write from that form until the administrator reloads and checks history.
Entries have no edit or delete controls.
No backend contract or migration changed.

## Browser verification

Chrome sizes: 1440 x 900, 768 x 1024 and 390 x 844.

```powershell
$env:E2E_CHROME = '1'
pnpm test:e2e --project=chrome-desktop --project=chrome-medium --project=chrome-phone admin-ledger-actions.spec.ts admin-statements.spec.ts
```

Run `6363fe4a0e28`: exit 0, `6 passed (3.3m)` across the two tasks.
The payout journey also passed at all three sizes in the preceding run; that run exited 1 because of the statement test synchronisation issue recorded in task 14.
The journey creates its own seller through the real API, checks missing-bank protection and exact paise conversion, then records a completed payout and both directions of adjustment.
Over-balance and duplicate-reference rejections preserve amount and reference.
Confirmation shows the amount, masked bank details and completed-transfer wording.
A deliberately lost response after a committed adjustment leaves exactly one entry and blocks immediate resubmission until reload.
The ledger and full balance refresh, entries have no mutation controls, and seller accounts cannot call the administrator write routes.
Keyboard confirmation and focus restoration, light/dark accessibility and horizontal-overflow checks passed at all three sizes.
Reviewed desktop payout and adjustment screenshots and mobile dark adjustment screenshots.
Tests use disposable resources and fake bank details; no money is transferred.

After changing server field names to plain-language labels in write errors, reran the payout journey with the existing bank and seller-document regressions:

```powershell
pnpm test:e2e --project=chrome-desktop admin-ledger-actions.spec.ts admin-seller-money.spec.ts seller-documents.spec.ts
```

Run `f7de514a18af`: exit 0, `3 passed (2.3m)`.
The original bank entry/replacement journey and the seller statement/invoice journey remain green.
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
The first gate stopped on an unnecessary type assertion in the new CSV download test; removing that assertion fixed lint without changing runtime behaviour.
`git diff --check` passed.
Fetched origin and verified `origin/main` at `10fbc5f` is included, so no integration conflict remained.
No required task 13 checks are deferred.
The unrelated root frontend-handover.md and remarks2.md remain untouched.
