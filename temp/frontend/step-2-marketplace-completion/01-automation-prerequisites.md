# 01: Automation prerequisites and isolated browser testing

| Field | Value |
| --- | --- |
| Status | `complete` |
| Implemented | Yes - local implementation and required verification passed |
| Depends on | 00 |
| Blocks | Automated evidence for all following deliveries |
| Actual branch | `step-2-marketplace-completion` |
| Base checkout | `901b685fdd74281966de5b13545a850b6d18ee6d`, with prior task 00 documentation edits preserved |
| Verified on | 20 October 2026, Asia/Kolkata |

## Outcome

Create a repeatable way to test real pages, routes, database writes, and worker outcomes without resetting development data.
Use the existing Vitest suites for domain rules and real service integration.
Use Playwright for browser behaviour, not a second implementation of domain rules.
The setup is now implemented; the completion evidence below distinguishes observed results from pending checks.
The user selected a local development web server for browser testing, with production builds checked separately.

## Existing prerequisites

Use pnpm 12 from `packageManager` and its managed Node runtime from `devEngines.runtime`.
Use Docker Desktop with PostgreSQL/pgvector at 15434, Mailpit at 8025, and SeaweedFS at 8333.
The worker needs ffmpeg with libx264 and ffprobe on PATH, or its configured executable paths.
Read `.env.example` files for required names without exposing actual secrets.
AI and Razorpay must use existing local testing servers; do not require real provider keys.
The current root `pnpm check` and package Vitest scripts already exist.
`pnpm demo:flow` exists only in the inspected newer backend and becomes available after task 02.

## Installed dependencies

`@playwright/test` 1.64.1 and `@axe-core/playwright` 4.14.0 are declared through the workspace catalog and web development dependencies.
The lockfile records the installed dependencies and pnpm's managed Node runtime resolution.
Browser binaries are installed separately after dependencies resolve.

```powershell
pnpm install --frozen-lockfile
pnpm db:up
docker compose ps
ffmpeg -version
ffmpeg -encoders
ffprobe -version
pnpm --filter @ecokart/web exec playwright install chromium firefox webkit
```

On Linux CI use Playwright's `install --with-deps` option for the selected browser projects.
If Windows WebKit is unsupported for the chosen package/OS combination, run that project on supported Linux or macOS CI.
Browser downloads require network access; record installation failures separately from application failures.
The browser packages, accessibility dependency, test scripts and isolated launcher now exist.

## Implementation files and commands

| File | Responsibility |
| --- | --- |
| `apps/web/playwright.config.ts` | Browser projects, base URL, bounded timeouts, artifacts, CI configuration |
| `apps/web/e2e/support/environment.ts` | Disposable database/bucket allocation, environment checks, lifecycle |
| `apps/web/e2e/support/fixtures.ts` | Unique administrator/seller accounts, settings and category fixtures through existing services; later tasks extend commerce fixtures |
| `apps/web/e2e/support/auth.ts` | Real Better Auth OTP sign-in using Mailpit, isolated cookies per actor |
| `apps/web/e2e/support/worker.ts` | Worker health and bounded polling for actual completed jobs |
| `apps/web/scripts/test-e2e.ts` | Prepare isolated resources, migrate test database, start development app and worker, run browsers, clean up own resources |
| `apps/web/scripts/verify-e2e.ts` | Deliberate setup/interruption/assertion failure probes with unrelated sentinel-data checks |
| `apps/web/vitest.harness.config.ts` | Ownership/provider-isolation unit tests without resetting a package test database |
| `apps/web/e2e/*.spec.ts` | Journeys added alongside each delivery |
| `.github/workflows/browser.yml` | Browser CI with service containers, harness verification, PR smoke, full main/manual runs and seven-day artifacts |

Root scripts `test:e2e`, `test:e2e:smoke`, `test:e2e:verify-harness` and `test:e2e:report` forward to the web package.
The launcher starts `next dev`, not a production server, and uses `.next-e2e` rather than the developer's `.next` cache.
Vitest package discovery uses `src/**/*.test.ts`; the separate harness configuration uses `e2e/support/**/*.test.ts`; Playwright uses `e2e/**/*.spec.ts`.
Intentional assertion probes have a separate opt-in test match and never appear in ordinary discovery.
Generated reports, traces and run state are ignored under `.e2e`.
See [the runnable browser guide](../../../apps/web/e2e/README.md) for commands, isolation, cleanup and troubleshooting.

