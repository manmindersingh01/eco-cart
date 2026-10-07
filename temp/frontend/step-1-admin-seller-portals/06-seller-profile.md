# T06: Seller shell and profile

| Field | Value |
| --- | --- |
| Status | `not_started` |
| Implemented | No |
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

Implementation evidence: Pending.

Automated test evidence: Pending.

Manual evidence: Pending.

Notes or deviations: None recorded.
