# Backend integration, remarks verification and seller onboarding

Implementation and browser verification: 20 October 2026.
Final verification completed: 21 October 2026, Asia/Kolkata.
Branch: `step-2-marketplace-completion`.
Scope: tasks 02, 03 and 04, approved as one dependent implementation sequence.
Status: complete for tasks 02, 03 and 04.
Task 05 can start from the integrated role, application and document contracts.
Real Safari and assistive-technology checks remain explicit task 12 release work.

## Integration and decisions

Starting frontend head: `d00339abf5febb5a87d60f614dd25f54b9652c80`.
Fetched and reviewed backend head: `8c73cd7751f38661ffafd8e31902aff9243ff388`.
Verified implementation merge: `a0ddc7c866d231e0e3a9cb2e7bf08aa5b82a0dcc`, with those two heads as its parents.
The final check ran against that implementation's working tree before committing; only completion documentation changed afterwards.
The merge is local and has not been pushed.
The starting worktree was clean.
The incoming migration journal and migrations 0031 through 0043 were retained without renaming or editing applied migrations.
The merged instructions adopt the recorded 20 October combined buyer/seller decision, as approved in the implementation plan.
The account's `roles` grants available areas; each request still selects one role for database permissions.
Combined accounts shop in buyer context and use seller context for seller routes, with `?as=seller` on shared downloads.
Applicants get only the explicit document access their application needs.

The existing administrator-requested document workflow and inclusive 10 MB limit remain.
PDF, JPEG and PNG are supported.
The worker checks actual bytes; registering an upload only queues that check and returns processing.
Minimum quantity stays product-level, default 1, integer range 1 through 1000, applied to each cart variant independently.
A minimum of 10 permits 11; it is not a required multiple.
Media stays at up to four photos and one optional video, with a usable main photo required for listing submission.
No new policy migration was needed.

## Implemented paths

| Area | Implementation |
| --- | --- |
| Portal roles and server protection | `apps/web/src/components/auth/account-controls.tsx`, `lib/page-auth.ts`, integrated `lib/request-context.ts` and `/api/me` |
| Shared seller downloads | Invoice contract regression plus `?as=seller` support in shared statement status/download handlers |
| Buyer application | `/account/seller-application`, `components/seller/application-manager.tsx`, shared business fields in application mode |
| Requested document upload/history | `/seller/documents`, applicant-safe panel on the application page, `components/seller/documents-manager.tsx` |
| Administrator seller controls | Existing `/admin/sellers/[id]`, `SellerDocumentRequests`, application rejection and accurate suspension wording |
| Administrator review | `/admin/seller-documents`, `/admin/seller-documents/[id]`, `components/admin/document-review-manager.tsx` |
| Shared policies and readiness | `lib/seller-documents.ts`, `lib/use-client-ready.ts` |
| Isolated API demo | `pnpm test:e2e:demo`, extending the existing browser launcher and fixtures |
| Backend defect fix | `packages/core/src/modules/sellers/documents.ts`: review queue recognises rejected businesses |

Uploads request a signed form, send the file directly to storage, register its key, and poll only processing requests every two seconds, up to 60 times.
Storage rejection of a signed form renews the form once; the UI never loops indefinitely or blindly repeats registration.
On a 409, current state is refreshed and recoverable application fields/review reasons are kept.
The administrator sees open requests as approval blockers; the server remains responsible for the final approval check.
Only checked files offer a private download through an authenticated route.
No upload bytes pass through Next.js.

## API contracts reused

| Method and route | Contract |
| --- | --- |
| `GET /api/account/seller-application` | `{ application }`; 404 before application; own business only |
| `POST /api/account/seller-application` | Allowed business fields, optional PAN/GSTIN and invoice prefix; 201 `{ application }`; resubmits a rejected application |
| `PATCH /api/account/seller-application` | Allowed business fields while pending/rejected; 200 `{ application }`; never accepts owner ids, commission or roles |
| `GET /api/seller/documents` | `{ items, nextCursor }`; defaults to open requests; explicit `show=all` includes closed history |
| `GET /api/seller/documents/{id}` | `{ document }` with file history; own seller/applicant context only |
| `POST /api/seller/documents/{id}/uploads` | `{ contentType, size }`; 201 `{ upload: { key, url, fields, maxBytes, expiresAt } }` |
| `POST /api/seller/documents/{id}/files` | `{ uploadKey }`; 202 `{ document }`; worker later validates content |
| `GET`, `POST /api/admin/sellers/{id}/documents` | Paged requests; creation takes `{ documents: [{ type, note }] }` and returns 201 `{ documents }` |
| `GET /api/admin/seller-documents` | Paged received files, oldest first |
| `GET /api/admin/seller-documents/{id}` | `{ document }`, including current status and history |
| `POST .../{id}/accept` | Accept current received file; 200 `{ document }` |
| `POST .../{id}/reject`, `POST .../{id}/cancel` | `{ reason }`; 200 `{ document }`; rejection permits replacement, cancellation clears this blocker |
| `GET .../{id}/files/{fileId}` | Protected 302 to a five-minute signed download, with `cache-control: no-store` |
| `POST /api/admin/sellers/{id}/reject` | `{ reason }`; application becomes rejected and may be corrected/resubmitted |

