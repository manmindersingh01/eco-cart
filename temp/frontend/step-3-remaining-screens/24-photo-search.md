# 24: Photo search

Status: complete.
Depends on: 23.

## Read first

Read [the shared completion rules](README.md#completion-rules), root AGENTS.md and [handover section 7.11](../../../docs/frontend-handover.md).
Read the matching flow in docs/system-design.md and the existing route handler, service and types before changing a screen.
Verify payloads against the code instead of copying an old plan.

## One-session scope

Add signed photo upload and photo search to the agreed search layout using existing endpoints.

## Acceptance

Files upload directly to storage; rejected types, oversize files, failed upload, unavailable AI and empty results are handled; no secret or private original is exposed.
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

Built with task 23 on `frontend/step-3-natural-photo-search`, starting from tasks 22/25 documentation commit `c4207e2`.
Implementation commit: `37110c3` (`Add natural language and private photo search modes`).
The agreed `/search` layout has Keyword, Natural language and Photo options; header search stays keyword-only.
The photo form accepts JPEG, PNG and WebP files larger than zero bytes and up to 5 MB, matching the existing server contract.
It requests a signed POST form and uploads the file directly to private storage, with the file last in FormData and app credentials omitted from the storage request.
No file passes through the web app.
The screen does not render a photo preview, original URL, signed form or private key.
The uploaded key and photo cursor stay in client state rather than the page address; reloading requires choosing a photo again.
Brand, exact price and stock filters apply to the current photo; changing filters resets its cursor.
Best-match results use the existing public product cards, with first/next-page controls and empty results.
Invalid files, refused uploads, unavailable AI and search errors have recovery messages.
Requests have time limits and cleanup aborts pending uploads and reads when the page is hidden.
No backend API, schema or provider behaviour changed.

## Verification approach

The Chrome journey uploads a real PNG to disposable local object storage and observes the existing AI-disabled 503 search response.
Successful photo-result and empty-page responses are controlled browser fixtures containing real server product cards.
The browser also checks rejected file types, oversize files, a refused upload, filter/cursor requests and the absence of the private key from the address and rendered HTML.
Focused helper tests verify the MIME/size contract, direct storage FormData and generic storage errors.
The existing core fake-provider tests separately exercise the real photo-search service and its stored-vector matching.
Real provider embedding success remains unverified until credentials and catalogue embeddings are ready.

## Browser evidence

Ran the shared Chrome command in [task 23](23-natural-search.md#browser-evidence) at 1440 x 900, 768 x 1024 and 390 x 844.
Run `5aaea06e7b4a`: exit 0, `3 passed (48.5s)`; disposable resources were cleaned.
SVG and files over 5 MB were rejected before upload.
A controlled refused-storage response showed a generic recovery message without leaking its response text.
A real signed form and storage POST uploaded a PNG directly to the isolated object store.
The subsequent real photo-search route returned its expected AI-disabled unavailable state.
Controlled result/empty-page responses then verified photo filters, exact paise, next/first cursor requests and product-card navigation.
The private uploaded key was absent from the address and rendered HTML, and no original-photo image was rendered.
Light/dark accessibility and horizontal-overflow checks passed at all three sizes; reviewed screenshots across the agreed sizes.

## Repository checks

Ran the shared `pnpm check` gate after the browser launcher exited: exit 0.
Formatting, lint, typecheck, all 1,289 tests and the production build passed.
Package output: core `996 passed`, web `282 passed`, worker `11 passed`.
The helper tests verify the exact server size/MIME contract, omit app credentials from storage, put the file last in FormData and keep private storage errors out of user messages.
Build output included `Compiled successfully in 9.5s` and `Generating static pages ... (108/108)`.
The fetched `origin/main` at `10fbc5f` is an ancestor of this branch.
No required local check remains deferred; real-provider embedding success remains a release check requiring credentials and catalogue data.
