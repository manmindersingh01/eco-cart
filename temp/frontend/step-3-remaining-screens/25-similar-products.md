# 25: Similar product suggestions

Status: complete.
Depends on: None.

## Read first

Read [the shared completion rules](README.md#completion-rules), root AGENTS.md and [handover section 7.11](../../../docs/frontend-handover.md).
Read the matching flow in docs/system-design.md and the existing route handler, service and types before changing a screen.
Verify payloads against the code instead of copying an old plan.

## One-session scope

Add similar products through the existing cached helper without blocking the main product page.

## Acceptance

No results or unavailable suggestions leave the main product usable; links and cards use server product data.
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

Built with task 22 on `frontend/step-3-background-work-similar-products`, starting from tasks 20/21 documentation commit `426cd3b`.
Implementation commit: `decaf79` (`Add background work tools and similar product suggestions`).
Added a Similar products section below the product's review controls on `/products/[slug]`.
The optional section has its own loading boundary and calls the existing cached `readSimilarProducts` helper.
The main product and purchase controls do not await the suggestion read.
Returned server product data goes through the existing product grid and cards, including prices, stock labels and product links.
An empty list has a short message, and a failed suggestion read stays inside the optional section without showing internal errors.
An existing query defect was corrected to restore its documented empty result when the source has no text vector.
No API contract, schema, migration or AI provider behaviour changed.

## Verification approach

The browser fixtures add deterministic stored text vectors for two existing, approved products in each project's category, plus a product with no vector.
The real similarity query supplies the cards and links; the test follows the expected card by keyboard and checks its product page.
The unembedded product has an empty suggestion state while Add to cart remains available.
Component tests cover empty results and a failed read without exposing its internal error.
These vectors are local test inputs, not output from a real AI provider.
Real provider embedding generation remains part of the later credentials/catalogue verification; this feature makes no provider call when reading suggestions.

## Existing-query regression found during verification

Browser run `9cf43b6ded38` reproduced arbitrary suggestions for a product without a text vector when other products in its category had vectors.
The service's documented contract says this case is empty.
The existing test passed only because its category had no other vectors.
Strengthening that test first reproduced the defect: `pnpm --filter @ecokart/core exec vitest run src/modules/search/meaning.test.ts` exited 1 with `1 failed | 14 passed (15)`.
The query now requires a non-null source vector before selecting neighbours.
The correction is recorded in backend-spec step 18 and its change log, and does not introduce a missing API or new behaviour.
The same focused command then exited 0 with `Test Files 1 passed (1); Tests 15 passed (15)`.

## Browser results

Ran the shared Chrome command recorded in [task 22](22-background-work.md#browser-results) at 1440 x 900, 768 x 1024 and 390 x 844.
Final run `8bde03289019`: exit 0, `3 passed (2.4m)`; its disposable resources were cleaned.
The product without a text vector now shows the empty state even with other embedded products present, and Add to cart stays enabled.
The embedded product shows the expected server-ranked neighbour through the existing cards.
Keyboard activation opens that card's actual product page and matching title.
Light/dark accessibility and horizontal-overflow checks passed for the product page at all three sizes.
Reviewed recommendation-card and work-list screenshots.

## Repository checks

Ran the shared `pnpm check` gate after the browser launcher exited: exit 0.
Formatting, lint, typecheck, all 1,283 tests and the production build passed.
Package output: core `996 passed`, web `276 passed`, worker `11 passed`.
The web suite includes empty and unavailable suggestions checks; the core suite includes the strengthened missing-vector regression.
Build output included `Compiled successfully in 14.2s` and `Generating static pages ... (108/108)`.
The fetched `origin/main` at `10fbc5f` is an ancestor of this branch.
No required local checks remain deferred; real provider embedding generation still needs the release inputs described above.