All routes retain the shared 401/403/404/409 responses and 400 validation responses with `{ error, issues }` where applicable.
Malformed or unsupported file contents fail asynchronously and return the request to the applicant, with a file failure reason.
They never become accepted merely because an upload succeeded.

## Automated acceptance mapping

| Cases | Evidence source and assertions |
| --- | --- |
| I01 | Browser direct navigation to admin, seller and application pages redirects signed-out visitors before protected content is returned |
| I02-I04 | Existing OTP/role foundation tests plus application API/browser journeys: applicant documents allowed, products denied, approval exposes both roles, selling suspension preserves buying |
| I05 | Invoice route test: combined account's sale invoice is 404 in buyer context, 302 with `?as=seller`; unrelated seller gets 404; purchasing buyer still gets 302 |
| I05 statements | Statement route test first reproduced a 404 despite `?as=seller`; after passing the intended area to context resolution, status/download work for the owning combined account and stay 404 for buyer context and other sellers |
| I06 | Existing core storefront-cache and media tests, retained in the full suite; production-like public cache browser coverage remains a task 12 gate |
| I07 | Fresh isolated database migration and actual worker readiness in every harness run; migration command reports all queues ready |
| I08 | Existing portal route/component tests and foundation browser tests retained; settings reload and product editing/media processing exercised |
| B01 | Document service tests sign and process valid PDFs of exactly 10,485,759 and 10,485,760 bytes; signing rejects 0 and 10,485,761; worker rejects forged actual empty/oversized objects |
| B02-B05 | Existing document/file/storage/API tests cover actual content, malformed/encrypted files, private downloads, ownership, approval blockers, duplicate registration and review/approval races |
| B03/S05 defect | New document API regression reproduces `Unknown seller status rejected`; the corrected queue returns the rejected business and preserves the checked file |
| B06-B07 | Product test accepts 1000; cart tests separate variant minimums and allow 11 for minimum 10; fresh checkout rejects a newly raised minimum without stock/order effects; existing concurrency tests retained |
| B08 | Existing photo/video tests plus two concurrent video registrations: one succeeds, one conflicts, exactly one row and job remain |
| S01-S08 | `e2e/seller-onboarding.spec.ts`: application persistence, requested PDF and PNG processing by the real worker, invalid size, review rejection/replacement/acceptance, approval/cancellation blockers, application rejection/correction/resubmission, combined roles/suspension and other-seller refusal |

Browser tests also scan application/review pages with axe, check horizontal overflow at phone/desktop widths and exercise the existing shared confirmation dialog.
The browser identities and documents are synthetic fixtures.
API route tests call the real route handlers with real database/storage/auth dependencies; browser tests additionally run the real web server and worker.

## Commands and observed results

| Command | Observed result |
| --- | --- |
| `git fetch origin` | Succeeded; reviewed backend head unchanged from the investigation |
| `pnpm install --frozen-lockfile` | Succeeded; no dependency changes required |
| `pnpm db:up` | Docker services healthy after starting Docker Desktop; local bucket ready |
| Focused core document/quantity/checkout/video tests | Four files, 105 tests passed before the final additional cart/worker boundary cases |
| Focused core document/cart tests | Two files, 61 tests passed, including forged actual-byte boundary cases |
| Application and client upload-policy tests | Two files, seven tests passed |
| Invoice route suite | One file, 11 tests passed |
| Statement route regression | Failure reproduced before fix; same route suite then passed four tests |
| Storage policy suite | One file, 13 tests passed, including signed POST size boundaries, expired-form rejection and renewed-form acceptance |
| Document route regression | Failure reproduced before fix; same route suite then passed nine tests |
| `pnpm check` initial integrated run | Passed formatting, lint, typecheck, 988 core + 257 web + 11 worker tests and production build; final additions require the final run below |
| `pnpm test:e2e` final candidate | Exit 0: 42 passed, zero retries/skips, eight minutes; Chromium 156.0.8078.4, Firefox 157.0 and WebKit 27.2 at desktop/phone widths; run `9e0936666f7e` cleaned all owned resources |
| Firefox reload regression | `pnpm test:e2e -- --project=firefox-desktop --project=firefox-phone --grep=S0`: four passed, zero retries; run `2aa56025f52d` cleaned all owned resources |
| WebKit phone cancellation regression | `pnpm test:e2e -- --project=webkit-phone --grep=S01 --repeat-each=3`: three consecutive passes, zero retries; run `2c4c97562536` cleaned all owned resources |
| Installed Google Chrome | `E2E_CHROME=1` with `pnpm test:e2e -- --grep=S01`: two passed at desktop/phone widths, zero retries; installed Chrome 155.0.8059.85; run `c8e9c342a70b` cleaned all owned resources |
| `pnpm test:e2e:demo` | Exit 0: 23 passed, 0 failed, 1 skipped; only the AI-disabled assistant skipped; run `a95bbceedca6` cleaned its database, bucket and child processes |
| `pnpm test:e2e:verify-harness` | Exit 0: four ownership/environment unit tests and all three setup/interruption/assertion probes passed; unique resources, expected failure artifacts, cleanup and sentinel preservation verified |
| `pnpm test:e2e:smoke` | Exit 0: 12 passed at Chromium desktop/phone widths; run `1fd6430de797` cleaned all owned resources |
| `pnpm check` final candidate | Exit 0 on 21 October: formatting, lint, typecheck, 995 core + 259 web + 11 worker tests (1,265 total) and Next.js 16.3.7 production build passed; local log `apps/web/.e2e/final-onboarding-check.log` |

