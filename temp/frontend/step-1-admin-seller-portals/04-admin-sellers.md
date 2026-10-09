# T04: Admin seller management

| Field | Value |
| --- | --- |
| Status | `implemented_pending_manual_verification` |
| Implemented | No - code and automated checks pass; final browser verification is deferred |
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

Implementation evidence, 9 October 2026:

- Added Sellers to the protected administrator navigation and added the delivered seller tool to the administrator overview.
- Built `/admin/sellers` as a server-rendered, newest-first seller list with All, Pending, Approved, and Suspended URL filters.
- Added responsive desktop table and phone card presentations with seller status, business names, location, creation date, and detail links.
- Added opaque cursor pagination.
  Next stores the current cursor in session storage and Previous restores earlier pages from the current browser visit without decoding a cursor.
- Built `/admin/sellers/new` with grouped owner account, business identity, tax, address, support, invoice, and commission fields.
- Added exact nullable serialization for GSTIN, PAN, owner mobile, and seller commission.
  Percentages are converted to integer basis points without floating-point multiplication.
- Built `/admin/sellers/[id]` with status and reason, owner contact and ban state, tax and invoice details, registered address, support contacts, commission, slug, and timestamps.
- Added editing for every field accepted by the backend `businessUpdate` schema.
- Added explicit confirmation for legal name, GSTIN, PAN, state-code, and invoice-prefix edits.
- Added confirmed approval, suspension, and reinstatement controls that only appear for the applicable lifecycle states.
- Suspension needs a non-empty typed reason before its confirmation can open.
- Every successful edit or lifecycle action fetches the current seller again and refreshes the route.
  This keeps owner ban state, backend-normalised values, status, and timestamps current.
- Validation issues remain in the form summary and are also placed beside matching owner and business fields.
- HTTP 409 conflicts keep form values and offer a full reload of the current seller.
- Added 401 session recovery with a safe return path and retained the existing server-side administrator guard for every page.
- Extended the shared confirmation dialog with disabled trigger and confirmation states for pending and incomplete actions.

Important files:

- `apps/web/src/app/admin/sellers/page.tsx`
- `apps/web/src/app/admin/sellers/new/page.tsx`
- `apps/web/src/app/admin/sellers/[id]/page.tsx`
- `apps/web/src/components/admin/new-seller-form.tsx`
- `apps/web/src/components/admin/seller-form-fields.tsx`
- `apps/web/src/components/admin/seller-detail-manager.tsx`
- `apps/web/src/components/admin/seller-pagination.tsx`
- `apps/web/src/lib/admin-sellers.ts`
- `apps/web/src/lib/admin-sellers.test.ts`

Automated test evidence, 9 October 2026:

- `pnpm --filter @ecokart/web typecheck` passed after Next.js route generation.
- `pnpm lint` passed with no findings.
- `pnpm --filter @ecokart/web test` passed 13 test files and 74 tests.
- New tests prove nullable creation fields, commission conversion, status-and-cursor URL construction, lifecycle control visibility for all three statuses, and detection of high-impact edits.
- Existing web route tests prove create, owner detail, edit, approve, suspend, suspended approval conflict, reinstate, status filtering, pagination, invalid detail issues, 404, 401, and 403 responses.
- `pnpm --filter @ecokart/core test` passed 24 test files and 299 tests.
  The core seller tests cover multi-page cursors, tax relationships, audit entries, unique details, account cleanup, invoice-prefix locking after the first invoice, and lifecycle idempotency.
- `pnpm --filter @ecokart/web build` compiled successfully.
  The production route table contains dynamic `/admin/sellers`, `/admin/sellers/new`, and `/admin/sellers/[id]` pages.

Real local-service evidence, 9 October 2026:

- Confirmed the local PostgreSQL, Mailpit, and object-storage containers were healthy.
- Signed in the development administrator through the real email-code flow without printing or logging the code.
- Submitted mismatched GST state and address details and received HTTP 400 with the exact GSTIN issue before any account was created.
- Created pending seller `36e9c029-8a77-4d63-83a6-d50c72085c06` and confirmed its detail response contained the expected owner email and unbanned state.
- Edited its city and commission through the real PATCH route, then approved it.
- Suspended it with `T04 lifecycle verification` and confirmed the owner account became banned.
- Attempting approval while suspended returned HTTP 409.
- Reinstated it to approved and confirmed the owner account became unbanned.
- Requested a one-item seller page, followed its opaque `nextCursor`, and received a distinct second page.
- The approved filter returned only approved sellers and included the verification seller.
- The protected detail page server-rendered the business name and owner email.
- A newly signed-in buyer received HTTP 403 from the administrator seller API and an administrator access-denied page.
- A signed-out seller-list API request received HTTP 401.
- The verification seller remains in the local development database in approved state for the deferred browser pass.

