# Task 05: Catalogue operations evidence

Date: 21 October 2026, Asia/Kolkata.
Branch: `step-2-marketplace-completion`.
Base: `661b7fedc09481eccd7ce408e27bb88a4f325af3`.
Candidate: task 05 implementation working tree on that base, verified before its implementation commit.
Status: complete.
Dependencies: tasks 02 through 04 are complete, with their earlier evidence retained.
The starting worktree was clean.

## Delivered behaviour

- Product creation defaults minimum quantity to 1 and validates whole numbers from 1 to 1000.
  The separate product minimum editor remains available in approved and other states supported by the existing service.
  Unrelated listing edits omit the minimum and therefore preserve it.
- Photo order identifies the cover and supporting photos without a second featured flag.
  Existing direct uploads, processing and four-photo enforcement remain.
  An added service regression races registrations for the last available photo slot.
- One optional MP4, MOV or WebM video uploads directly to storage under the existing 50 MB and 60-second rules.
  Status polling is bounded, failure reasons remain visible, removal is confirmed and only converted video/poster URLs are previewed.
  Registration is never retried blindly after a network failure.
- Sellers can submit, withdraw, move to draft, restore and archive through existing service routes.
  Readiness failures and conflicts are shown, with authoritative refresh on conflict.
- Administrators have an open moderation queue with risk filtering, keyset pagination, media/commercial previews, screening/history and confirmed approval, rejection and take-down.
  Approval waits for screening and uses the existing category GST default.
  Review notes survive recoverable conflicts.
- CSV/XLSX imports have direct upload, inspected sample rows, editable mapping, confirmation, bounded progress polling, accurate partial-success counts and protected error downloads.
  Mapping choices come from the existing server field metadata, including minimum quantity.
  Successful rows remain drafts for photos and review.
- `@ecokart/core/catalogue-contracts` exposes browser-safe shared constants and import metadata.
  It prevents client components from importing the database/worker barrel.
  No public HTTP contract, migration or business policy changes are intended.

## Implementation entrypoints

| Area | Implementation |
| --- | --- |
| Quantity, publication and video controls | [Product operations](../../../../apps/web/src/components/seller/product-operations.tsx), integrated into the existing product editor |
| Creation and payload validation | [Product form and serialisation helpers](../../../../apps/web/src/lib/seller-products.ts), existing create/listing/photo components |
| Import list, upload, mapping and progress | [Import manager](../../../../apps/web/src/components/seller/import-manager.tsx), protected `/seller/imports` and `/seller/imports/[id]` pages |
| Review queue and decisions | [Moderation manager](../../../../apps/web/src/components/admin/moderation-manager.tsx), protected `/admin/moderation` and `/admin/moderation/[id]` pages |
| Browser-safe shared metadata | [Catalogue contracts](../../../../packages/core/src/catalogue-contracts.ts), exported by the core package |
| Upload recovery and mapping validation | [Shared frontend helpers](../../../../apps/web/src/lib/catalogue-operations.ts) and their unit tests |

## Existing API contracts used

| Operation | Contract |
| --- | --- |
| Minimum-only update | `PATCH /api/seller/products/{id}` with `{ minOrderQuantity }`, returning `{ product }`; other listing updates omit this field unless explicitly changed |
| Publication | `POST .../{id}/submit`, `/move-to-draft` and `/archive`, returning `{ product }`; services enforce status and readiness |
| Video | `POST .../{id}/video/uploads` with `{ contentType, size }` returns `{ upload }`; direct storage POST, then `POST .../{id}/video` with `{ uploadKey }` returns 202 `{ product }`; `DELETE .../{id}/video` removes it |
| Moderation queue/detail | `GET /api/admin/moderation?risk=low&cursor=...` returns `{ items, nextCursor }`; `GET /api/admin/products/{id}` returns `{ product, seller, reviews }` |
| Decisions | `POST /api/admin/products/{id}/approve` with `{}` uses category GST; `/reject` and `/take-down` take `{ reason }`; each returns updated review detail |
| Import upload/registration | `POST /api/seller/imports/uploads` with `{ fileName, size }` returns `{ upload }`; direct storage POST, then `POST /api/seller/imports` with `{ uploadKey, fileName }` returns 202 `{ import }` |
| Import reads/mapping | `GET /api/seller/imports?cursor=...` returns `{ items, nextCursor }`; `GET .../{id}` returns `{ import }`; `PUT .../{id}/mapping` with `{ columnMapping: { header: field } }` returns 202 `{ import }` |
| Row-error download | `GET /api/seller/imports/{id}/error-report` returns a protected, non-cacheable 302 to a short-lived signed URL |

All ownership checks, validation and business transitions remain in core services.
The UI displays shared API error messages and issues; recoverable conflicts refresh server state.

## Automated acceptance mapping

