# 18: Coupon administration

Status: complete.
Depends on: None.

## Read first

Read [the shared completion rules](README.md#completion-rules), root AGENTS.md and [handover section 7.7](../../../docs/frontend-handover.md).
Read the matching flow in docs/system-design.md and the existing route handler, service and types before changing a screen.
Verify payloads against the code instead of copying an old plan.

## One-session scope

Build /admin/coupons with create, edit and deactivate using existing endpoints. Convert rupees and percentages exactly to paise and basis points.

## Acceptance

Codes cannot change after creation; percent-only caps are handled; dates display in Indian time; disabled and exhausted coupons follow server validation.
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

Implemented on `frontend/step-3-admin-coupons`, based on tasks 17/19 documentation commit `2a442be`.
Implementation commit: `5dae01f` (`Add administrator coupon management`).
Task 18 is kept separate from the next policy-page and policy-editor batch because its money, date and usage rules are independent.
Added `/admin/coupons`, `/admin/coupons/new` and `/admin/coupons/[id]`, plus the Coupons menu link.
The list uses the existing newest-first cursor service.
Create and edit forms use the existing exact paise and basis-point converters.
Editing sends changed terms, keeping the discount kind, value and cap together so their units stay explicit.
Term edits never send the code, usage counter or enable flag.
Changing the discount type clears its value and cap, and a fixed discount clears the stored percentage cap.
Dates are entered and displayed in India time.
Unchanged minute fields are omitted from edits so existing seconds and milliseconds remain intact.
Deactivation and enabling have confirmation dialogs and change only the enable flag.
Dirty term edits survive a status change, and saving those terms cannot re-enable a disabled coupon.
Server errors preserve useful fields; uncertain write results ask the administrator to check or reload the coupon.
The backend remains responsible for date ordering, fixed-discount minimums, limits, cart eligibility and audit entries.
No backend contract, schema or migration changed.

After successful creation the form resets before navigation, so returning to Create coupon starts a fresh coupon even when Next.js preserves page state.

## Browser verification

Chrome sizes: 1440 x 900, 768 x 1024 and 390 x 844.

```powershell
$env:E2E_CHROME = '1'
pnpm test:e2e --project=chrome-desktop --project=chrome-medium --project=chrome-phone admin-coupons.spec.ts
```

Final run `eeb58cc8c8db`: exit 0, `3 passed (2.1m)`.
Its disposable database and bucket were cleaned successfully.
The journey compares cursor pages with the real API and checks that rows do not repeat.
It creates a percentage coupon with exact amounts and India-time dates, then changes it to a fixed discount and verifies that the percentage cap is cleared.
The code stays read-only, and the API refuses a code change.
Returning to Create coupon after saving starts with a blank form.
Percentage, fixed-minimum, date-order and used-count rejections preserve the entered values.
A real buyer cart receives the exact fixed discount, refuses the coupon after deactivation and refuses an exhausted fixture.
Raising that fixture's total limit allows the cart to use it again.
Buyer and seller accounts are refused administrator reads or writes, and missing coupons and malformed cursors have suitable states.
Keyboard confirmation and focus restoration, light/dark accessibility and horizontal-overflow checks passed at all three sizes.
Reviewed mobile light and desktop dark form screenshots.

### Environment and test findings

The first setup attempt `7ce322694599` could not connect because Docker Desktop was stopped; no browser tests ran.
Started Docker Desktop and ran `pnpm db:up` successfully.
The failed setup's exact, allowlisted test resources were then cleaned, and its lifecycle record is marked cleaned.
Run `bea06b5195f2` exited 1 at a date assertion because its global text selector also matched a hidden, cached coupon list.
The test now scopes summary checks to the visible saved-coupon card and verifies India time without depending on one ICU timezone abbreviation.
The successful run checks the intended summary and passes the complete journey.
Follow-up run `90148786a651` reproduced a real issue: returning to Create coupon retained the completed form because Next.js preserves page state.
The create handler now clears its values after a confirmed save, and the final three-size run verifies the same navigation with an empty code field.

## Scope left for later

Tasks 20 and 21 belong together as the public policy pages and their administrator editor.
They are outside this coupon batch.
Task 18 needs no real provider credentials, and no required provider check is deferred.

## Repository verification

Ran `pnpm check`, which runs formatting, lint, typecheck, tests and the production build in that order.
Exit code: 0.
Formatting, lint and typecheck passed.
Test output:

```text
packages/core: Test Files 75 passed (75); Tests 996 passed (996)
apps/web: Test Files 52 passed (52); Tests 270 passed (270)
apps/worker: Test Files 1 passed (1); Tests 11 passed (11)
```

All 1,277 tests passed, including six focused coupon-form tests for exact conversion, timestamp preservation, discount units, caps, date clearing and invalid inputs.
Production build output included `Compiled successfully in 12.6s` and `Generating static pages ... (104/104)`.
The route table contains all three new coupon pages.
The current `origin/main` is an ancestor of this branch, so no merge conflict with that fetched main revision was found.
