# 21: Administrator policy editor

Status: complete.
Depends on: 20.

## Read first

Read [the shared completion rules](README.md#completion-rules), root AGENTS.md and [handover section 7.9](../../../docs/frontend-handover.md).
Read the matching flow in docs/system-design.md and the existing route handler, service and types before changing a screen.
Verify payloads against the code instead of copying an old plan.

## One-session scope

Build /admin/content and /admin/content/[slug] with draft/published status and the same safe preview as public pages.

## Acceptance

Drafts remain private; publish updates the public page through existing invalidation; errors retain edits; placeholders are clearly identified in release evidence.
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

Built with task 20 on `frontend/step-3-policies`, starting from task 18 documentation commit `390c459`.
Implementation commit: `e4003c4` (`Add public policies and administrator content editor`).
Added `/admin/content`, `/admin/content/[slug]` and the Policy pages portal link.
The list uses the existing service to show all six pages, including unwritten drafts, and displays saved status and India-time update dates.
The editor sends only title, bodyMarkdown and draft/published status through the existing PUT route.
Its title and text limits match the service contract.
The preview uses the same safe Markdown component as public pages.
Unsaved status changes are separate from the last-saved badge.
Save failures retain title, text and selected status.
An uncertain write blocks repeat saves and offers a reload to check the saved version.
Controls wait for hydration and pending saves, with a synchronous write lock to prevent duplicate submissions.
Unique field ids preserve label and keyboard access when Next.js retains another editor page.
Publishing and moving back to draft rely on the existing service's cache invalidation and audit entries.
Administrator pages remain uncached and use the existing permission guard and services.
No backend contract, schema or migration changed.

## Release inputs

The editor and list explain that client-approved text must replace development placeholders before launch.
The client must supply the six final policy texts and correct company details.
Browser tests use examples in disposable resources; they do not establish legal approval.
No provider credentials are needed for this batch.

## Verification coverage

The shared Chrome journey in `apps/web/e2e/policies.spec.ts` checks all six public pages, private drafts, publish invalidation and safe rendering at 1440 x 900, 768 x 1024 and 390 x 844.
It injects a validation-error response and confirms the edited title, body and selected draft status are retained, then saves successfully through the real API.
Reloading confirms the saved draft status persists.
Buyer and seller accounts receive 403 for administrator reads and writes and are redirected away from the editor/list.
The preview can be opened by keyboard, and light/dark accessibility and horizontal-overflow checks cover the list, editor and public page.
See [task 20](20-public-policies.md#browser-checks) for the exact browser command and the first run's test-address isolation fix.
Final run `39209f171013`: exit 0, `3 passed (2.5m)`; its disposable resources were cleaned.
The validation-response test is a browser error-state check; real service validation is also covered by the existing content service and route tests.

## Repository checks

Ran the shared `pnpm check` gate after the browser launcher exited.
Exit code: 0; formatting, lint, typecheck and production build passed.
Package test output: core `996 passed`, web `272 passed`, worker `11 passed`, for 1,279 passing tests.
See [task 20](20-public-policies.md#repository-checks) for the command and package/file counts.
Build output included `Compiled successfully in 16.1s` and `Generating static pages ... (107/107)`, with both administrator content routes present.
The fetched `origin/main` at `10fbc5f` is an ancestor of this branch.
No required local checks remain deferred.
