# 29: AI usage and search-gap reports

Status: complete.
Depends on: None.

## Read first

Read [the shared completion rules](README.md#completion-rules), root AGENTS.md and [handover section 7.11](../../../docs/frontend-handover.md).
Read the matching flow in docs/system-design.md and the existing route handler, service and types before changing a screen.
Verify payloads against the code instead of copying an old plan.

## One-session scope

Build /admin/ai and /admin/search-gaps using existing usage and gap endpoints with supported date/day filters.

## Acceptance

Show empty and failed reports; represent costs in their actual API units; display limits and failures accurately; wrong roles are refused.
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

Built with task 26 on `frontend/step-3-assistant-ai-reports`, starting from tasks 27/28 documentation commit `3897cc1`.
Implementation commit: `11b8cc6` (`Add shopping assistant and administrator AI reports`).
Added `/admin/ai`, `/admin/search-gaps` and the administrator menu links.
The pages call existing services under the administrator context and remain uncached.
AI usage supports the service's inclusive India dates, default period and maximum 92-day range.
Calls, failures, tokens and cost are shown per returned India day and feature.
Costs stay in micro-USD internally and are formatted exactly as USD with six decimal places using integer arithmetic.
Unknown cost is Not reported, while a reported zero is USD 0.000000.
Today's platform allowance comes from the returned today object and is separate from the selected report range.
Search gaps support 1-90 days, show the service's bounded top-100 report and group no-result text queries as returned.
Empty reports, invalid filters and unavailable reads have recovery states; raw internal errors are not displayed.
No backend API, schema, migration or provider behaviour changed.

## Verification approach

Disposable fixtures include historical calls around the India-day boundary, a failed call, exact/zero/unknown costs, today’s counted assistant call, an excluded embedding call and old zero-result searches differing only by case.
The browser reads real report data, checks date/day filters and verifies buyer/seller refusals through real routes.
Component tests cover unavailable reports and ensure access errors are not swallowed.
The fixtures verify reporting, not real provider billing; no live provider key is required for these local screens.

## Browser evidence

Ran the shared Chrome command recorded in [task 26](26-shopping-assistant.md#browser-evidence) at 1440 x 900, 768 x 1024 and 390 x 844.
Run `d83bf77c53aa`: exit 0, `3 passed (2.0m)`; disposable resources were cleaned.
Real administrator reads grouped the historical fixture under its India date and returned two listing calls with one failure and USD 1.234567 reported cost.
The unknown assistant cost displayed Not reported.
Today's platform count was one, excluding the embedding call and remaining independent of the historical range.
The native date form changed to an empty future range; reversed dates displayed validation guidance.
Search gaps were empty for 30 days and grouped the two differently cased queries into one entry for 90 days.
An out-of-range day filter displayed validation guidance.
Real buyer/seller report API requests returned 403 and private report pages redirected to access denied.
Light/dark accessibility and horizontal-overflow checks passed at all three sizes; reviewed screenshots.

## Repository checks

Ran the shared `pnpm check` gate recorded in [task 26](26-shopping-assistant.md#repository-checks): exit 0.
Formatting, lint, typecheck, all 1,298 tests and the production build passed.
Package output: core `996 passed`, web `291 passed`, worker `11 passed`.
Focused tests cover exact six-decimal micro-USD formatting, unknown versus zero costs, unavailable reports without internal details and access failures outside report error handling.
Build output included `Compiled successfully in 12.9s` and `Generating static pages ... (110/110)`.
The fetched `origin/main` at `10fbc5f` is an ancestor of this branch.
No required local checks remain deferred; live provider billing remains a separate provider check.
