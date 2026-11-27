# 20: Public policy pages and footer

Status: complete.
Depends on: None.

## Read first

Read [the shared completion rules](README.md#completion-rules), root AGENTS.md and [handover section 7.9](../../../docs/frontend-handover.md).
Read the matching flow in docs/system-design.md and the existing route handler, service and types before changing a screen.
Verify payloads against the code instead of copying an old plan.

## One-session scope

Build /policies/[slug] using cached content reads and a safe Markdown renderer with raw HTML disabled. Add footer links and company details with a not-configured fallback.

## Acceptance

All six supported slugs render; drafts return not found; unsafe HTML cannot execute; missing company details do not break shopping.
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

Built with task 21 on `frontend/step-3-policies`, starting from task 18 documentation commit `390c459`.
Implementation commit: `e4003c4` (`Add public policies and administrator content editor`).
Added `/policies/[slug]` inside the storefront for terms, privacy, shipping, returns, refunds and seller-agreement.
The route and metadata reuse `readContentPage`; its existing cache tags also cover missing pages.
Drafts and unknown slugs show the existing not-found screen.
Published pages show their title and last-updated time in India time.
The public body and administrator preview share `PolicyMarkdown`, using `react-markdown` with raw HTML skipped, a small element allowlist and the library's default safe URL handling.
No raw HTML plugin or HTML insertion is used.
Markdown headings, paragraphs, emphasis, lists, links, quotes and code blocks are supported; images are omitted.
The footer links to all six pages and reads cached legal name, address, GSTIN, support contacts and grievance officer details.
When company settings are not configured, it shows a short fallback and keeps the links available.
Unexpected errors still reach the existing error boundary.
The Markdown dependency is in the pnpm catalog; the existing managed Node runtime remains unchanged.
No backend contract, schema or migration changed.

## Release inputs

Local seed policy text is a development placeholder, not approved legal text.
Browser-test text is also an example and lives only in disposable test resources.
The client must supply approved text for all six policies and correct company details before launch.
No provider credentials are needed for this batch.

## Browser checks

Ran Chrome at 1440 x 900, 768 x 1024 and 390 x 844:

```powershell
$env:E2E_CHROME = '1'
pnpm test:e2e --project=chrome-desktop --project=chrome-medium --project=chrome-phone policies.spec.ts
```

Final run `39209f171013`: exit 0, `3 passed (2.5m)`.
Both runs' disposable databases and buckets were cleaned successfully.

The journey renders all six supported slugs as an anonymous visitor and checks footer policy links and configured company details.
It checks raw script, image/event-handler and iframe removal, safe link destinations and no script execution in both the preview and public page.
It warms a published policy, saves it as a draft and observes both a public API 404 and the public not-found screen.
It then publishes revised text and verifies the formerly cached missing page becomes public with the revision.
Keyboard access, light/dark accessibility and horizontal-overflow checks cover the policy page and editor.
Reviewed desktop and mobile screenshots, including the company footer and long code-block text.

The first run `2d17ab3912b7` exited 1 with two projects passed.
The phone project completed the policy checks but its final seller sign-in hit the normal per-IP rate limit because separate browser contexts shared an address.
The test now assigns separate example client addresses to administrator, buyer and seller contexts, matching the existing browser-test pattern.
No application authentication limit was changed.

## Repository checks

Ran `pnpm check` for formatting, lint, typecheck, package tests and the production build, sequentially after the browser launcher exited.
Exit code: 0; formatting, lint and typecheck passed.
Test output:

```text
packages/core: Test Files 75 passed (75); Tests 996 passed (996)
apps/web: Test Files 53 passed (53); Tests 272 passed (272)
apps/worker: Test Files 1 passed (1); Tests 11 passed (11)
```

All 1,279 tests passed.
The web tests include the missing-company-settings fallback and a check that unexpected errors are not disguised as missing settings.
Build output: `Compiled successfully in 16.1s` and `Generating static pages ... (107/107)`.
The route table includes `/policies/[slug]`, `/admin/content` and `/admin/content/[slug]`.
The fetched `origin/main` at `10fbc5f` is an ancestor of this branch, so no merge conflict with that revision was found.
No required local checks remain deferred.
