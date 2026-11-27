# 05: Buyer return request and photos

Status: complete.
Depends on: None.

## Read first

Read [the shared completion rules](README.md#completion-rules), root AGENTS.md and [handover section 7.3](../../../docs/frontend-handover.md).
Read the matching flow in docs/system-design.md and the existing route handler, service and types before changing a screen.
Verify payloads against the code instead of copying an old plan.

## One-session scope

Add a return form to delivered buyer order lines. Include quantity, supported reasons and optional photos using signed uploads, registration and polling before submitting the return.

## Acceptance

Other requires text; processing/failed photos cannot be submitted; over-quantity and expired-window errors come from the server; retries preserve the form and polling stops on unmount.
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

Implemented on `frontend/step-3-buyer-return-request`, based on task 04 commit `a8c8a34`.
Delivered buyer order lines now offer a return form with quantity, supported reasons, required text for Other and up to five optional photos.
Blank quantity uses the existing server default: everything still returnable.
The server remains responsible for remaining quantity, ownership and return-window checks.
Failures display the server message and preserve the form for correction.
Photos use signed direct uploads, registration and status polling; processing and failed attachments block submission.
Failed photos can be removed and replaced.
Closing the form preserves its values and stops polling; unmount aborts polling and an active upload.
No backend contract or migration changed.

### Browser verification

```powershell
$env:E2E_CHROME = '1'
pnpm test:e2e --project=chrome-desktop --project=chrome-medium --project=chrome-phone --grep=AO01
```

Exit 0: `3 passed (2.5m)`.
Chrome sizes: 1440 x 900, 768 x 1024 and 390 x 844.
Evidence: `apps/web/.e2e/runs/700447dec95d/`.
The disposable database and bucket were cleaned.
The real journey checked required Other details, server rejection of excess quantity with preserved text, direct photo upload and worker processing, then successful submission using the keyboard.
Light/dark accessibility and horizontal-overflow checks passed.
Reviewed the mobile light screenshot; corrected the existing collected-cash payment and total labels it exposed.
Processing and failed photos are blocked by the form; expired-window and ownership decisions remain covered by the existing service tests.
These cases were not each repeated through the browser, under the agreed focused testing scope.
Polling uses an abort signal and cancels its timer on close or unmount.
No live provider was called.

### Repository verification

```text
pnpm check
All matched files use Prettier code style!
Lint: exit 0
Typecheck: core, web and worker Done
Core: 75 files passed; 996 tests passed
Web: 51 files passed; 264 tests passed
Worker: 1 file passed; 11 tests passed
Build: Compiled successfully in 10.8s
Generating static pages (91/91)
```

Exit 0.
The production build includes the final collected-cash label correction made after screenshot review.
`git diff --check` passed.
Fetched origin and confirmed its main branch is already included.
The unrelated root frontend-handover.md and remarks2.md remain untouched.
