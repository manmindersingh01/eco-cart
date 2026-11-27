# 31: Local release verification and provider handover

Status: complete.
Depends on: 01-30.

## Read first

Read [the shared completion rules](README.md#completion-rules), root AGENTS.md and [handover section 6 and 12](../../../docs/frontend-handover.md).
Read the matching flow in docs/system-design.md and the existing route handler, service and types before changing a screen.
Verify payloads against the code instead of copying an old plan.

## One-session scope

Run the existing full checks and complete real buyer/seller/admin journeys locally. Collect browser evidence and a separate checklist for the user's later Razorpay and AI provider tests.

## Acceptance

Record exact commands, exit codes and failures; payment, stock and permission regressions block completion; deferred provider checks remain explicitly unverified.
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

## Release evidence, 27-28 November 2026

Started from task 30 commit `87ff8d2` on `frontend/step-3-release-verification`.
The release candidate uses the existing routes and services.
Run the following commands sequentially from the repository root with PostgreSQL, Mailpit and SeaweedFS running.
The browser and demo launchers create disposable databases and buckets.

```powershell
pnpm check
pnpm test:e2e:demo
$env:E2E_CHROME = '1'
pnpm test:e2e --project=chrome-desktop --project=chrome-medium --project=chrome-phone foundation.spec.ts catalogue-lifecycle.spec.ts seller-orders.spec.ts return-refunds.spec.ts
```

Windows reserved the default Mailpit and storage ports after Docker restarted.
For the resumed verification, set `MAILPIT_PORT=18025` and `STORAGE_PORT=18333` for Docker Compose and set `MAILPIT_URL=http://localhost:18025` and `TEST_STORAGE_ENDPOINT=http://localhost:18333` for the test commands.
PostgreSQL used port 15434 throughout.

### Findings from the first runs

- The initial `pnpm check` exited 0 with 996 core, 291 web and 11 worker tests passing, followed by a successful production build.
- Demo run `64084416e248` exited 0 with 23 passes and two skips. The launcher had disabled online payments as well as AI. It now configures the existing local payment stand-in and rejects unexpected skips.
- Browser run `88bf0ac9d729` exited 1 with nine passes and 12 failures. Traces showed HTML 404 responses for nested API routes and a seller-order assertion that assumed a particular page number. The seller test now follows the available cursors to the intended order.
- Demo attempt `ad0e781b864e` exited 1 while Docker was unavailable. After recovery the run's named database and bucket were absent.
- Demo run `c53f4f14073f` verified online payment, ownership and replay, then exited 1 on a fetch during settlement. It reached that step while the development server configuration was changing.

The project lead owns the deferred account and provider checks. Record the results in the [Razorpay and OpenRouter checklist](31-provider-checklist.md).

### Marketplace walkthrough

Run `351f63bdc113` exited 0 with 24 passes, zero failures and one expected AI-disabled assistant skip.
Real local buyer, seller and administrator accounts signed in through Mailpit.
The walkthrough checked seller approval, document and media processing, catalogue import, minimum order quantity, checkout, dispatch, delivery, invoice download and review publication.
The combined buyer/seller account also placed its own purchase.
The local payment stand-in confirmed the online order and refused another buyer's payment-resume request.
Replaying the payment notification left stock at 36 after a single two-unit deduction from 38 and produced one sale entry.
The buyer saw a ₹649 refund, and the seller's downloaded statement recorded the ₹1,752.30 payout and a final zero balance.
The launcher cleaned its disposable resources.

### Browser evidence

Run `1cc08ca4c20e` on Chrome 158.0.8127.88 exited 0 with 21 passes in 11.5 minutes and cleaned its disposable resources.
Seven journeys ran at each of 1440 x 900, 768 x 1024 and 390 x 844.
They covered buyer sign-in, keyboard navigation, role restrictions, administrator settings, seller upload and worker processing, listing moderation, seller order isolation and invoice access, dispatch, and exact-money refund recording.
The order and refund journeys included light and dark mode, accessibility and horizontal-overflow checks.
The isolated test server ran with Turbopack's persistent development compiler cache disabled during this run.
The tested implementation commit is `546d96e`.

- [Buyer product page at desktop size](release-evidence/buyer-desktop.png)
- [Administrator refund confirmation at tablet size](release-evidence/admin-tablet.png)
- [Seller order at phone size](release-evidence/seller-phone.png)

### Final repository checks

A repeated `pnpm check` exited 1 when an immediate read of the invoice queue returned zero failed jobs after the test created one.
Commit `ad93038` updates the test to poll the refreshed counts and configures the test worker to allow another manual refresh after one second.
The final full `pnpm check` exited 0 with formatting, lint, typecheck, 996 core tests, 291 web tests, 11 worker tests and the production build passing (110/110 pages).
After setting the test worker interval, `pnpm --filter @ecokart/core typecheck` and `pnpm --filter @ecokart/core test src/modules/background-jobs/service.test.ts` both exited 0, with all 11 focused tests passing.
All 31 frontend tasks are locally complete. Live provider verification and the launch inputs remain assigned to the project lead.