Manual evidence: Deferred until the final combined Chrome and Safari pass requested by the developer.

### Deferred manual verification steps

1. Run `pnpm dev` and sign in as `auth-check-admin@ecokart.test` using the newest Mailpit code.
2. Open `/admin` and confirm Sellers appears in the portal navigation and as an available tool.
3. Open `/admin/sellers` in the latest Chrome at 1280 pixels or wider.
4. Confirm the All, Pending, Approved, and Suspended filters update the `status` query parameter and retain their state after refresh.
5. Confirm each row shows display name, legal name, location, status text and colour, creation date, and a working detail link.
6. If the development database has more than 20 sellers, use Next page twice and Previous page twice.
   Confirm `cursor` remains opaque in the URL and Previous returns to the exact earlier page within the current visit.
7. Open `/admin/sellers/new` and submit invalid GSTIN, PAN, state-code, PIN-code, support-phone, and owner-mobile values.
8. Confirm the backend messages remain visible beside their fields and all entered values remain in the form.
9. Try a GSTIN whose embedded PAN differs from the PAN field and then one whose first two digits differ from the address state code.
   Confirm the exact relationship issue appears beside GSTIN.
10. Try an owner email already used by another account and an invoice prefix already used by another seller.
    Confirm the form keeps every entered value after the backend refusal.
11. Create a pending seller without GSTIN, PAN, owner mobile, or seller commission.
12. Confirm its detail page opens and shows pending status, owner contact, unbanned state, missing tax values, platform-default commission, address, support contacts, and timestamps.
13. Select Approve seller, confirm the dialog, and confirm the exact missing GSTIN and PAN issues appear.
14. Add matching GSTIN and PAN, save, and confirm the high-impact-change prompt appears before the request is sent.
15. Approve the seller and confirm its visible status changes to Approved and the approval timestamp appears.
16. Change the invoice prefix and cancel the confirmation.
    Confirm no request is sent and the edited value remains available for review.
17. Save a safe support-contact edit and confirm success reloads the backend value without clearing unrelated fields.
18. Confirm Suspend seller is disabled until a reason is typed.
19. Type a reason, open the suspension confirmation, cancel it, and confirm the seller remains approved.
20. Confirm again, complete suspension, and verify status, suspension reason, owner banned state, and ban reason are visible.
21. Confirm approval and suspension controls are absent while suspended and Reinstate seller is present.
22. Reinstate the seller and confirm it returns to Approved, the suspension reason clears, and the owner is no longer banned.
23. During any real HTTP 409 conflict available in the development data, confirm edited values remain and Reload current seller is offered.
24. Repeat the creation, list, detail, edit, dialog, validation, and lifecycle flow using only Tab, Shift+Tab, Space, Enter, and Escape.
25. Confirm dialog focus is trapped, Escape closes safely, focus returns to the trigger, notices are announced, and all controls have visible focus.
26. Repeat the visual checks in the latest Chrome and Safari at 390 by 844 and at 1280 pixels or wider.
27. Confirm the table becomes readable cards on the phone and there is no clipped content or page-level horizontal scrolling.
28. Open `/admin/sellers`, `/admin/sellers/new`, and the detail URL while signed out and while signed in as a buyer or seller.
    Confirm protected seller data never appears and the account reaches sign-in or access denied as appropriate.
29. Record browser versions, routes, viewports, and observed results here during the final combined browser pass.
30. If every check passes, change `Status` to `complete`, change `Implemented` to `Yes`, and update T04 in `README.md` to `Yes`.

Notes or deviations:

- The backend currently reports duplicate owner email and duplicate invoice prefix as HTTP 400 validation responses, although the original frontend plan listed them as HTTP 409 examples.
  The frontend preserves values and issues for both 400 and 409 responses and uses conflict-specific reload recovery for actual 409 responses.
- The current Vitest environment is Node-based and has no browser DOM or component-testing library.
  UI behavior is covered by pure frontend tests, existing route tests, typecheck, lint, production compilation, server-rendered page checks, and the real API lifecycle, with the combined browser pass deferred as requested.
