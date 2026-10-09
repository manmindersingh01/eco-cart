# T06: Seller shell and profile

| Field | Value |
| --- | --- |
| Status | `implemented_pending_manual_verification` |
| Implemented | No - code and automated checks pass; final browser verification is deferred |
| Depends on | T01, T02 |
| Blocks | T07 |

## Goal

Create the protected seller experience and let sellers view their full business record while editing only their allowed contact fields.

## API contract

- `GET /api/seller/profile` returns `{ seller }`.
- `PATCH /api/seller/profile` accepts any non-empty subset of `displayName`, `supportEmail`, and `supportPhone`.
- The response is the updated `{ seller }`.
- A non-seller receives 403.
- A suspended seller cannot establish a usable seller session.

The view includes status, display and legal names, GSTIN, PAN, address, contacts, invoice prefix, optional commission, approval date, suspension reason, and timestamps.

## Deliverables

- Add a responsive seller layout with account context, navigation, and sign-out.
- Build `/seller` as a concise landing page for profile and catalogue work that exists now.
- Build `/seller/profile` with clear read-only legal/business sections.
- Add an edit form only for display name, support email, and support phone.
- Explain that an administrator maintains legal, tax, address, invoice, and commission details.
- Show pending, approved, and suspended status consistently.
- Show the platform commission fallback when the seller-specific value is null without claiming a numeric value that the API did not return.
- Surface a suspension reason when available without offering inaccessible actions.

## Acceptance criteria

- Only a valid seller session can render the seller shell.
- The full business profile is readable without making restricted fields look editable.
- The three editable contact fields save independently or together.
- Empty changes are not submitted.
- Backend email and phone validation issues appear beside the relevant field.
- A nullable commission displays as `Platform rate` rather than zero.
- Pending status explains that drafts may be created while public selling waits for approval.
- Approved status links to catalogue management.
- Direct access by admin, buyer, and signed-out users follows the access behavior from T02.
- Phone and desktop layouts are usable with keyboard navigation.

## Verification plan

- Test editable-field serialization and unchanged-form behavior.
- Test status and nullable commission presentation.
- Through the real API, sign in as `seller1@ecokart.test`, load the profile, update a support contact, and confirm the saved value after refresh.
- Verify direct access as a non-seller.
- Run web typecheck, lint, relevant tests, and build.

## Completion evidence

Implementation evidence, 9 October 2026:

- Expanded the protected seller shell with Overview and Business profile navigation plus the existing account context and sign-out control.
- Replaced the seller placeholder with a server-rendered overview containing the business name, current status guidance, profile access, and an honest description of the next catalogue task.
- Built `/seller/profile` with server-side seller authentication and a direct call to the seller service for the initial profile.
- Added read-only business identity, legal name, slug, GSTIN, PAN, invoice prefix, approval time, registered address, commission, status, and record dates.
- A null seller commission is shown as `Platform rate` and is never presented as zero.
- Pending, approved, and suspended statuses have distinct text labels, colours, and plain-language explanations.
- A suspension reason is displayed when profile data contains one, without presenting a seller lifecycle action.
- Added a contact form containing only display name, support email, and support phone.
- The form compares current values with the last saved values, disables an unchanged submission, and sends only fields that changed.
- Backend email and phone issues are placed beside their matching fields and retained in the form summary.
- A successful update replaces the displayed profile and editable values with the backend response, including its updated timestamp.
- HTTP 401 returns safely to sign-in for `/seller/profile`, and HTTP 403 reaches the existing seller access-denied route.
- The profile explains that an administrator maintains legal, tax, address, invoice, and commission details.

Important files:

- `apps/web/src/app/seller/layout.tsx`
- `apps/web/src/app/seller/page.tsx`
- `apps/web/src/app/seller/profile/page.tsx`
- `apps/web/src/components/seller/profile-manager.tsx`
- `apps/web/src/lib/seller-profile.ts`
- `apps/web/src/lib/seller-profile.test.ts`

Automated test evidence, 9 October 2026:

- `pnpm --filter @ecokart/web typecheck` passed after Next.js route generation.
- `pnpm lint` passed with no findings.
- `pnpm --filter @ecokart/web test` passed 15 test files and 85 tests in 7.99 seconds.
- New tests prove unchanged forms produce no PATCH body, one or all three editable fields serialize correctly, null commission uses `Platform rate`, and each seller status receives the intended presentation.
- Existing web route tests prove seller profile access, contact updates, rejection of restricted tax fields, seller suspension session revocation, signed-out 401, and buyer 403 responses.
- `pnpm --filter @ecokart/core test` passed 24 test files and 299 tests in 17.29 seconds.
- The core seller tests cover own-profile reads, partial contact updates, validation, audit entries, role refusal, and the full seller lifecycle.
- `pnpm --filter @ecokart/web build` compiled successfully and produced dynamic `/seller` and `/seller/profile` routes.

