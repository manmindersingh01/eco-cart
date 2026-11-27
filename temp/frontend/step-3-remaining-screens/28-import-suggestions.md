# 28: AI import mapping suggestions

Status: complete.
Depends on: None.

## Read first

Read [the shared completion rules](README.md#completion-rules), root AGENTS.md and [handover section 7.11](../../../docs/frontend-handover.md).
Read the matching flow in docs/system-design.md and the existing route handler, service and types before changing a screen.
Verify payloads against the code instead of copying an old plan.

## One-session scope

Extend the existing import mapper to show AI suggestions and suggestionPending while keeping manual confirmation and deterministic suggestions.

## Acceptance

Late suggestions never overwrite manual mapping; AI suggestions are labelled; AI unavailable leaves import usable; polling ends when finished or the page closes.
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

Built with task 27 on `frontend/step-3-seller-ai-suggestions`, starting from tasks 23/24 documentation commit `43120a6`.
Implementation commit: `c528950` (`Add seller listing and import mapping suggestions`).
The import mapper labels column-name and AI suggestions and shows their returned confidence.
AI suggestions have a per-column Use AI suggestion button; they are never filled in automatically.
Polling continues while a mapping suggestion is pending, without blocking manual mapping or confirmation.
Late responses update the available suggestions but do not replace existing mapping choices.
The existing deterministic prefill and explicit import-confirmation dialog remain in place.
Polling stops after suggestions finish or import processing reaches a terminal status, and cleanup aborts reads when the page is hidden.
No backend API, schema, migration or provider behaviour changed.

## Verification approach

The Chrome journey uploads a real CSV and receives real column-name suggestions with AI disabled.
Controlled detail responses then mark AI work pending and return late suggestions while the seller maps a column manually.
The test chooses a different AI suggestion explicitly, confirms through the real mapping API and verifies the real imported draft preserves the manually mapped description.
Other sellers and buyers are refused access to the created product/import data.
Focused helper tests check selected listing-field copying and the import polling conditions; existing core tests cover real AI mapping with a stand-in provider.
Live AI mapping output remains unverified until credentials are supplied.

## Browser evidence

Ran the shared Chrome command recorded in [task 27](27-listing-drafts.md#browser-evidence) at 1440 x 900, 768 x 1024 and 390 x 844.
Run `bf6ec145e575`: exit 0, `3 passed (2.6m)`; its disposable resources were cleaned.
Real CSV processing prefilled the required column-name mappings with AI disabled.
While controlled AI detail responses were pending, manual mapping remained enabled.
The late response labelled AI suggestions with confidence, retained the seller's Description mapping and left an untouched AI-suggested column ignored.
Choosing that column's AI suggestion changed only that column.
Cancelling the import confirmation restored keyboard focus; confirming sent the actual selected mapping through the real 202 API and created a real draft with the manually mapped description.
Cross-seller product/import reads returned 404, and buyer seller-only requests returned 403.
Light/dark accessibility and horizontal-overflow checks passed across all three sizes; reviewed screenshots.

## Repository checks

Ran the shared `pnpm check` gate after the browser launcher exited: exit 0.
Formatting, lint, typecheck, all 1,292 tests and the production build passed.
Package output: core `996 passed`, web `285 passed`, worker `11 passed`.
The helper tests check that only selected listing fields change and that suggestion polling ends in completed or failed import states.
Build output included `Compiled successfully in 9.4s` and `Generating static pages ... (108/108)`.
The fetched `origin/main` at `10fbc5f` is an ancestor of this branch.
No required local checks remain deferred; live AI mapping output remains a separate provider check.
