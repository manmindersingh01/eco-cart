# T04: Admin seller management

| Field | Value |
| --- | --- |
| Status | `not_started` |
| Implemented | No |
| Depends on | T03 |
| Blocks | T09 |

## Goal

Let administrators create sellers, find and inspect them, maintain business details, and control the seller lifecycle safely.

## API contract

- `GET /api/admin/sellers?status=&cursor=&limit=` returns `{ items, nextCursor }` newest first.
- Status filters are `pending`, `approved`, and `suspended`.
- `POST /api/admin/sellers` creates a business and owner account and returns `{ seller }` with status 201.
- `GET /api/admin/sellers/{id}` returns `{ seller }` including owner email, name, phone, banned state, and ban reason.
- `PATCH /api/admin/sellers/{id}` returns the updated `{ seller }`.
- `POST /api/admin/sellers/{id}/approve` approves a valid pending seller.
- `POST /api/admin/sellers/{id}/suspend` accepts `{ reason }`.
- `POST /api/admin/sellers/{id}/reinstate` restores a suspended seller.

Creation collects:

- display name and legal name;
- GSTIN and PAN when known;
- address line, city, state code, and PIN code;
- support email and phone;
- invoice prefix;
- optional seller-specific commission in basis points;
- owner name, email, and optional Indian mobile number.

## Deliverables

- Build `/admin/sellers` with status tabs or filter, newest-first results, empty state, and cursor pagination.
- Build `/admin/sellers/new` with grouped owner, identity, tax, address, contact, invoice, and commission fields.
- Build `/admin/sellers/[id]` with status, owner, business details, tax information, address, commission, timestamps, and lifecycle controls.
- Allow administrators to edit every field permitted by `businessUpdate`.
- Require GSTIN and PAN before approval and display backend issues when either is missing or inconsistent.
- Require a typed or clearly acknowledged reason before suspension.
- Confirm suspension, reinstatement, approval, invoice-prefix changes, and other high-impact mutations.
- Refresh server data after each lifecycle mutation.

## State and conflict handling

The list filter belongs in the URL so refresh and sharing preserve it.
The opaque cursor may also live in the URL, but do not attempt to decode it.
Use `nextCursor` for forward pagination and retain a client-side stack of prior URLs for Back within the current visit.

Display 409 conflicts without discarding form values.
Examples include duplicate owner email, duplicate invoice prefix, and an invoice prefix that can no longer change.
If a record changed on the server, offer a reload after showing the error.

## Acceptance criteria

- An admin can create a pending seller and open its detail page.
- Invalid tax and address combinations show the backend's exact issues.
- Seller list status filtering and multiple cursor pages work.
- Detail shows owner contact and ban state without exposing private session data.
- Approval succeeds only when the backend requirements are met.
- Suspension requires a reason and visibly changes the status.
- Reinstatement visibly returns the seller to approved.
- Form values survive validation and conflict responses.
- Lifecycle controls match the current state and impossible actions are absent or disabled with an explanation.
- Phone and desktop presentations remain readable.

## Verification plan

- Test form serialization, nullable GSTIN/PAN/commission fields, and issue placement.
- Test status-filter URL state and cursor behavior.
- Test lifecycle control visibility for pending, approved, and suspended sellers.
- Through the real API, create, edit, approve, suspend, and reinstate one test seller.
- Verify a non-admin cannot use the pages through direct navigation.
- Run web typecheck, lint, relevant tests, and build.

## Completion evidence

Implementation evidence: Pending.

Automated test evidence: Pending.

Manual evidence: Pending.

Notes or deviations: None recorded.
