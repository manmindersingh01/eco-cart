# 30: Portal overview links and counts

Status: complete.
Depends on: 01-29 as applicable.

## Read first

Read [the shared completion rules](README.md#completion-rules), root AGENTS.md and [handover section 7.12](../../../docs/frontend-handover.md).
Read the matching flow in docs/system-design.md and the existing route handler, service and types before changing a screen.
Verify payloads against the code instead of copying an old plan.

## One-session scope

Review portal menus and overview links after screens exist. Add counts only where existing services expose them efficiently.

## Acceptance

No links point to missing routes; counts use server data and permissions; phone navigation and keyboard focus remain usable.
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

Built on `frontend/step-3-portal-navigation`, starting from task 26/29 documentation commit `30123ad`.
Implementation commit: `68f0d77` (`Complete portal overview links and share tool definitions`).
The administrator overview now links to all 15 tools in its menu, and the seller overview links to all eight seller tools.
Each card explains the tool and provides a named action.
Both layouts and overviews use the same typed tool definitions in `src/lib/portal-tools.ts`, keeping destinations and menu labels aligned.
The seller overview retains its real business name, status notice and profile badge, read through the existing seller service.
Existing server-side role checks and uncached personal reads are preserved.
The menus retain their existing horizontal phone scrolling and desktop sidebar layout.
No new counts are displayed: the reviewed order and return services return cursor pages, without efficient total-count contracts.
Counting the first page would misstate totals, and scanning every page would add unnecessary work to the overview.
The existing report and earnings pages retain their own supported server-derived figures.
No backend API, schema, migration or provider behaviour changed.

## Verification approach

The focused Chrome journey checks the full menu/card destination sets, then follows every overview link into its actual page.
It tabs through the whole menu, including the final phone item, and activates it with Enter.
It checks light/dark accessibility and page overflow at the agreed three sizes.
Real seller, buyer and signed-out sessions check the portal access restrictions.
The journey uses the disposable local stack and existing fixtures; no live provider key is needed.

## Browser evidence

Ran after setting `$env:E2E_CHROME='1'`:

```powershell
pnpm test:e2e --project=chrome-desktop --project=chrome-medium --project=chrome-phone portal-navigation.spec.ts
```

Final run `a618a41a7194`: exit 0, `3 passed (2.8m)` at 1440 x 900, 768 x 1024 and 390 x 844.
The lifecycle record reports cleaned disposable resources.
The first run (`6f850d19b4d6`) exposed two test issues: an accessibility snapshot during a colour transition and a heading selector matching a hidden previous route retained by Next.js.
The test now retries the accessibility assertion within a fixed time limit and selects the visible heading by its role.
The final run followed every one of the 15 administrator and eight seller overview links into its actual page.
Menu destinations matched the overview destinations, with Overview as the extra menu entry.
Tab reached each menu entry, including the final horizontally scrolled phone entry; Enter opened that destination.
Seller access to administration and buyer access to either portal redirected to access denied.
Signed-out access redirected to sign-in.
Light/dark accessibility and horizontal-overflow checks passed at all three sizes; reviewed the screenshots.

## Repository checks

Ran `pnpm typecheck` and `pnpm lint` before the browser journey: both exited 0.
Ran `pnpm check` after the final browser launcher exited: exit 0.
Formatting, lint, typecheck, all 1,298 tests and the production build passed.
Package output: core `996 passed` (75 files), web `291 passed` (59 files), worker `11 passed` (one file).
Build output included `Compiled successfully in 11.2s` and `Generating static pages ... (110/110)`.
`git diff --check` passed.
The fetched `origin/main` at `10fbc5f` is an ancestor of this branch.
No required local checks remain deferred for this task.
Task 31 remains the separate final marketplace verification and provider handover; live-provider checks are not claimed by this navigation change.