## Isolation and process lifecycle

Allocate `testDatabase('e2e')` and `testStorageEnv('e2e')` using the existing helpers in `packages/core/src/testing/urls.ts`.
A separate suffix or run tag is needed for simultaneous runs in the same checkout; worktree tags alone only separate different worktrees.
Validate the resolved database name begins with the test prefix and the bucket name begins with the test prefix before any reset.
Use owner credentials only in setup; launch the web app as `ecokart_web` and worker as `ecokart_worker`.
Pass isolated environment variables explicitly to child processes and set Better Auth origin/base URL consistently.
Preserve the process environment without logging credentials.
Probe loopback port 3211, then choose another available port if it is reserved or occupied.
Propagate that same port to authentication, storage CORS, readiness checks and Playwright.
Do not silently attach to the developer's existing server with `reuseExistingServer` in CI.
Do not run test resets against the dev database used by `pnpm dev`.
Run one Playwright worker initially.
Enforce one launcher per checkout with `.e2e/launcher.lock`; independent worktrees have independent output directories and resources.
Stop only child processes started by the test launcher and delete only its verified test resources in `finally` cleanup.
Do not clear all Mailpit messages when tests can filter by unique recipient and timestamp.

## Browser and assertion policy

Run smoke journeys in Chromium, Firefox and WebKit with phone and desktop projects.
Include Chrome channel coverage where a compatible installed Chrome is available.
WebKit gives automated engine coverage; it is not evidence of actual Safari on Apple hardware.
Use role/label locators and user-visible outcomes, not brittle CSS paths.
Use request completion and bounded polling for async jobs, never long fixed sleeps.
Capture console errors, page errors and unexpected failed requests with narrow documented exceptions.
Collect traces on failure, screenshots on failure, HTML/JUnit reports and downloadable response assertions.
Do not put OTPs, cookies, signed private links, full bank details or provider tokens in committed artifacts.
Use axe on stable populated and validation-error states; also test keyboard focus, dialog Escape/restore, no document overflow and 200 percent zoom behaviour.

## Acceptance and proof

| ID | Automated check | Required result |
| --- | --- | --- |
| P01 | Fresh install plus browser executable/version checks | All declared dependencies and selected engines available |
| P02 | Launch twice against independent test resources | Neither run alters dev data or the other's fixtures |
| P03 | Browser signs in with real Mailpit-delivered OTP | Authenticated page shown; no test-only auth bypass endpoint |
| P04 | Upload photo through signed storage form and poll worker | Ready photo appears; web request did not proxy file bytes |
| P05 | Intentionally fail a browser assertion | Non-zero result plus trace/report/screenshot captured |
| P06 | Interrupt or fail setup | Child processes cleaned up; only verified disposable resources removed |
| P07 | Run Vitest and Playwright discovery | No cross-runner collection or database reset collision |

Run existing `pnpm lint`, `pnpm typecheck`, relevant package tests and the new smoke script.
Record actual engine versions, service health, test resource names without credentials, counts, exit codes and artifact locations.
Use [evidence-template.md](evidence-template.md); observed completion evidence is recorded below.

## Implementation evidence

- The launcher creates run-specific test resources, migrates them, sets up storage CORS, prepares accounts through Better Auth and existing services, and starts restricted-role web/worker processes.
- AI and online payments are explicitly disabled; provider configuration checks remain unchanged.
- Browser sign-in waits for real worker-delivered Mailpit messages by recipient and timestamp, without reading OTPs from database tables.
- The smoke suite covers public/protected pages, buyer/admin/seller sign-in, administrator settings reads after refresh and real direct-storage photo processing.
- Accessibility checks cover populated/error states and the confirmation dialog; keyboard checks cover focus containment, Escape and trigger restoration.
- Initial browser reproductions exposed Next.js loading-boundary warnings on sign-in/protected routes and a dialog boundary-Tab issue.
  Explicit Suspense boundaries and dialog keyboard containment fix those observed behaviours.
