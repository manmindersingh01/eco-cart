# 16: Phone sign-in

Status: complete.
Depends on: None.

## Read first

Read [the shared completion rules](README.md#completion-rules), root AGENTS.md and [handover section 7.6](../../../docs/frontend-handover.md).
Read the matching flow in docs/system-design.md and the existing route handler, service and types before changing a screen.
Verify payloads against the code instead of copying an old plan.

## One-session scope

Add phoneNumberClient and a phone OTP option to sign-in using the existing Better Auth plugin. Preserve email sign-in and returnTo handling.

## Acceptance

Local codes arrive in Mailpit; invalid, expired and rate-limited codes show useful messages; phone-only accounts do not expose placeholder emails.
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

Batched with task 15 on `frontend/step-3-buyer-profile-phone-sign-in`, based on tasks 13/14 documentation commit `8a8a5bd`.
Implementation commit: `93ce779`.
Added Better Auth's existing phone client plugin and a phone option to the current sign-in form.
The server supplies the phone-availability flag from the existing authentication configuration, so the option is hidden while SMS is disabled.
Indian mobile input accepts ten digits or the +91 form and is sent in E.164 format.
Phone and email sign-in share code entry, resend cooldown, pending controls, role-based destinations and safe return URLs.
Wrong, expired, exhausted and rate-limited codes have plain-language messages.
The profile and existing current-account API hide phone-only placeholder emails.
No backend contract, server authentication plugin, schema or migration changed.

## Browser verification

Chrome sizes: 1440 x 900, 768 x 1024 and 390 x 844.

```powershell
$env:E2E_CHROME = '1'
pnpm test:e2e --project=chrome-desktop --project=chrome-medium --project=chrome-phone buyer-profile-phone.spec.ts
```

Run `1127fd176469`: exit 0, `6 passed (2.0m)` across the two tasks.
The initial run `8a0c817dce6a` exited 1 because the phone keyboard test acted before its button was enabled; adding an enabled-state wait fixed the test.
The email/profile journey passed in both runs at every size.
Phone checks cover keyboard method selection, rejection of a non-Indian number, normalisation of ten digits to +91, resend cooldown and wrong-code rejection by the actual server.
The worker delivers the real phone code to the local Mailpit SMS inbox, and verification creates a buyer session and honours the `/account` return URL.
The resulting current-account response has a null email, and the profile and markup hide the placeholder address.
Expired-code and rate-limit responses are simulated to check their messages without waiting five minutes or exhausting recipient limits.
Those backend rules are also covered by the existing authentication tests in the full repository check.
The successful phone delivery, verification, email sign-in and session-expiry checks use real local services.
Keyboard access, light/dark accessibility and horizontal-overflow checks passed at all three sizes.
Reviewed the medium light phone sign-in screenshot.
Both browser runs cleaned their disposable databases and buckets.
Production SMS delivery remains for the separately configured provider; local verification does not claim real SMS delivery.

Existing storefront and authentication regression:

```powershell
pnpm test:e2e --project=chrome-desktop foundation.spec.ts --grep 'P0[13]'
```

Run `38e802ace1ad`: exit 0, `3 passed (1.2m)`.
Public navigation, protected-route redirects, email code sign-in, buyer role restrictions and administrator settings remained green.

Lint identified an extra focus-effect dependency.
The phone input now has a separate focus reference, which makes the selected method explicit in that effect.
Reran the complete phone journey after this refactoring:

```powershell
pnpm test:e2e --project=chrome-desktop buyer-profile-phone.spec.ts --grep BP01
```

Run `c9883ff5158c`: exit 0, `1 passed (14.0s)`.
The keyboard method switch, code focus, real SMS-code delivery and profile journey still pass with the final focus handling.

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

Final exit 0 after the focus-effect lint fix described above.
`git diff --check` passed.
Fetched origin and verified `origin/main` at `10fbc5f` is included, so no integration conflict remained.
No required local task 16 checks are deferred.
Live SMS-provider delivery remains unverified, as described above.
The unrelated root frontend-handover.md and remarks2.md remain untouched.
