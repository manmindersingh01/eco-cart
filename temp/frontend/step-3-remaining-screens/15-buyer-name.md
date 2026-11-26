# 15: Buyer display name

Status: complete.
Depends on: None.

## Read first

Read [the shared completion rules](README.md#completion-rules), root AGENTS.md and [handover section 7.6](../../../docs/frontend-handover.md).
Read the matching flow in docs/system-design.md and the existing route handler, service and types before changing a screen.
Verify payloads against the code instead of copying an old plan.

## One-session scope

Add display-name editing to the existing account page with authClient.updateUser. Keep email and phone changes out of scope.

## Acceptance

Name persists after reload; session failures are handled; placeholder phone-account emails are not shown.
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

## Implementation - 26 November 2026

Batched with task 16 on `frontend/step-3-buyer-profile-phone-sign-in`, based on tasks 13/14 documentation commit `8a8a5bd`.
Implementation commit: `93ce779`.
`/account` now shows the buyer's profile instead of redirecting to orders, and account navigation includes Profile.
The page uses the existing buyer access check, including accounts that both buy and sell.
Sign-in details are read-only and placeholder email addresses are replaced with a missing-email message.
The name form calls Better Auth's existing `updateUser({ name })` and trims surrounding spaces.
Successful saves refresh the page and notify the header to reload the account name.
Failed saves preserve the entered name; an expired session offers a sign-in link back to the profile.
Email and phone changes remain outside this task.
No backend contract, authentication schema or migration changed.

## Browser verification

Chrome sizes: 1440 x 900, 768 x 1024 and 390 x 844.

```powershell
$env:E2E_CHROME = '1'
pnpm test:e2e --project=chrome-desktop --project=chrome-medium --project=chrome-phone buyer-profile-phone.spec.ts
```

Run `1127fd176469`: exit 0, `6 passed (2.0m)` across the two tasks.
The preceding run `8a0c817dce6a` exited 1 with the email/profile journey passing at all sizes and the phone journey stopping at a keyboard test that acted on a still-disabled button.
The keyboard test now waits for the method switch to be enabled before pressing Enter.
Checks save names for phone-only and email accounts through Better Auth, verify the current header name, reload the page and navigate away and back.
The update request contains only the trimmed name.
Whitespace-only names are rejected and the contact details remain read-only.
Clearing the real session cookie before saving shows the session-ended message, preserves the draft and offers sign-in back to `/account`.
Signing in again confirms that the failed edit did not change the saved name.
Signed-out users are sent to sign-in; administrators and seller-only accounts cannot open the buyer profile.
Phone-only profiles and page markup do not expose the placeholder email address.
Keyboard access, light/dark accessibility and horizontal-overflow checks passed at all three sizes.
Reviewed desktop dark and mobile light profile screenshots.
Both browser runs cleaned their disposable databases and buckets.

Existing storefront and authentication regression:

```powershell
pnpm test:e2e --project=chrome-desktop foundation.spec.ts --grep 'P0[13]'
```

Run `38e802ace1ad`: exit 0, `3 passed (1.2m)`.
Public navigation, protected-route redirects, email code sign-in, buyer role restrictions and administrator settings remained green.

## Repository verification

```text
pnpm check
All matched files use Prettier code style!
Lint: exit 0
Typecheck: core, web and worker Done
Core: 75 files passed; 996 tests passed
Web: 51 files passed; 264 tests passed
Worker: 1 file passed; 11 tests passed
Build: Compiled successfully in 9.5s
Generating static pages (100/100)
```

Final exit 0.
The first gate identified the focus-effect dependency fixed and rechecked under task 16; the complete gate then passed.
`git diff --check` passed.
Fetched origin and verified `origin/main` at `10fbc5f` is included, so no integration conflict remained.
No required task 15 checks are deferred.
The unrelated root frontend-handover.md and remarks2.md remain untouched.
