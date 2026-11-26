# 17: Writing and editing reviews

Status: complete.
Depends on: None.

## Read first

Read [the shared completion rules](README.md#completion-rules), root AGENTS.md and [handover section 7.6](../../../docs/frontend-handover.md).
Read the matching flow in docs/system-design.md and the existing route handler, service and types before changing a screen.
Verify payloads against the code instead of copying an old plan.

## One-session scope

Add a buyer review form and own-review loading/editing on product pages. Add review pagination if missing.

## Acceptance

One review per buyer/product follows API rules; hidden own reviews can be handled; verified-purchase status is server-owned; other roles and signed-out users get suitable states.
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

Batched with task 19 on `frontend/step-3-buyer-reviews-moderation`, based on tasks 15/16 documentation commit `db69edf`.
Implementation commit: `254dcfe`.
Product pages now include buyer review creation and editing, private own-review loading and published-review pagination.
The public product and initial review list retain the existing cached readers.
Personal review reads run in the browser through protected APIs and never enter the public page cache.
Signed-out users get a sign-in link back to the product; other roles get a buyer-account message.
Hidden reviews can be loaded and edited, and the form explains that they remain hidden until an administrator publishes them again.
Successful writes refresh the product page; the rating summary and verified-purchase badge come from the server.
Rejected writes preserve useful form values, and duplicate or uncertain results require an own-review reload before another save.
Published review pages use the API cursor, keep already loaded rows after a failed read and offer refresh and retry through the same controls.
Review text is rendered as plain text.
No backend contract, schema or migration changed.

## Browser verification

Chrome sizes: 1440 x 900, 768 x 1024 and 390 x 844.

```powershell
$env:E2E_CHROME = '1'
pnpm test:e2e --project=chrome-desktop --project=chrome-medium --project=chrome-phone product-reviews.spec.ts
```

Run `fc9b06201162`: exit 0, `3 passed (3.3m)` for the combined buyer-to-administrator journey.
The initial run `3ef0f5502bc9` reached the last filter checks at every size, then exited 1 because a global alert selector also matched Next.js's route announcer.
The selector now targets the review error notice, and the complete journey passes.
The public list loads another cursor page without duplicate rows and retains existing reviews after a failed read.
Own-review loading failures can be retried, validation errors preserve the draft, and subsequent saves edit the original review instead of adding another one.
A duplicate create request is refused by the real API.
A buyer with a seeded delivered order line receives the server's verified-purchase badge; another buyer receives no badge.
The form never submits verification, status or ownership fields.
Hidden reviews can be loaded and edited but remain excluded from the public list and rating until an administrator publishes them again.
Signed-out users get a return-to-product sign-in link, and administrator and seller-only accounts are refused review writes.
The published rating count and average are read from the real product API after each relevant change.
Keyboard access, light/dark accessibility and horizontal-overflow checks passed at all three sizes.
Reviewed desktop dark and medium light buyer form screenshots and the mobile moderation screenshot.
The new fixtures use dedicated products and authors, service-created seed reviews and a delivered-order snapshot for the verified buyer.
The browser harness recognises the documented missing-own-review 404 as an empty state, without suppressing other review-route failures.

Existing product publication and storefront regression:

```powershell
pnpm test:e2e --project=chrome-desktop catalogue-lifecycle.spec.ts
```

Run `68f0711131f2`: exit 0, `1 passed (1.7m)`.
The existing quantity, listing-review decisions and public-visibility journey remains green with the new review section.
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
No required task 17 checks are deferred.
Task 18 is separate coupon work and remains planned.
The unrelated root frontend-handover.md and remarks2.md remain untouched.