| Cases | Automated evidence |
| --- | --- |
| C01 | Catalogue lifecycle browser journey creates minimum 10, reloads, changes description and verifies the persisted minimum; import journeys verify minimum 10 in created drafts |
| C02 | Client helper tests cover 1, 10, 1000 and invalid input; browser bypass sends minimum 0; the approved listing's minimum is raised above its stock and the public API reports out of stock; existing core storefront tests also cover the stock floor |
| C03 | Media browser journey fills four photo slots, reorders the cover and attempts a fifth; added core test races two registrations for the final slot |
| C04 | Media browser journey uploads unreadable video, observes worker failure, removes/replaces it with generated MP4, verifies converted URLs and refuses duplicate registration; helper tests cover expired-form renewal and ambiguous transport failure |
| C05 | Catalogue browser journey exercises submission prerequisites, withdrawal, rejection/correction/resubmission, approval, approved minimum editing, archive/restoration, reapproval and take-down; public API visibility and existing cache suites check invalidation |
| C06 | Browser checks other-seller product refusal; existing media/import service and API suites cover cross-seller reads, writes and protected downloads |
| C07 | CSV and generated XLSX browser journeys inspect/map columns, create drafts and verify persisted quantities after refresh |
| C08 | Browser journeys import one valid, one duplicate-SKU and one unknown-category row, check exact counts and CSV errors, refuse mapping replay and verify one persisted draft for the SKU |

Browser suites use real OTP sessions, isolated PostgreSQL and SeaweedFS resources, and the actual background worker.
Each browser project has a separate second seller for ownership checks, keeping the production authentication limits enabled without exhausting another project's mailbox quota.
Images, videos and workbooks are generated test fixtures.
Provider AI is disabled; there is no claim that live AI mapping was tested.
The retained tests cover other-seller media/import ownership, malformed files, parser bounds and cache invalidation.

## Commands and observed results

| Command | Result |
| --- | --- |
| Initial `pnpm lint` and `pnpm typecheck` | Identified and corrected new-component lint and serialisation issues; the final gate below passed |
| Initial focused Chromium browser runs | Found the browser/database import boundary and ambiguous test selectors; failed runs are diagnostic, not acceptance evidence |
| CSV/XLSX journey during focused diagnosis | Passed on Chromium desktop, including two partial-success imports; repeated in the passing final suite below |
| `pnpm test:e2e -- --project=chromium-phone --grep=C0` | Exit 0: three passed, zero retries/skips; run `2159d9d512be` cleaned its owned resources; includes the fixed phone table layout |
| `pnpm test:e2e -- --project=firefox-desktop --project=firefox-phone --grep=C0` | Exit 0: six passed, zero retries/skips; run `814b820e24c4` cleaned its owned resources; verifies SKU syntax and reload/hydration fixes |
| `pnpm check` | Exit 0: formatting, lint, typecheck, 996 core + 263 web + 11 worker tests (1,270 total) and Next.js 16.3.7 production build passed; local log `apps/web/.e2e/task05-check.log` |
| `pnpm lint`, `pnpm typecheck` after adding further browser assertions | Both exited 0 |
| Repeated WebKit lifecycle verification | Six passed across desktop and phone, three repetitions each, zero retries; run `1389d6e1cdcc` cleaned its resources |
| Initial final browser gate | 17 of 18 passed; Firefox phone exposed review-card overflow from a long SKU; run `0e2fc4fbb645` cleaned its resources; fixed before the passing gate below |
| `pnpm test:e2e -- --grep=C0` | Exit 0: 18 passed, zero failures/skips/retries; Chromium 156.0.8078.4, Firefox 157.0 and WebKit 27.2, each at 1440 by 900 and 390 by 844; run `7ddb07d4b62c` cleaned its resources |
| `$env:E2E_CHROME = '1'; pnpm test:e2e -- --grep=C0` followed by removing the override | Exit 0: six passed, zero failures/skips/retries; installed Google Chrome 155.0.8059.85 at desktop and phone widths; run `ee0006bace59` cleaned its resources |
| `pnpm test:e2e:smoke` | Exit 0: 14 passed, zero failures/skips/retries across Chromium desktop and phone; run `b777caad3e81` cleaned its resources |
| Final `pnpm check` | Exit 0: formatting, lint, typecheck, 996 core + 264 web + 11 worker tests (1,271 total) and Next.js 16.3.7 production build passed; local log `apps/web/.e2e/task05-acceptance-check.log` |

The final browser gate passed all three catalogue suites across all six engine/viewport projects with `--grep=C0`, plus the existing smoke regressions and installed Chrome checks.
Earlier unfiltered diagnostic runs were stopped after identifying failures; they are not recorded as full-suite passes.

