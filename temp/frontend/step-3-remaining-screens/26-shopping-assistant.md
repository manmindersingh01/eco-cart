# 26: Shopping assistant panel

Status: complete.
Depends on: None; using the recommended collapsible product/search section following the instruction to start task 26.

## Read first

Read [the shared completion rules](README.md#completion-rules), root AGENTS.md and [handover section 7.11](../../../docs/frontend-handover.md).
Read the matching flow in docs/system-design.md and the existing route handler, service and types before changing a screen.
Verify payloads against the code instead of copying an old plan.

## One-session scope

Add a panel using the existing assistant endpoint, bounded history, supplied product IDs, cited cards and comparison data.

## Acceptance

Answers render as text; declined answers are honest; errors preserve shopping; fabricated product IDs or unsafe HTML are never rendered as trusted content.
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

Built with task 29 on `frontend/step-3-assistant-ai-reports`, starting from tasks 27/28 documentation commit `3897cc1`.
Implementation commit: `11b8cc6` (`Add shopping assistant and administrator AI reports`).
The assistant is a collapsible section on product pages and all three search modes, using the recommended placement after the user instructed us to start task 26.
It uses the existing POST endpoint, with at most five unique viewed product ids and six earlier conversation messages.
The page retains at most three exchanges in memory and has a Clear conversation control; nothing is put in local storage or a cookie.
Changing the viewed product context starts a fresh assistant instance.
Requests have a time limit, a synchronous duplicate-submit lock and cleanup cancellation when the page is hidden.
Errors preserve the question and leave purchase/search controls usable.
Answers, declined-answer explanations and comparison points render as plain text.
Cited cards and comparison product names come from the server's public card objects, never from raw model product ids or text.
The backend remains responsible for dropping fabricated ids and checking product visibility.
No backend API, schema, migration or provider behaviour changed.

## Verification approach

The local browser journey exercises the real AI-disabled endpoint and verifies that shopping remains available and the question is retained.
Controlled responses containing real public product cards exercise safe answers, comparisons, declines, history limits and a rate limit.
The response fixture includes a raw invented product-id field, which is ignored by the UI.
Helper tests check the history/product bounds and card source; existing core fake-provider tests cover actual assistant retrieval and fabricated-id filtering.
These local checks do not establish real provider success; credentials and catalogue embeddings remain release inputs.

## Browser evidence

Ran the focused browser command after setting `$env:E2E_CHROME='1'`:

```powershell
pnpm test:e2e --project=chrome-desktop --project=chrome-medium --project=chrome-phone assistant-reports.spec.ts
```

Run `d83bf77c53aa`: exit 0, `3 passed (2.0m)` at 1440 x 900, 768 x 1024 and 390 x 844.
The lifecycle record reports cleaned disposable resources.
The assistant opened with the keyboard and retained the question after the real AI-disabled endpoint returned unavailable.
Add to cart remained enabled.
Controlled answers displayed script-like text literally, ignored invented raw product ids, rendered public cited cards and showed a two-product comparison.
Declined answers explained the missing facts and removed stale cited cards.
Further questions bounded the request history to six messages and the displayed conversation to three exchanges.
A controlled 429 response preserved the question and hid internal error detail; clearing removed the conversation.
A real request from keyword search included the product ids currently shown on that page.
Light/dark accessibility and horizontal-overflow checks passed at all three sizes; reviewed screenshots.

## Repository checks

Ran `pnpm check` after the browser launcher exited: exit 0.
Formatting, lint, typecheck, all 1,298 tests and the production build passed.
Package output: core `996 passed`, web `291 passed`, worker `11 passed`.
New focused helper tests verify history bounds, product-card sources and exact micro-USD formatting.
Report component tests verify safe unavailable states and access-error propagation.
Build output included `Compiled successfully in 12.9s` and `Generating static pages ... (110/110)`.
The fetched `origin/main` at `10fbc5f` is an ancestor of this branch.
No required local checks remain deferred; live AI answers remain a separate provider check.
