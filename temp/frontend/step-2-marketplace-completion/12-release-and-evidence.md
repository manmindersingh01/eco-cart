# 12: Release automation and final evidence

| Field | Value |
| --- | --- |
| Status | Planned |
| Implemented | No |
| Depends on | 01 through 11, or an explicit reviewed scope deferral |
| Blocks | Stage 2 local application sign-off and handover to Stage 3 |

## Outcome

Produce a repeatable release result with minimal routine manual verification.
This is the local Stage 2 release gate; Stage 3 implements deployment and final production finalisation.
Do not turn green unit tests into a claim that browser journeys, real Safari, production credentials or financial operations were checked.
Carry pending decisions, skipped tests and missing client inputs as explicit release items.

## CI layers

| Layer | Trigger | Required coverage | Evidence |
| --- | --- | --- | --- |
| Existing CI | Every code PR | `pnpm check` with real isolated PostgreSQL, Mailpit, SeaweedFS and ffmpeg | Command output and job URL |
| Browser smoke | Every frontend PR | Sign-in/roles, seller publish, public product, cart, COD order, own order/invoice | Chromium phone/desktop reports and traces |
| Full browser regression | Release and suitable CI schedule | All numbered task cases in Chromium, Firefox and WebKit; accessibility and private-data checks | Per-project counts and artifacts |
| API walkthrough | Integrated release candidate | Existing `demo:flow` against isolated app/worker, explicit base URL, no required skips | Pass/fail/skip summary and logs |
| Critical integration | Every relevant change and release | Stock races, payment signature/replay, coupon limits, RLS and financial reconciliation | Deterministic test assertions |

Do not start overlapping Vitest and browser runs that reset the same test database or bucket.
Use task 01's isolated launcher and child-process cleanup.
Use separate CI jobs/resources for browser projects if shared worker queues or data cannot safely run concurrently.
Record flaky tests and fix or explicitly raise them; do not make critical assertions disappear with broad retries.
Use bounded worker/provider timeouts and artifact retention appropriate to failure diagnosis.

## Release sequence

1. Select the exact candidate commit, reviewed integration base and included task set.
2. Preserve the resolved D1/D2 decisions to use administrator-requested documents and the existing inclusive 10 MB limit, along with D3's current field permissions; confirm any D4 or adopted multi-role decision is recorded in architecture and instructions.
3. Confirm user remarks are traceable to implemented acceptance cases or explicit deferrals.
4. Install the committed lockfile and test browsers; verify service/tool prerequisites.
5. Run `pnpm check` once on the final code.
6. Run `pnpm test:e2e:smoke` and full `pnpm test:e2e` on isolated resources.
7. Run `pnpm demo:flow --base-url http://127.0.0.1:3211` against the prepared isolated stack after verifying the launcher-selected URL.
8. Inspect failures, unexpected skips, screenshots, accessibility findings and console errors.
9. Complete only the narrow manual checks below.
10. Fill every task's evidence table with actual results; publish a release summary inside this folder and update README tracking.

The E2E commands are implemented by task 01 using an isolated local development server.
The launcher probes port 3211 and falls back to an available port; use its actual configured origin when this step runs.
The API demo may require seeded settings/accounts and supported fake-provider configuration; inspect its implementation and don't point it at production.
Do not treat exit code 0 with skipped included functionality as success.

## Manual work that remains justified

### Real Safari and assistive technology

1. On an iPhone/current Safari and desktop Safari, record OS, Safari version, viewport and candidate commit.
2. On test data, sign in, switch allowed areas, upload one seller photo/video or verification document, and complete one COD order.
3. Confirm the product gallery/video, validation focus, dialog Escape/focus restore, checkout totals and download controls.
4. At desktop 200 percent zoom, check the product editor, cart and checkout for clipped required controls.
5. With VoiceOver or another available screen reader, trigger a field error, submit a form, open/close a confirmation dialog and wait for a processing result.
6. Record announcements and any failure with exact route/reproduction; screenshots are supporting evidence only.

Automated WebKit, axe, focus and viewport tests replace repeated routine checks but do not prove real Safari/VoiceOver behaviour.
Keep this manual pass once per release candidate unless a relevant fix requires repeating it.

### Stage 3 handover: business and production environment inputs

Confirm approved policy/company text, document policy and tax/open design decisions with their owner.
Confirm production email/SMS delivery, storage/CDN/private access, ffmpeg tooling, migration/queue readiness and worker configuration in the deployment runbook.
The account owner must supply/approve production payment settings and the provider-specific sandbox/webhook check before online payments are enabled.
Confirm payout/refund recording language matches the real operational procedure; no UI test proves an external bank transfer happened.
Keep secrets out of evidence.
Record these as Stage 3 handover items rather than blockers for local Stage 2 development using test data and provider stand-ins.
They must be completed before production launch; this task does not implement deployment.

## Final completion gate

- Every included task is complete with implementation paths/commit and reproducible test evidence.
- No UI points to a missing route or gives access using frontend checks alone.
- All three remarks have verified outcomes or a visible approved deferral.
- No required test is skipped, flaky without a tracked decision, or falsely represented as real-provider proof.
- Stock, coupon, payment, invoice and ledger effects are checked beyond screenshots.
- Guest/account and combined-role journeys keep ownership and session boundaries intact.
- Public cache invalidation and uncached personal pages are verified in a production-like Next.js run.
- CI and browser reports identify candidate commit, versions, environment and artifacts.
- Remaining real Safari and accessibility checks have observed results or explicit outstanding items.
- Production client/environment inputs are recorded as Stage 3 handover items, separate from local test results.

## Completion evidence

Pending.
Create a dated release result document using the shared template after implementation and tests actually run.
No application test result is claimed by this planning delivery.