Real local-service evidence, 9 October 2026:

- Confirmed the local PostgreSQL, Mailpit, and object-storage containers were healthy and used the already-running web and worker processes.
- Signed in as `seller1@ecokart.test` through the real email-code flow without printing or logging the code or session value.
- Loaded the real profile and confirmed the seeded seller was approved.
- Submitted an invalid support email and received HTTP 400 with a field-addressable `supportEmail` issue.
- Updated only the support phone, confirmed the PATCH response, and confirmed the saved value again through a fresh GET.
- Confirmed `/seller` and `/seller/profile` server-rendered the signed-in seller's identity.
- Restored the original support phone after verification so the seeded seller data did not remain changed.
- Confirmed a signed-out profile request received HTTP 401.
- Signed in with a development-only buyer account and confirmed the seller profile API received HTTP 403 and the protected page returned the seller access-denied instruction.

Manual evidence: Deferred until the final combined Chrome and Safari pass requested by the developer.

### Deferred manual verification steps

1. Run `pnpm dev` and sign in as `seller1@ecokart.test` using the newest code in Mailpit.
2. Open `/seller` and confirm the portal header shows the signed-in account, the navigation includes Overview and Business profile, and Sign out is available.
3. Confirm the overview greets the seller by business display name and shows the Approved badge and approved guidance.
4. Confirm the Business profile card opens `/seller/profile` and the catalogue card is clearly labelled as the next frontend task rather than linking to a missing page.
5. Open `/seller/profile` in the latest Chrome at 1280 pixels or wider.
6. Confirm the page shows status, display and legal names, seller URL name, GSTIN, PAN, invoice prefix, commission, approval date, registered address, support contacts, creation date, and update date.
7. Confirm the commission says `Platform rate` for a seller whose `commissionBps` is null and never says zero.
8. Confirm legal name, slug, GSTIN, PAN, invoice prefix, commission, approval date, and address appear as read-only text without editable-looking controls.
9. Confirm the explanation clearly says an administrator maintains legal, tax, address, invoice, and commission details.
10. Change only the display name and save.
    Confirm the saved name immediately updates both the read-only summary and editable field.
11. Change only the support email and save.
    Confirm the support phone and display name remain unchanged.
12. Change only the support phone and save.
    Confirm the support email and display name remain unchanged.
13. Change all three editable fields together and confirm the backend response replaces every displayed value.
14. Return all fields to the last saved values and confirm Save contact details is disabled.
15. Enter an empty display name, invalid email, and non-E.164 phone separately.
    Confirm each exact backend issue appears beside its field and in the form summary without clearing any entered values.
16. While a save request is pending, confirm all three fields and the submit button are disabled and the button says `Saving...`.
17. Allow the session to end or sign out in another tab, then try to save.
    Confirm the browser reaches sign-in with a safe `/seller/profile` return path and session-ended reason.
18. Repeat the overview, profile reading, editing, validation, and sign-out flow using only Tab, Shift+Tab, Space, and Enter.
19. Confirm focus is visible, notices are announced, labels target their inputs, and disabled controls remain understandable.
20. Repeat the visual checks in the latest Chrome and Safari at 390 by 844 and at 1280 pixels or wider.
21. Confirm cards become a readable single column on a phone and there is no clipped text or page-level horizontal scrolling.
22. Open `/seller` and `/seller/profile` while signed out and while signed in as a buyer or administrator.
    Confirm seller data never appears and the account reaches sign-in or seller access denied as appropriate.
23. If a pending seller is available, open both routes and confirm the Pending label explains that draft preparation is allowed while public selling waits for approval.
24. A suspended seller normally cannot establish a usable session.
    Suspend a disposable seller from an administrator session and confirm its existing session is ended before protected seller content renders.
25. Record browser versions, routes, viewports, and observed results here during the final combined browser pass.
26. After T07 supplies `/seller/products`, confirm an approved overview links to catalogue management.
27. If every check passes, change `Status` to `complete`, change `Implemented` to `Yes`, and update T06 in `README.md` to `Yes`.

Notes or deviations:

- The plan asks an approved status to link to catalogue management, but `/seller/products` belongs to T07 and does not exist yet.
  The overview shows an honest catalogue card without a dead link, and T07 must add the link when it delivers that route.
- Suspended seller sessions are revoked and `requireSeller` rejects any surviving session before the seller shell renders.
  The shared status presentation and profile component still support a suspended record for consistent display, while the access guard remains authoritative.
- The current Vitest environment is Node-based and has no browser DOM or component-testing library.
  UI behavior is covered by pure frontend tests, existing route tests, typecheck, lint, production compilation, server-rendered page checks, and the real HTTP workflow, with the combined browser pass deferred as requested.
- The real access check created one development-only buyer account for the non-seller session.
