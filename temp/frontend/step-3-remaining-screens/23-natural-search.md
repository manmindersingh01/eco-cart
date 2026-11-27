# 23: Natural-language search

Status: complete.
Depends on: None; search-page mode layout agreed on 27 November 2026.

## Read first

Read [the shared completion rules](README.md#completion-rules), root AGENTS.md and [handover section 7.11](../../../docs/frontend-handover.md).
Read the matching flow in docs/system-design.md and the existing route handler, service and types before changing a screen.
Verify payloads against the code instead of copying an old plan.

## One-session scope

Add an optional natural-language mode to search using the existing endpoint and understood-query result. Keep keyword search available.

## Acceptance

AI off, timeout, rate limit and keyword fallback are clear; filters and result navigation follow the actual response contract.
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

Built with task 24 on `frontend/step-3-natural-photo-search`, starting from tasks 22/25 documentation commit `c4207e2`.
Implementation commit: `37110c3` (`Add natural language and private photo search modes`).
The user agreed to Keyword, Natural language and Photo options on `/search`, with the header continuing to submit keyword searches.
Natural-language results use the existing `/api/search/natural` endpoint and stay uncached.
The description, supported filters, page size and exact server cursor stay in the address; changing filters starts at the first page.
Prices use the existing exact rupees-to-paise converter.
Results use the existing public product cards.
The understood query is shown as plain text with recognised category, brand and price bounds.
Only best-match ordering is offered because the natural and photo contracts do not accept a sort parameter.
The API's exact/similar match values identify keyword fallback; they do not identify whether AI was off, timed out or reached a limit, so the screen does not invent a cause.
Rate-limit, unavailable-mode and request-timeout messages keep keyword search available.
Aborted or superseded requests cannot replace the current results, including when Next.js retains a hidden page.
No backend API, schema or provider behaviour changed.

## Verification approach

The browser journey exercises real AI-disabled natural search, keyword fallback, exact filter conversion and server cursor pagination against the disposable local app.
Successful meaning responses and a rate-limit response are controlled browser fixtures built from real API product cards, so the UI contract can be checked without provider credentials.
The existing core fake-provider tests separately cover parsing, embeddings, provider failures and fallback through the actual services.
These are local checks; real provider success remains unverified until credentials and catalogue embeddings are ready.

## Browser evidence

Ran Chrome at 1440 x 900, 768 x 1024 and 390 x 844:

```powershell
$env:E2E_CHROME = '1'
pnpm test:e2e --project=chrome-desktop --project=chrome-medium --project=chrome-phone discovery-search.spec.ts
```

Run `5aaea06e7b4a`: exit 0, `3 passed (48.5s)`.
Its disposable database and bucket were cleaned successfully.
The initial desktop run `fb15c2a6a8ff` also passed (`1 passed (28.2s)`).
Real natural-search responses with AI disabled displayed keyword fallback and server product cards.
The price form rejected three decimal places and sent ₹10.05 as 1005 paise.
Real cursor pages had no duplicate products; first-page navigation removed the cursor.
A controlled 429 response showed a generic limit message without private provider detail.
A controlled meaning response showed the understood price bounds and escaped script-like text without creating a script element.
Switching back to the header's keyword search removed the advanced mode.
Keyboard product-card navigation, light/dark accessibility and horizontal-overflow checks passed at all three sizes.
Reviewed desktop dark, medium light and mobile photo screenshots.

## Repository checks

Ran `pnpm check` after the browser launcher exited: exit 0.
Formatting, lint and typecheck passed.

```text
packages/core: Test Files 75 passed (75); Tests 996 passed (996)
apps/web: Test Files 56 passed (56); Tests 282 passed (282)
apps/worker: Test Files 1 passed (1); Tests 11 passed (11)
```

All 1,289 tests passed, including six new helper tests for upload validation, supported request parameters, cursor resets, safe error messages and direct storage uploads.
Build output: `Compiled successfully in 9.5s` and `Generating static pages ... (108/108)`.
The first gate stopped on formatting in the new browser file; formatting was fixed before the successful complete gate above.
The fetched `origin/main` at `10fbc5f` is an ancestor of this branch.
No required local check remains deferred; real-provider success still needs the credentials and embeddings described above.
