# Remaining frontend tasks

This is the current documentation plan after integrating main at 10fbc5f through merge 4cb928b.
The merged tracked tree matched origin/main exactly when checked.
The buyer storefront, cart, checkout and order pages are present in code; this planning pass does not claim runtime verification.
Use [the tracked handover](../../../docs/frontend-handover.md) as the frontend reference.
Keep the root frontend-handover.md and remarks2.md untouched.
The user explicitly excluded remarks2.md and confirmed Razorpay and AI credentials will be supplied for later testing.
The original planning delivery contained no feature implementation or environment changes.
Subsequent implementation and verification evidence is recorded in each task file.

## Start here

1. Read [manual preparation](00-manual-preparation.md).
2. Choose one task whose dependencies are satisfied.
3. Ask the agent: "Implement task 01 in temp/frontend/step-3-remaining-screens, follow its completion rules, and record evidence."
4. Finish that task and its checks before taking the next one.

Each task is intended to fit one focused implementation session, including checks, rather than a guaranteed time estimate.
If a missing API or failing baseline prevents that, record the blocker rather than expanding scope silently.
Existing step-1 and step-2 folders remain as history and acceptance references.
Their old planned status for buyer screens must not cause those screens to be rebuilt.
This folder defines the next work; it does not erase historical evidence or claim every older acceptance case passed.

## Codex and Claude compatibility

Both tools use the shared [AGENTS.md](../../../AGENTS.md) repository rules.
[CLAUDE.md](../../../CLAUDE.md) already imports that file with @AGENTS.md.
No separate configuration folder or duplicate rule set is needed for these ordinary Markdown task files.
Read this README and the chosen task explicitly at the start of each session.
Preserve CLAUDE.md and the existing task folders.

## Task order

Dependencies are the actual prerequisites; task numbers give the suggested order.
Payment and order accuracy come first, AI last.
Tasks started as planned; each task file records its current implementation and verification status.

| Task | Scope | Depends on | Status |
| --- | --- | --- | --- |
| [01](./01-seller-orders.md) | Seller order list and detail | None | complete |
| [02](./02-seller-dispatch.md) | Dispatch and delivery | 01 | complete |
| [03](./03-admin-orders.md) | Administrator order list and detail | None | complete |
| [04](./04-admin-order-actions.md) | Administrator order actions | 03 | complete |
| [05](./05-buyer-return-request.md) | Buyer return request and photos | None | complete |
| [06](./06-buyer-returns.md) | Buyer return tracking | 05 | complete |
| [07](./07-seller-returns.md) | Seller return visibility | 05 | complete |
| [08](./08-admin-return-decisions.md) | Administrator return review | 05 | complete |
| [09](./09-admin-return-refunds.md) | Administrator return refunds | 08 | complete |
| [10](./10-seller-earnings.md) | Seller earnings and bank summary | None | complete |
| [11](./11-seller-documents.md) | Seller statements and invoice list | 10 | complete |
| [12](./12-admin-seller-money.md) | Administrator balances, bank details and ledger | None | complete |
| [13](./13-admin-payout-recording.md) | Payouts and adjustments | 12 | complete |
| [14](./14-admin-statements.md) | Administrator settlement statements | 12 | complete |
| [15](./15-buyer-name.md) | Buyer display name | None | complete |
| [16](./16-phone-sign-in.md) | Phone sign-in | None | complete |
| [17](./17-buyer-reviews.md) | Writing and editing reviews | None | complete |
| [18](./18-admin-coupons.md) | Coupon administration | None | complete |
| [19](./19-admin-reviews.md) | Review moderation | 17 | complete |
| [20](./20-public-policies.md) | Public policy pages and footer | None | complete |
| [21](./21-policy-editor.md) | Administrator policy editor | 20 | complete |
| [22](./22-background-work.md) | Background work tools | None | complete |
| [23](./23-natural-search.md) | Natural-language search | None; search-page modes agreed 27 November 2026 | complete |
| [24](./24-photo-search.md) | Photo search | 23 | complete |
| [25](./25-similar-products.md) | Similar product suggestions | None | complete |
| [26](./26-shopping-assistant.md) | Shopping assistant panel | None; recommended collapsible section selected | complete |
| [27](./27-listing-drafts.md) | Seller listing suggestions | None | complete |
| [28](./28-import-suggestions.md) | AI import mapping suggestions | None | complete |
| [29](./29-ai-reports.md) | AI usage and search-gap reports | None | complete |
| [30](./30-portal-navigation.md) | Portal overview links and counts | 01-29 as applicable | complete |
| [31](./31-release-verification.md) | Local release verification and provider handover | 01-30 | complete |