The first broad browser run exposed long-email phone overflow and a WebKit pre-hydration input issue.
The account label now wraps within its available width, and controlled forms wait until their handlers are attached.
Firefox reloads also restore dynamic enabled/disabled state unless a form opts out with `autocomplete="off"`.
The reload reproduction matched [Mozilla's documented behaviour](https://developer.mozilla.org/en-US/docs/Web/HTML/Reference/Attributes/autocomplete); application and review forms opt out while keeping their normal controlled state.
Separate administrator browser contexts now use separate synthetic test addresses so one shared localhost address does not consume another test's authentication limit.
Checks and browser launchers run sequentially to avoid reading Next.js route types during a generated-file rewrite.
Accessibility scans wait for the streamed page heading before scanning, rather than intermittently scanning the loading shell.
Worker-status GET polling allows at most two transport retries for a dropped connection; Playwright's documented `maxRetries` applies to connection resets, not HTTP error responses.
Whole test cases still run with zero retries, and failed HTTP responses or failed worker states remain failures.
The initial document read ignores late responses after unmount instead of aborting that small GET, avoiding WebKit's cancellation/access-control errors while preserving permissions and storage CORS rules.
Do not count failed diagnostic runs as successful acceptance.
Ignored browser evidence is under `apps/web/.e2e/runs/<id>/`, including HTML/JUnit reports, failure traces and lifecycle cleanup records.
The verified runtime is pnpm 12.8.1 with its managed Node.js v24.22.0.
The API demo saves a local `demo.txt`; required-feature skips fail the isolated demo gate.
AI-disabled steps are explicitly reported as skipped, not claimed as exercised provider calls.

## Development database setup

The target was verified as local `localhost:15434/ecokart` before migration.
A custom-format backup was saved to `apps/web/.e2e/backups/ecokart-before-onboarding-20261020-211355.dump` before changing development data.
The first migration stopped at the existing four-character invoice-prefix guard.
The only blocked record was the local fixture `T04 Green Basket D4401`, prefix `TD4401`, invoice sequence 0 and no invoices.
After verifying that `TD44` was unused, a guarded transaction changed only that test record's prefix to `TD44` and wrote a `system` `seller.update` audit entry.
No existing invoice or real seller details were changed.
`pnpm db:migrate` then exited 0 and printed `Applied 34 database migrations`, database login readiness and all 20 registered queues ready.
The backup remains ignored and local; it must not be committed or published.
The development database is now migrated; a repeat migration is not required before starting the app.

## Exact remaining manual steps

There is no routine manual repeat of the automated policy and ownership tests.
Real Safari on Apple hardware and assistive technology remain the task 12 release check, because WebKit automation on Windows is not actual Safari.

1. On a Mac with this checkout and the local environment files configured using the repository README, run `pnpm db:up`, `pnpm db:migrate`, then `pnpm dev` from the repository root.
2. Open `http://localhost:3210` in current Safari; record macOS, Safari version and the tested commit, then test desktop width and Responsive Design Mode at 390 by 844.
3. Use a disposable buyer email, enter its code from Mailpit at `http://localhost:8025`, open Seller application, and submit clearly marked test business details with optional tax fields left blank.
4. In a separate administrator session, open Sellers, select that pending test business, request an Other document with a test note, then return to the applicant and refresh documents. If this checkout has no administrator yet, first run `pnpm admin:create --email safari-admin@ecokart.test --name "Safari Test Administrator"` and sign in using its Mailpit code.
5. Upload a small blank/test PDF or PNG containing no personal information; confirm Processing becomes Received, then review and accept or cancel it in the administrator session.
6. Check VoiceOver announces the upload label, status, error/rejection text and confirmation dialog; press Tab/Shift+Tab/Escape on desktop and confirm focus returns to the trigger.
7. At desktop 200 percent browser zoom, confirm form fields, upload input and review controls remain reachable without clipped buttons.

Mailpit must only be reached on the local development network.
The physical iPhone pass remains a task 12 check against its configured release candidate; using another device against a Windows localhost stack also requires matching Better Auth origin, storage endpoint/public URL and upload CORS settings, so changing only the page address to a LAN IP is insufficient.
Do not upload real identity documents for this check or copy private signed URLs, OTPs or raw traces into committed evidence.
Tasks 05 through 12 and Stage 3 production deployment remain separate work.
