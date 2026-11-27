# 27: Seller listing suggestions

Status: complete.
Depends on: None.

## Read first

Read [the shared completion rules](README.md#completion-rules), root AGENTS.md and [handover section 7.11](../../../docs/frontend-handover.md).
Read the matching flow in docs/system-design.md and the existing route handler, service and types before changing a screen.
Verify payloads against the code instead of copying an old plan.

## One-session scope

Add draft requests and polling to the product editor with a ready photo. Preview each field and apply only seller-selected values through ordinary edits.

## Acceptance

AI off and failed drafts leave manual editing usable; unsaved changes are preserved; suggestions never publish or silently change fields.
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

Built with task 28 on `frontend/step-3-seller-ai-suggestions`, starting from tasks 23/24 documentation commit `43120a6`.
Implementation commit: `c528950` (`Add seller listing and import mapping suggestions`).
The existing editable seller product screen now offers AI listing suggestions after a product photo is ready.
Requests and bounded status polling use the existing listing-draft endpoints.
Pending, failed, unavailable and rate-limited requests leave the manual form usable.
Polling stops at a terminal status, pauses on an error or after its attempt budget, and aborts when the page is hidden.
Each of title, description, highlights and attributes is previewed beside the current unsaved form value as plain text.
All field choices start unchecked.
Copying selected suggestions uses the latest form values, replaces only those selected fields and does not send a product write.
The seller must still use Save listing details, which follows the existing PATCH flow and never publishes a listing.
Other unsaved fields, category, brand, HSN and options remain intact.
No backend API, schema, migration or provider behaviour changed.

## Verification approach

The browser journey creates a real draft product, uploads a photo directly to local storage and waits for the real worker's ready image.
It exercises the real AI-disabled listing endpoint, then uses controlled queued/running/succeeded/failed draft responses for UI state checks.
Selected suggestions are saved through the real product API and reloaded; the product stays a draft.
Core fake-provider tests separately cover the listing builder and ownership rules.
Live provider success still needs AI credentials and suitable product photos; it is not claimed by the controlled browser responses.

The first browser run `cba54c766649` exited 1 because the test photo was only 400 pixels across, below the worker's 600-pixel minimum.
The photo never became ready, and the suggestion button correctly remained disabled.
The test now uploads an 800-pixel photo, matching the existing upload requirements.

## Browser evidence

Ran Chrome at 1440 x 900, 768 x 1024 and 390 x 844:

```powershell
$env:E2E_CHROME = '1'
pnpm test:e2e --project=chrome-desktop --project=chrome-medium --project=chrome-phone seller-suggestions.spec.ts
```

Run `bf6ec145e575`: exit 0, `3 passed (2.6m)`.
Its disposable database and bucket were cleaned successfully.
The corrected desktop-only run `02d3eeed3f17` also passed (`1 passed (1.3m)`).
The request control remained disabled without a ready image, then became available after a real 800-pixel upload was processed.
The real AI-disabled request left the manually entered title and description unchanged.
Controlled asynchronous results preserved an edit made while polling and rendered script-like suggestion text without a script element.
All choices started unchecked; copying description and attributes left the unsaved title intact and did not write to the server.
An explicit real PATCH saved the chosen fields and manual title; reload confirmed them and the product remained a draft.
A controlled failed draft did not expose its private error or disable manual editing.
Keyboard copy/confirmation, light/dark accessibility and horizontal-overflow checks passed across all three sizes.
Reviewed the listing comparison and mobile import screenshots.

## Repository checks

Ran `pnpm check` after the browser launcher exited: exit 0.
Formatting, lint and typecheck passed.

```text
packages/core: Test Files 75 passed (75); Tests 996 passed (996)
apps/web: Test Files 57 passed (57); Tests 285 passed (285)
apps/worker: Test Files 1 passed (1); Tests 11 passed (11)
```

All 1,292 tests passed, including three new helper tests for selected-field copying, collection isolation and import polling conditions.
Build output: `Compiled successfully in 9.4s` and `Generating static pages ... (108/108)`.
The fetched `origin/main` at `10fbc5f` is an ancestor of this branch.
No required local checks remain deferred; real-provider listing suggestions remain a separate release check.
