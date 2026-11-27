# 19: Review moderation

Status: complete.
Depends on: 17.

## Read first

Read [the shared completion rules](README.md#completion-rules), root AGENTS.md and [handover section 7.8](../../../docs/frontend-handover.md).
Read the matching flow in docs/system-design.md and the existing route handler, service and types before changing a screen.
Verify payloads against the code instead of copying an old plan.

## One-session scope

Build /admin/reviews with published/hidden filters, product links and hide/show actions.

## Acceptance

Moderation refreshes the list; wrong roles are rejected; published product ratings follow backend recalculation without browser guesses.
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

Batched with task 17 on `frontend/step-3-buyer-reviews-moderation`, based on tasks 15/16 documentation commit `db69edf`.
Implementation commit: `254dcfe`.
Added `/admin/reviews` and the Review moderation menu link.
The page uses the existing administrator list service with published/hidden filters and newest-first cursor pages.
Cards show the review, server-owned verified-purchase flag and product link, with a clear fallback when the product is unavailable.
Hide and publish actions use confirmation dialogs and the existing protected PATCH route.
Actions refresh the filtered list after the server response, so a review moves out of the current status page.
The backend remains responsible for audit entries, rating recalculation and storefront invalidation.
Invalid filters and cursors show a recovery link, and request failures show a visible error.
No backend contract, schema or migration changed.

## Browser verification

Chrome sizes: 1440 x 900, 768 x 1024 and 390 x 844.

```powershell
$env:E2E_CHROME = '1'
pnpm test:e2e --project=chrome-desktop --project=chrome-medium --project=chrome-phone product-reviews.spec.ts
```

Run `fc9b06201162`: exit 0, `3 passed (3.3m)` for the combined review journey.
The preceding run `3ef0f5502bc9` exited 1 at the invalid-filter assertion because its global alert selector also matched Next.js's route announcer.
Scoping that selector fixed the test; no application change was needed for that failure.
The administrator list matches the API's newest-first pages, with no repeated rows across the cursor boundary.
Cards link to the correct product, and hide/show confirmations refresh the selected status list.
A failed moderation request shows an error and can be retried.
The actual product API shows the rating count falling when a review is hidden and returning when it is published again.
The buyer's edit while hidden remains hidden and does not change the published average.
Wrong status values and malformed cursors show recovery controls.
Signed-out access redirects to sign-in, and buyer and seller accounts cannot use moderation routes.
Keyboard confirmation and focus restoration, light/dark accessibility and horizontal-overflow checks passed at all three sizes.
Reviewed desktop buyer forms and the mobile light moderation card.
No live provider credentials were needed.

Existing catalogue moderation and public-visibility regression:

```powershell
pnpm test:e2e --project=chrome-desktop catalogue-lifecycle.spec.ts
```

Run `68f0711131f2`: exit 0, `1 passed (1.7m)`.
Product-listing moderation remains separate from customer-review moderation and still passes its existing journey.
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
Build: Compiled successfully in 13.5s
Generating static pages (101/101)
```

Exit 0.
`git diff --check` passed.
Fetched origin and verified `origin/main` at `10fbc5f` is included, so no integration conflict remained.
No required task 19 checks are deferred.
The unrelated root frontend-handover.md and remarks2.md remain untouched.