Run artifacts stay in ignored `apps/web/.e2e/runs/<run-id>/` directories.
The browser reports include `catalogue-proof.json`, `media-proof.json` and per-format import proof attachments with synthetic persisted identifiers and asserted results.
Do not commit private signed URLs, authentication data or raw traces.

## Defects and verification adjustments

The first browser run found a client import from the server barrel, which pulled PostgreSQL's Node dependencies into the browser bundle.
The browser-safe contract export fixes that boundary.
Phone verification found that the sample table's intrinsic width expanded its card; the card now permits shrinking and the sample table has its own keyboard-accessible horizontal scrolling region.
The new video input also required the existing photo regression test to select the photo input specifically.
Visibility checks allow the shared cache handler's existing one-second synchronisation interval instead of assuming every public read updates in the same millisecond as a write.
No cache policy or authentication limit was relaxed.
Minimum-only saves retain their success feedback while refreshing the authoritative value.
Firefox exposed an existing SKU HTML pattern that was invalid under the browser's Unicode `v` regexp rules.
Its slash and hyphen are now escaped, with a unit test for supported SKU punctuation and actual browser coverage.
Firefox also restored old dynamic disabled states before hydration; the new publication, video, import and queue controls use forms with `autocomplete="off"`, following the earlier onboarding fix.
The import browser test explicitly waits for the file input to become enabled, because file injection can bypass a disabled input before its handlers attach.
WebKit reproduced a description typed before that editor's handlers were ready being lost on hydration.
Create, listing and photo controls now use their own client-readiness guard, with Firefox form-state restoration disabled.
Photo tests wait for the actual photo input to become enabled before injecting files, rather than assuming a neighbouring component is ready at the same time.
WebKit also exposed an aborted photo-status GET being reported as an access-control page error during navigation.
Photo polling now ignores late results instead of aborting those small reads, matching the earlier document screen fix, and stops after 60 checks with an explicit manual refresh message.
Those small reads use `keepalive` so navigation can finish without WebKit reporting a cancelled request as an access-control failure.
Browser tests wait for the editor's ready images before navigating, in addition to checking worker completion through the API.
The final Firefox phone run also exposed a long SKU expanding the administrator review card.
That card now permits shrinking and the SKU can wrap within the available width.
The browser test retains its document-overflow assertion.

## Manual release checks

Routine quantity, upload, import and ownership checks are automated.
Actual Safari on Apple hardware remains task 12 work, separate from automated WebKit.

1. On a configured Mac checkout, run `pnpm db:up`, `pnpm db:migrate`, `pnpm db:seed` and `pnpm dev` sequentially.
   If no administrator exists, before starting development run `pnpm admin:create --email safari-admin@ecokart.test --name "Safari Test Administrator"`.
2. In current Safari at `http://localhost:3210`, sign in as the seeded `seller2@ecokart.test` using its Mailpit code at `http://localhost:8025` and test desktop width and Responsive Design Mode at 390 by 844.
3. Create a test draft named Safari catalogue bowl, select Bamboo Kitchenware, and use a unique SKU such as `SAFARI-20261021T153000`, selling price 100, MRP 120, stock 20 and minimum quantity 10.
   Leave HSN empty to use that seeded category's code and add a synthetic photo of at least 600 pixels on its longer side.
   Save a description change and reload to confirm the minimum persists.
4. Upload a short synthetic MP4, wait for Ready, play/pause it, remove it through confirmation and upload it again.
   Use keyboard controls and VoiceOver to check form labels, statuses and confirmation focus, then click Submit for review after processing reaches Ready.
5. In a separate administrator session, open Product moderation and that listing.
   Click Refresh screening until approval is enabled, approve the synthetic listing, then check the take-down confirmation and cancel it.
   Confirm controls remain reachable at 200 percent zoom.
6. Save the following text as UTF-8 `safari-catalogue.csv`, replacing `UNIQUE` in both SKUs with a fresh letters-and-digits timestamp such as `20261021T153000` so it can be repeated.
   In Catalogue imports, upload it, confirm Title, Category, SKU, Price, MRP, Stock and Minimum quantity mappings, then click Confirm mapping and import and Start import.
   Expect one imported row and one failed row; open Download row errors and confirm the invalid category is reported.

```csv
Title,Category,SKU,Price,MRP,Stock,Minimum quantity
Safari import bowl,Bamboo Kitchenware,SAFARI-UNIQUE-OK,100,120,20,10
Safari invalid bowl,Unknown Safari category,SAFARI-UNIQUE-BAD,100,120,20,10
```

7. Record macOS/Safari versions, viewport, tested commit and actual outcomes in task 12 evidence.

The existing media contract provides no caption upload or transcription asset.
These seller/admin video previews therefore do not claim captioned audio accessibility; caption support needs a separate product decision.
No production deployment or task 06 storefront UI is included in this task.
