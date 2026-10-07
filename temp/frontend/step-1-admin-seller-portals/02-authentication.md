# T02: Authentication and role access

| Field | Value |
| --- | --- |
| Status | `implemented_pending_manual_verification` |
| Implemented | No - code and automated checks pass; browser verification remains |
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

Implementation evidence:

- Added the Better Auth React client with `emailOTPClient` in `apps/web/src/lib/auth-client.ts`.
- Added safe return-path validation, role destinations, and shared account types in `apps/web/src/lib/auth-routing.ts`.
- Added server-only admin and seller page guards in `apps/web/src/lib/page-auth.ts`.
- Added `apps/web/src/proxy.ts` to preserve the exact protected path for a signed-out redirect.
  The proxy only copies the path into a request header; session and role checks remain in the server layouts.
- Added the two-stage sign-in form in `apps/web/src/components/auth/sign-in-form.tsx`.
- Added shared account and sign-out controls in `apps/web/src/components/auth/account-controls.tsx`.
- Added `/sign-in` and `/access-denied` pages.
- Protected the administrator and seller layouts before their portal shell is returned.
- Added account controls to the storefront and both portal headers.
- No dependency, database schema, or backend API change was needed.

Automated test evidence, 8 October 2026:

- `pnpm --filter @ecokart/web typecheck` passed after route type generation.
- `pnpm lint` passed with no findings.
- `pnpm --filter @ecokart/web test` passed 11 test files and 63 tests.
- The focused routing tests prove accepted internal return paths, rejected external and protocol-relative paths, role defaults, safe return-path priority, and portal role matching.
- Existing tests prove `/api/me` behavior for buyer, seller, administrator, signed-out, and seller-without-business cases.
- `pnpm --filter @ecokart/web build` compiled successfully.
  The build contains `/sign-in`, `/access-denied`, dynamic `/admin` and `/seller` routes, and the Next.js proxy.

Real local-service evidence, 8 October 2026:

- Started the web app and worker against the healthy Docker PostgreSQL, Mailpit, and object-storage services.
- Requested an email code for a new buyer and read the delivered message through Mailpit without printing or logging the code.
- A wrong six-digit code returned HTTP 400 and the valid code then signed the buyer in.
- `/api/me` returned the expected `buyer`, `seller`, and `admin` roles for three real sessions.
- A signed-out `/admin?tab=company` request produced a Next.js redirect instruction for `/sign-in?returnTo=%2Fadmin%3Ftab%3Dcompany`.
- Buyer-to-admin, seller-to-admin, and admin-to-seller requests produced role-specific `/access-denied` redirects.
- The matching seller and administrator portals rendered for their roles.
- Sign-out returned HTTP 200 and the same session then received HTTP 401 from `/api/me`.
- Temporarily suspended the seeded first seller through the real administrator API.
  Their existing seller session returned to `/sign-in?returnTo=%2Fseller&reason=session-ended`.
  The seller was immediately reinstated through the real API, which returned HTTP 200.
- Created the development-only administrator `auth-check-admin@ecokart.test` with `pnpm admin:create` for these checks.

Manual evidence: Pending for browser rendering, the visible resend countdown, and keyboard announcements.

### Manual verification steps

1. Run `pnpm dev` and open `http://localhost:3000` in a private browser window.
2. Open `/admin?tab=company` while signed out.
3. Confirm the browser reaches `/sign-in` and the address contains the encoded `returnTo=/admin?tab=company` value.
4. Enter a new address such as `browser-check-<current-time>@ecokart.test` and select **Send sign-in code**.
5. Open Mailpit at `http://localhost:8025`, find the newest message for that exact address, and confirm the page says the code expires after five minutes.
6. Enter a wrong six-digit code once.
7. Confirm the backend error is announced, remains visible, and the form stays on the code step.
8. Enter the valid code from Mailpit.
9. Confirm this new buyer returns to `/admin?tab=company` and then reaches the access-denied page because a buyer cannot use the administrator portal.
10. Sign out from the public header and confirm `/api/me` returns 401 in the browser network panel.
11. Start again with another new address, wait for the **Resend code** countdown to reach zero, and select it.
12. Confirm the email field is unchanged, a new Mailpit message arrives, and the newest code signs in.
13. After the local rate-limit window has reset if needed, sign in as `auth-check-admin@ecokart.test` and confirm `/admin` renders while `/seller` shows access denied.
14. Sign out, then sign in as `seller2@ecokart.test` and confirm `/seller` renders while `/admin` shows access denied.
15. Repeat the sign-in, resend, error, and sign-out flow using only Tab, Shift+Tab, Enter, Space, and pasted code text.
16. Confirm focus is visible, the code input accepts paste, pending buttons disable, errors are announced, and the phone and desktop layouts have no clipping or horizontal overflow.
17. Repeat the visual and keyboard checks in the latest Chrome and Safari at a 390 by 844 phone viewport and a 1280 pixel or wider desktop viewport.
18. Record the browser versions, routes, viewports, and results here.
19. If every check passes, change `Status` to `complete`, change `Implemented` to `Yes`, and update T02 in `README.md` to `Yes`.

Notes or deviations:

- The current Vitest environment is Node-based and has no browser DOM or component-testing library.
  Form transitions were verified through typecheck, lint, production compilation, backend tests, pure routing tests, and the real HTTP and Mailpit flow.
- Next.js Server Component redirects can keep HTTP 200 after streaming begins.
  The response contains a `NEXT_REDIRECT` instruction with status 307, and the browser follows it before the protected layout is mounted.
- Repeated automated OTP checks consume the local five-codes-per-address hourly limit.
  Wait for the hour window to reset before manually reusing the administrator or seeded seller address if Mailpit receives no new code.
