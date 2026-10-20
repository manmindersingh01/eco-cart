# Local browser tests

Run commands from the repository root.
These tests use a separate Next.js development server, the real worker, and disposable test databases and storage buckets.
They do not exercise live payment or AI providers, and they do not reset development data.

## Prerequisites

Use the repository's pnpm-managed Node runtime.
Docker Desktop must be running, and ffmpeg with libx264 plus ffprobe must be on PATH or configured through `FFMPEG_PATH` and `FFPROBE_PATH`.

```powershell
pnpm install --frozen-lockfile
pnpm db:up
docker compose ps
ffmpeg -encoders
ffprobe -version
pnpm --filter @ecokart/web exec playwright install chromium firefox webkit
```

Linux CI installs browser system dependencies with `playwright install --with-deps chromium firefox webkit`.
Dependency/browser downloads require network access.
No development `.env` file or real provider account is needed by the test launcher.
The local services use the same example credentials as the existing test helpers.
To change service ports, set `TEST_DATABASE_SERVER_URL`, `TEST_STORAGE_ENDPOINT` and `MAILPIT_URL` before starting the launcher.
Only loopback database/storage targets are accepted.

## Commands

```powershell
pnpm test:e2e:smoke
pnpm test:e2e
pnpm test:e2e:demo
pnpm test:e2e:verify-harness
pnpm test:e2e:report
```

The smoke command runs Chromium desktop and phone projects.
The full command runs Chromium, Firefox and WebKit at 1440 by 900 and 390 by 844 CSS pixels.
Run `pnpm check` and browser/demo launchers sequentially in the same checkout.
Next.js regenerates route type files while serving pages; a concurrent typecheck can read an incomplete generated file.

`pnpm test:e2e:demo` runs the API walk-through with its own database, bucket, web server and worker, using the same ownership checks and cleanup as browser runs.
It also seeds example products because the combined seller/buyer story purchases another seller's product.
The demo now exercises applying to sell and combined-account shopping rather than skipping them.
Required-feature skips fail the isolated demo gate; an AI-disabled step is reported explicitly as skipped.
The redacted command summary belongs in task evidence, while raw local output is saved in that run's `demo.txt` and remains ignored.
WebKit is automated engine coverage, not proof of actual Safari on Apple hardware.
Phone projects exercise responsive widths without claiming physical-device emulation.

Select projects or tests by forwarding Playwright arguments:

```powershell
pnpm test:e2e -- --project=firefox-phone --grep=P04
pnpm --filter @ecokart/web exec playwright test --list
```

The second command only lists tests; actual execution must go through the launcher.
To test an installed Google Chrome, set `$env:E2E_CHROME = '1'`, run `pnpm test:e2e`, then remove that environment override.
This selects `chrome-desktop` and `chrome-phone` instead of the bundled-engine projects.

`test:e2e:verify-harness` runs ownership/provider-isolation unit tests plus three deliberate failure probes.
Setup failure, interruption after startup and a failed browser assertion must each produce the expected non-zero child result, clean up their resources, and preserve unrelated disposable sentinel data.
The assertion probe must also create an HTML report, JUnit report, screenshot and trace.
The verification command itself exits zero only if those assertions pass.
Expected failure probes are excluded from ordinary browser discovery.

## Isolation and cleanup

Each invocation creates an `ecokart_test_e2e_<run-id>` database and matching `ecokart-test-e2e-<run-id>` bucket, with the worktree suffix when present.
The launcher tries loopback port 3211, then selects an available port if Windows or another process prevents binding.
Authentication, storage CORS and Playwright receive that same origin.
Fixture administration uses existing services and Better Auth; browser sign-in reads delivered OTP messages from Mailpit.
Mailpit messages are matched by recipient and request time and are not globally cleared.

The web process uses `ecokart_web`; the worker uses `ecokart_worker`.
Only setup and cleanup use owner connections.
AI and online payment are disabled explicitly for these foundation tests.
Future provider-specific journeys must start the existing deterministic local HTTP stand-ins.
Production configuration checks stay unchanged; `pnpm check` separately verifies the production build.

The dedicated `.next-e2e` directory prevents the test server from sharing the developer's `.next` cache.
Only one launcher may run in one checkout because that output directory is shared.
Different worktrees can run independently.
A second launcher fails before allocating resources if `.e2e/launcher.lock` is held.
Normal failure and Ctrl+C stop owned child processes and remove the run's database/bucket.
Shared Docker services remain running.

After a forced OS/process termination, inspect `apps/web/.e2e/launcher.lock` and its PID first.
If that PID is still running, let it finish or stop that owned launcher normally.
Only after confirming the launcher is gone, remove that exact lock file and inspect the last run's lifecycle record for resources that need cleanup.
Never delete a database or bucket merely because its name resembles a test resource.

## Evidence and diagnostics

Artifacts are under `apps/web/.e2e/runs/<run-id>/`.
`lifecycle.json` records resource names, owned child PIDs, final status and whether cleanup succeeded, without credentials.
`playwright-report/index.html` is the HTML result and `test-results/junit.xml` is the machine-readable report.
Failure folders include screenshots, context and `trace.zip`.
Setup failures before browsers start have lifecycle state and launcher diagnostics, without a browser HTML report.
Successful upload tests also save a full-page product-editor screenshot.
The report command opens the most recent run, including a deliberate failure probe if that ran last.

To inspect a specific trace:

```powershell
pnpm --filter @ecokart/web exec playwright show-trace '<absolute-path-to-trace.zip>'
```

Reports and traces may include test OTPs, session cookies or signed test links.
They are ignored by Git; do not copy raw artifacts into committed documentation or share them publicly.
CI retains browser evidence for seven days under the repository's artifact access controls.
Commit only redacted results and reproducible command summaries.

## Coverage boundary

The foundation covers the public shell, signed-out redirects, real buyer/admin/seller OTP sign-in, buyer role refusal, administrator settings reads after reload, and a direct browser-to-storage photo upload processed by the worker.
Seller onboarding adds application correction/resubmission, administrator requests, real PDF/PNG worker processing, review/replacement, approval/cancellation blockers and combined-role suspension/ownership checks.
Each separate browser identity receives its own synthetic test address for authentication limits; the production limits remain enabled.
It also checks accessibility, keyboard focus, document overflow, browser exceptions and unexpected failed requests.
The administrator test checks existing settings persistence through reads and refresh; it does not change a setting.
Later task files add the remaining commerce and portal journeys.
Real Safari, screen-reader behaviour and actual browser 200 percent zoom remain release checks; viewport tests do not prove those checks.