## Current position - 28 November 2026

All 31 tasks are locally complete.
The Status column above and each task's evidence section record what was checked.
Complete means local implementation and the required local checks passed; it does not claim production sign-off or live-provider verification.

The project lead owns the remaining [provider checks](31-provider-checklist.md) and launch inputs below.

### Inputs and attention before launch

- Configure or confirm Razorpay/OpenRouter credentials and run the separate live-provider checks, including catalogue embeddings and the payment webhook.
  Local stand-ins and browser response fixtures do not establish real-provider success.
- Supply or approve the six policy texts and company/legal details; development placeholders are not approved launch content.
- Choose and configure production email/SMS delivery, including the Indian SMS/DLT requirements.
  Current local verification uses Mailpit.
- Resolve the documented payout holdback/full-bank-access process and any price-dependent GST decision with the project lead/accountant.
  Existing screens continue to use masked bank details, external payout records and the documented category rates.
- Confirm a revised launch date and provide the milestone PDF for release-scope validation; the historical 31 October 2026 date has passed.

See [handover section 12](../../../docs/frontend-handover.md#12-open-decisions-and-missing-inputs) and [manual preparation](00-manual-preparation.md) for context.

## Completion rules

- Reuse existing APIs and services; check handover sections 4-6 and the matching system-design flow before coding.
- Keep private pages uncached, public reads behind existing cached helpers, money in integer paise, and lists on cursor pagination.
- Use focused checks for the main journey, permissions and important empty/error states; exhaustive scenario testing is not required.
- Verify the real local journey using local services and fake external providers, rather than treating a rendered page as proof.
- Check one browser (Chrome by default) at large (1440 x 900), medium (768 x 1024) and mobile (390 x 844) sizes, including keyboard access, light/dark mode and no horizontal overflow.
  This replaces the previous multi-browser and real Safari requirement, as agreed on 24 November 2026.
  These sizes provide practical responsive coverage; they are not a measured device-market coverage percentage.
- Run pnpm lint, pnpm typecheck and relevant package tests sequentially.
  Run pnpm check at the release gate and relevant browser suites as required by the repository.
  Record exact commands and outputs; never copy historical results as current evidence.
- The handover mentions an older decision about reducing new automated tests.
  Existing required checks still run; agree the scope of new browser tests before implementing them, and do not silently waive coverage.
  The user allows later provider testing or test scripts, which does not waive local verification.
- Add a completion evidence section to the task with commit, environment, acceptance results and deferred provider checks.
  Use implemented_pending_verification when implementation exists but required verification remains.
- Do not add new backend contracts, deploy, publish or introduce new scope under a frontend task.
  Report missing contracts and follow the design/spec change process if separately authorised.

## Decisions and release inputs still outstanding

These do not block writing this plan or unrelated tasks.
Pause the affected implementation when a required decision is still missing.

- The user agreed on 27 November 2026 to search-page options for natural and photo search, with the header kept as keyword search (tasks 23 and 24).
  Task 26 uses the recommended collapsible product/search section following the instruction to start implementation.
- Keep payouts as records of transfers made outside EcoKart, with masked account numbers.
  The handover leaves payout holdbacks and secure access to full bank details unresolved; do not invent either behaviour.
- Price-dependent GST remains a client/accountant decision in the design.
  This plan does not change tax calculations or include remarks2.md.
- Collect approved company details, six policy texts, email/SMS delivery setup and production provider settings before release.
- The historical 31 October 2026 launch date has passed; obtain a revised delivery date rather than assigning deadlines from the old timeline.
- The original milestone PDF is not in the repository.
  Obtain it from the project lead for launch scope validation; this plan is limited to the supplied handover.

## Original planning verification

The initial planning delivery changed Markdown only after the separately authorised merge.
Application tests were not run for that documentation-only pass.
Its checks were formatting, local links and git diff --check.
Subsequent implementation and application verification are recorded in each task file.
The [final release verification](31-release-verification.md) passed 1,298 repository tests, the production build, 24 local API walkthrough steps and 21 Chrome journeys across three screen sizes.
