# 09: Returns, refunds, bank details, ledger and statements

| Field | Value |
| --- | --- |
| Status | Planned |
| Implemented | No |
| Depends on | 08 |
| Blocks | Financial operations readiness |

## Backend available after integration

Read design sections 5.9, 6.5, 6.6 and 8, newer `modules/returns`, ledger bank-account/ledger/statement services and route tests.
Reuse `/api/account/returns`, return-photo upload/register/detail/private download, seller return views and administrator approve/reject/refund actions.
Reuse seller bank-account/ledger/settlement-statement routes and admin seller balances, bank account, ledger, payouts, adjustments and statements.
Inspect the refund contract carefully: the inspected service records a gateway refund already made or a bank transfer reference; a button must not promise to move money unless the integrated contract actually does so.

## Frontend work

Add return eligibility and request actions from delivered order lines using server-derived remaining quantities and return-window policy.
Add proposed `/account/returns` and `/account/returns/[id]` with reason, quantity, optional evidence photos and status/history.
Upload evidence directly to storage and poll sanitation; only attach owned eligible photos.
Add proposed `/seller/returns` for own-line visibility and required actions supported by the service.
Add proposed `/admin/returns` and detail with accept/reject notes, refundable amount, refund method/reference and explicit confirmation.
Keep refund due, refund recorded and payment refunded distinct according to the backend.

Add a read-only masked bank summary for sellers and an authorised administrator editor on seller detail.
Do not expose or prefill full stored account numbers if the DTO deliberately returns only last four digits.
Add proposed `/seller/earnings` with current balance, signed entries, filters/keyset pagination and downloadable statements.
Add proposed `/admin/settlements` with balances, bank setup blockers, payout reference/amount confirmation, adjustments with required reasons and statement generation/status/download.
Describe payout actions as recording a bank transfer where that is the implemented contract.
Display negative balances honestly; never imply all balances are withdrawable.
Preserve append-only entries and show corrections as new adjustments.
Use Asia/Kolkata dates and inclusive statement ranges according to service validation.

## Backend work

Integrate existing returns/refund/ledger/statement capabilities before writing duplicate services.
Verify cancellation and return refund effects reconcile with original sale/commission entries and remaining refundable amounts.
Preserve private bank details, audit records, idempotent references, signed statement files and worker-generated output.
Fix only a demonstrated gap, with a reproducing integration test first.

## Automated acceptance

| ID | Scenario | Required result |
| --- | --- | --- |
| R01 | Eligible partial return, expired window, too-large quantity | Correct allowed amount/quantity; invalid requests refused |
| R02 | Upload own evidence and attempt another user's photo | Sanitised private evidence only; cross-user attach/download refused |
| R03 | Approve/reject/refund with duplicate request and stale status | Valid transition once, readable notes/conflicts, no duplicate refund |
| R04 | COD bank refund versus gateway refund reference | Contract-appropriate fields; no claim that the UI sent money |
| R05 | Partial repeated refunds and commission reversal | Reconciles to original sale; never reverses more than remaining amount |
| R06 | Bank edit/read as admin, seller and other seller | Masked reads only; write permissions and audit proven |
| R07 | Duplicate payout reference, amount over allowed balance, concurrent payouts | Service policy enforced without double debit |
| R08 | Positive/negative adjustment and statement period boundary | Append-only ledger; accurate balance/CSV totals and India dates |
| R09 | Statement processing/failure/ready/download expiry | Clear recovery, private signed download, no cross-seller access |

Add proposed `e2e/returns.spec.ts`, `settlements.spec.ts` and statement download assertions.
Use isolated test orders and fake gateway refund responses only where the server actually verifies them.
Retain real database tests for accounting, locking and RLS.
Run relevant core/web/worker tests, lint/typecheck, browser suites and the integrated demo's return/ledger steps.
Completion evidence is pending.