- The photo file input now has an accessible name.
- The initial sign-in controls wait for React readiness before allowing input, preventing a WebKit interaction from losing the entered email before hydration.
- Protected segments explicitly allow server-blocking session decisions through Next.js's documented `instant = false` setting, without changing permissions or caching personal data.
- The upload journey waits for the editor's own ready image before refresh, rather than navigating away while a status poll is still in flight.
- Root commands/instructions and the browser guide describe setup, report inspection and remaining release-only checks.

## Automated completion evidence

All runs below use local PostgreSQL/pgvector, Mailpit and SeaweedFS with the actual worker on Windows.
No live AI or payment provider was exercised.

| Case/check | Command | Observed result |
| --- | --- | --- |
| Dependencies | `pnpm --filter @ecokart/web add -D @playwright/test @axe-core/playwright` | Exit 0; catalog, manifests and lockfile updated |
| Browser installation | `pnpm --filter @ecokart/web exec playwright install chromium firefox webkit` | Exit 0; all three engine binaries installed |
| Lockfile install | `pnpm install --frozen-lockfile` | Exit 0; lockfile up to date; local dependencies installed without re-resolution |
| Service health | `docker compose ps` | PostgreSQL, Mailpit and SeaweedFS healthy |
| P02/P06 ownership guards | `pnpm --filter @ecokart/web test:harness` | Exit 0; 1 file and 4 tests passed |
| P02/P05/P06 real failure paths | `pnpm test:e2e:verify-harness` | Exit 0; 4 unit tests plus setup, interruption and assertion probes passed; unrelated sentinel data preserved |
| Initial Chromium smoke after loading-boundary fix | `pnpm --filter @ecokart/web test:e2e:smoke` | Exit 0; 8 tests passed across desktop/phone; run `8e98bba166a0` |
| WebKit upload race regression | `pnpm test:e2e -- --project=webkit-phone --grep=P04 --repeat-each=3` | Exit 0; 3 consecutive tests passed; run `16fbf1374f5f` |
| P01/P03/P04/P07 full browser suite including validation and dialog checks | `pnpm test:e2e` | Exit 0; 24 tests passed across all six projects; final run `a4a61e8d8568` |
| P07 browser discovery | `pnpm --filter @ecokart/web exec playwright test --list` | Exit 0; 24 tests in 1 file; no intentional probe or Vitest test collected |
| Repository verification | `pnpm check` | Exit 0; formatting, lint, all package typechecks, 58 core files/825 tests, 36 web files/213 tests, 1 worker file/10 tests, and Next.js 16.3.7 production build passed; 51 static pages generated |
| Documentation links and whitespace | PowerShell relative-link scan plus `git diff --check` | Exit 0; all 16 planning/browser-guide Markdown targets exist; no whitespace errors |

Ignored local lifecycle/report evidence for the final full suite is under `apps/web/.e2e/runs/a4a61e8d8568/`.
The final run used Chromium 156.0.8078.4, Firefox 157.0 and WebKit 27.2 at 1440 by 900 and 390 by 844 CSS pixels.
All 24 browser tests passed with zero retries and no skipped cases.
`lifecycle.json` records `status: cleaned` and `cleaned: true` after the launcher stops its children and deletes its database/bucket.
The harness verification's setup/interruption/assertion lifecycle records are respectively `240af131991f`, `5d6104dbac3b` and `44b71089b690`; each records successful cleanup.
The earlier smoke evidence remains under `apps/web/.e2e/runs/8e98bba166a0/`.
Failure probes produce expected non-zero child runs; their verifier succeeds only when failure artifacts and cleanup assertions pass.
The earlier failed reproductions remain diagnostic evidence and are not counted as successful tests.
Remote GitHub Actions execution is not claimed by local checks.
The browser workflow is implemented and ready to run on push/pull request; a clean hosted installation and Linux execution remain CI observations rather than local claims.

## Manual remainder

No routine manual step is needed to repeat the automated foundation checks after prerequisites are installed.
Run the four root commands documented above, then use the report command to inspect failures.
Real Safari on Apple hardware, screen-reader announcements and actual 200 percent browser zoom remain task 12 release checks.
WebKit and viewport automation do not claim to replace those observations.

## Handover

Task 01 is complete for the agreed local-development runtime.
Next is [02: Backend integration and role compatibility](02-integration-and-roles.md).
Use the new root browser commands for regressions while integrating the newer backend; do not treat the current foundation tests as coverage of marketplace screens not yet implemented.
