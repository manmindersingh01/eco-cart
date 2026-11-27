# 22: Background work tools

Status: complete.
Depends on: None.

## Read first

Read [the shared completion rules](README.md#completion-rules), root AGENTS.md and [handover section 7.10](../../../docs/frontend-handover.md).
Read the matching flow in docs/system-design.md and the existing route handler, service and types before changing a screen.
Verify payloads against the code instead of copying an old plan.

## One-session scope

Build /admin/background-work with queue counts, failed jobs, failed/stuck email lists and existing retry actions.

## Acceptance

Confirm each retry; refresh after action; empty and unavailable states work; no secrets or OTP contents are exposed.
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

## Implementation - 27 November 2026

Built with task 25 on `frontend/step-3-background-work-similar-products`, starting from tasks 20/21 documentation commit `426cd3b`.
Implementation commit: `decaf79` (`Add background work tools and similar product suggestions`).
Added `/admin/background-work` and its administrator navigation link.
The screen uses existing services for queue counts, failed jobs and failed/stuck emails.
Queue counts are in a collapsible panel so long queue lists do not push the work controls off the mobile screen.
Counts and work lists load independently behind loading boundaries and remain uncached.
The job queue selector and email-state filter reset cursors; newest/older navigation keeps the active filter and uses the existing cursor services.
Times display in India time.
Each retry has a keyboard-accessible confirmation dialog and calls the existing retry route, then refreshes the list.
Sign-in code emails and SMS jobs have an explanation instead of a retry button; email jobs direct administrators to the email list.
Pending retries have a synchronous duplicate-submit lock.
An uncertain result blocks another retry and offers a full reload to check the current state.
Only safe metadata is rendered: subjects, message contents, job payloads and raw error text are omitted, including from server-rendered component props.
Malformed filters and cursors, empty lists and unavailable services have recovery states without exposing internal errors.
No backend contract, schema or migration changed.

## Verification approach

The Chrome journey uses the real local services and disposable resources.
Fixtures include failed pg-boss jobs, failed/stuck emails and expired-code examples; the worker retries an ordinary email through Mailpit and handles the retried embedding job with AI disabled.
Browser error-state coverage injects an unconfirmed retry response and checks that a repeat is blocked until reload.
Separate component tests cover queue startup failure without exposing its error and ensure access-check failures are not swallowed.
The first browser run `6cefb8dc1d1e` exited 1 because the cursor assertion read the previous page before navigation finished.
The assertion now waits for the next cursor and compares the visible rows with the real API's next page before checking duplicates.
Run `e5e72a750def` exercised real retries and privacy checks at all sizes, then stopped because a broad error-notice selector also matched Next.js's route announcer.
The selector now targets the intended notice.

## Browser results

Chrome sizes: 1440 x 900, 768 x 1024 and 390 x 844.

```powershell
$env:E2E_CHROME = '1'
pnpm test:e2e --project=chrome-desktop --project=chrome-medium --project=chrome-phone background-similar.spec.ts
```

Final run `8bde03289019`: exit 0, `3 passed (2.4m)`.
The final run's disposable database and bucket were cleaned successfully.
The journey compared queue names and cursor rows with the real APIs and checked no repeated job rows across pages.
Confirmed retries removed a failed job, a failed email and a stuck email from their current lists after refresh.
An injected 503 response kept the error generic and disabled another retry until a full reload; the next real retry succeeded.
Expired-code emails and SMS jobs had no retry button.
Private sentinel strings in subjects, payloads and errors were absent from the rendered HTML.
Buyer and seller reads, retry writes and page access were refused.
Keyboard dialog cancellation restored focus, and light/dark accessibility and horizontal-overflow checks passed at all three sizes.
Reviewed the recommendation cards and work-list screenshots, including the mobile dark view.

## Repository checks

Ran `pnpm check` after the browser launcher exited: exit 0.
Formatting, lint and typecheck passed.

```text
packages/core: Test Files 75 passed (75); Tests 996 passed (996)
apps/web: Test Files 55 passed (55); Tests 276 passed (276)
apps/worker: Test Files 1 passed (1); Tests 11 passed (11)
```

All 1,283 tests passed, including the queue-unavailable and permission-guard component checks.
Build output: `Compiled successfully in 14.2s` and `Generating static pages ... (108/108)`.
The route table includes `/admin/background-work`.
The fetched `origin/main` at `10fbc5f` is an ancestor of this branch.
No required local checks remain deferred.
The browser checks retry acceptance and refreshed list state; it does not establish delivery through a production email/SMS provider.
