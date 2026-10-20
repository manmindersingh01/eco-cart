# 01: Automation prerequisites and isolated browser testing

| Field | Value |
| --- | --- |
| Status | Planned |
| Implemented | No |
| Depends on | 00 |
| Blocks | Automated evidence for all following deliveries |

## Outcome

Create a repeatable way to test real pages, routes, database writes, and worker outcomes without resetting development data.
Use the existing Vitest suites for domain rules and real service integration.
Use Playwright for browser behaviour, not a second implementation of domain rules.
This document requests future setup; no dependencies or scripts are installed by the documentation task.

## Existing prerequisites

Use pnpm 12 from `packageManager` and its managed Node runtime from `devEngines.runtime`.
Use Docker Desktop with PostgreSQL/pgvector at 15434, Mailpit at 8025, and SeaweedFS at 8333.
The worker needs ffmpeg with libx264 and ffprobe on PATH, or its configured executable paths.
Read `.env.example` files for required names without exposing actual secrets.
AI and Razorpay must use existing local testing servers; do not require real provider keys.
The current root `pnpm check` and package Vitest scripts already exist.
`pnpm demo:flow` exists only in the inspected newer backend and becomes available after task 02.

## Dependencies to add during implementation

Add `@playwright/test` and `@axe-core/playwright` as web development dependencies through the workspace catalog.
Select compatible versions at implementation time and commit the catalog and lockfile changes together.
Verify the manifest and executable, rather than treating optional peer entries in the current lockfile as installation proof.
Use the repository's catalog-aware `pnpm --filter @ecokart/web add -D ...` workflow.
Install browser binaries separately after dependencies resolve.

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
The browser packages, accessibility dependency, test scripts, and isolated launcher are prerequisites, not assumed existing commands.

## Proposed files and commands

| Proposed file | Responsibility |
| --- | --- |
| `apps/web/playwright.config.ts` | Browser projects, base URL, bounded timeouts, artifacts, CI configuration |
| `apps/web/e2e/support/environment.ts` | Disposable database/bucket allocation, environment checks, lifecycle |
| `apps/web/e2e/support/fixtures.ts` | Unique users, approved listings, addresses and order fixtures through existing services |
| `apps/web/e2e/support/auth.ts` | Real Better Auth OTP sign-in using Mailpit, isolated cookies per actor |
| `apps/web/e2e/support/worker.ts` | Worker health and bounded polling for actual completed jobs |
| `apps/web/scripts/test-e2e.ts` | Prepare isolated services, migrate test database, build/start app and worker, run browsers, clean up own resources |
| `apps/web/e2e/*.spec.ts` | Journeys added alongside each delivery |
| `.github/workflows/ci.yml` or dedicated E2E workflow | Run browser jobs with service containers and upload reports |

Propose root scripts `test:e2e`, `test:e2e:smoke`, and `test:e2e:report` forwarding to the web package.
Until implemented, these command names are plans, not runnable verification instructions.
Keep Vitest discovery from collecting Playwright specs and vice versa.
Add `playwright-report/`, `test-results/`, and saved authentication state to appropriate ignores.
Commit a small redacted evidence summary; CI stores large artifacts.

## Isolation and process lifecycle

Allocate `testDatabase('e2e')` and `testStorageEnv('e2e')` using the existing helpers in `packages/core/src/testing/urls.ts`.
A separate suffix or run tag is needed for simultaneous runs in the same checkout; worktree tags alone only separate different worktrees.
Validate the resolved database name begins with the test prefix and the bucket name begins with the test prefix before any reset.
Use owner credentials only in setup; launch the web app as `ecokart_web` and worker as `ecokart_worker`.
Pass isolated environment variables explicitly to child processes and set Better Auth origin/base URL consistently.
Preserve the process environment without logging credentials.
Use an explicit loopback test port, for example 3211, after a bind probe confirms it is usable.
If Windows reserves it, fail with a clear diagnostic or choose another port and propagate that same port everywhere.
Do not silently attach to the developer's existing server with `reuseExistingServer` in CI.
Do not run test resets against the dev database used by `pnpm dev`.
Serialise worker-affecting fixtures first; add parallelism only with independent data and queue consumers.
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
Use [evidence-template.md](evidence-template.md); completion evidence is currently pending.
