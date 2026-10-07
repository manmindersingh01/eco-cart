# T02: Authentication and role access

| Field | Value |
| --- | --- |
| Status | `not_started` |
| Implemented | No |
| Depends on | T01 |
| Blocks | T03, T06 |

## Goal

Implement email-code sign-in, sign-out, account display, safe return paths, and server-side role protection for admin and seller routes.

## API contract

- Send a code with `POST /api/auth/email-otp/send-verification-otp` through Better Auth's `emailOTPClient`.
- Verify a code with `POST /api/auth/sign-in/email-otp` through the same client.
- Read the current account from `GET /api/me`.
- The account contains `id`, `name`, `email`, `phoneNumber`, `role`, and `sellerId`.
- Signed out returns 401.
- A seller account without a linked seller returns 403 with `Seller account is not set up yet`.

## Deliverables

- Add the Better Auth React client in one browser-only module.
- Build `/sign-in` as one accessible two-stage form for email then six-digit code.
- Support resend with a visible cooldown and explain the five-minute code lifetime.
- Preserve only a validated same-origin relative `returnTo` path.
- Route an admin to `/admin`, a seller to `/seller`, and a buyer to `/` after sign-in when no return path is present.
- Add account and sign-out controls to the shared headers.
- Add server helpers that resolve the current session and enforce admin or seller roles before protected content renders.
- Redirect a signed-out protected request to `/sign-in?returnTo=...`.
- Show a clear access-denied result for the wrong signed-in role.
- Ensure a suspended seller's rejected session returns to sign-in with an appropriate message.

## Security and behavior rules

Do not trust a role cached in browser storage.
Do not use client-only route guards for protected pages.
Do not place an arbitrary absolute URL into `returnTo`.
Do not reveal whether an email address already has an account.
Do not log an OTP or put it into a URL.
Use `autocomplete="email"` for email and `autocomplete="one-time-code"` with numeric input mode for the OTP.
Allow paste into the OTP input.

Expected sign-in states:

- entering email;
- requesting code;
- code sent;
- verifying code;
- invalid or expired code;
- rate limited;
- signed in and redirecting;
- service unavailable.

## Acceptance criteria

- A valid email receives a code in Mailpit and signs in successfully.
- A wrong code displays the backend message and keeps the user on the verification step.
- Resend works without clearing the email and respects the disabled cooldown.
- Refreshing a protected admin or seller URL never flashes protected content to the wrong role.
- Admin, seller, buyer, signed-out, and malformed seller-account states each reach the correct destination.
- Sign-out invalidates the session and returns to the public area.
- `returnTo` accepts an internal route and rejects protocol-relative or external values.
- The flow works with keyboard only and announces form errors.

## Verification plan

- Unit test return-path validation and role destination selection.
- Component test the email, OTP, resend, error, and pending states where the current test stack supports it.
- Exercise the real Mailpit flow with a seeded seller and a local administrator.
- Verify admin, seller, buyer, and signed-out route protection through direct URL entry.
- Run web typecheck, lint, relevant tests, and a production build.

## Completion evidence

Implementation evidence: Pending.

Automated test evidence: Pending.

Manual evidence: Pending.

Notes or deviations: None recorded.
