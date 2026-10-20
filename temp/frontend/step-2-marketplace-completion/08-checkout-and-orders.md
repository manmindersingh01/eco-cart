# 08: Checkout, payment, orders, dispatch and invoices

| Field | Value |
| --- | --- |
| Status | Planned |
| Implemented | No |
| Depends on | 07 |
| Blocks | Returns, settlement and release |

## Contracts and source

Read design sections 6.3, 6.4, 6.6 and 8, checkout/payment services, integrated order fulfilment/views/types, invoice services/jobs, Razorpay adapter and existing tests.
Existing checkout routes are `/api/checkout`, `/api/checkout/payment` and `/api/webhooks/razorpay`.
Newer backend includes account/seller/admin order lists/detail/cancel, seller dispatch and delivered actions, administrator shipment delivery, plus invoice list/download/regenerate routes.
Inspect methods and capability fields before choosing enabled controls.
Do not infer order progress from a single guessed status; DTOs distinguish progress, payment state and line status.

## Frontend delivery order

1. Add proposed `/checkout` with saved address selection, current server totals and available payment methods.
2. Support COD when enabled; hide unavailable online payment when keys/configuration are blank.
3. Integrate the actual online checkout adapter and signed return confirmation; prevent repeat submission while pending.
4. Add a result/recovery route that distinguishes pending, confirmed, cancelled and retryable provider failure without claiming success from a browser callback alone.
5. Add proposed `/account/orders` and `/account/orders/[id]` with snapshots, progress, tracking, cancellation and invoices.
6. Add proposed `/seller/orders` and `/seller/orders/[id]` with only own lines and dispatch grouping by line identifiers.
7. Add proposed `/admin/orders` and `/admin/orders/[id]` with payments/events, cancellation reasons and delivery/refund follow-up.
8. Add invoice status/download controls; poll pending PDFs and expose administrator regeneration only where supported.

Send `expectedTotalPaise` as supported so changed totals require renewed confirmation.
Never recompute a payable total in the browser as authoritative.
Recheck minimum quantity at fresh checkout; stale valid carts can become invalid.
Use server `canCancel` and line state guidance, then handle races with a refresh on conflict.
Confirm tracking data and delivery actions; validate HTTPS tracking URLs through the service.
Use frozen order prices, address, seller/title/options/tax values, never current product metadata to rewrite historical order lines.
Respect `?as=seller` for shared private invoice downloads when required.
Explain PDF processing/error states and request a fresh signed URL when expired.

## Backend work

Integrate existing fulfilment/payment/invoice code and fix only demonstrated contract gaps.
Preserve conditional stock/coupon updates, product-before-variant lock ordering and compensation on provider setup failure.
Both webhook and browser confirmation must call the one idempotent payment confirmation service.
The UI must not add another order-confirmation mutation path.
Keep raw webhook signature validation before payload interpretation.

## Automated acceptance

| ID | Scenario | Required result |
| --- | --- | --- |
| O01 | Real browser COD checkout on two-seller cart | One order, accurate snapshots/totals, stock/coupon effects once |
| O02 | Blank online configuration, COD disabled, missing address | Only available actions; useful refusal and retained cart |
| O03 | Price/minimum/stock changes between review and submit | Fresh server refusal or renewed total approval; no wrong order |
| O04 | Two buyers race for last available quantity | One success, one sold-out result, stock never negative |
| O05 | Fake provider capture plus repeated webhook and browser return in both orders | One confirmation, one ledger/invoice effect; invalid signatures refused |
| O06 | Provider timeout/error, payment pending, expiry and late capture | Correct compensation/recovery/refund-needed state, no false success |
| O07 | Partial multi-seller dispatch, duplicate/stale dispatch and delivery | Correct own-line views and permitted transitions; conflict handled |
| O08 | Cancellation before/after dispatch and concurrent payment | Server policy and stock/financial effects respected |
| O09 | Invoice pending/ready/cancelled/regenerated/private URL | Correct downloadable PDF; other users refused; snapshots unchanged |

Use `startFakeRazorpay` for real HTTP provider-side interactions; never real payment credentials or a real card.
Keep concurrency/signature/financial assertions in integration tests and run browser flows against the real app plus fake HTTP server.
If the external checkout widget needs a browser adapter, use a clearly test-only deterministic adapter and disclose that it does not verify Razorpay's hosted UI.
Add proposed `e2e/checkout.spec.ts`, `orders.spec.ts`, `dispatch.spec.ts`, `invoices.spec.ts`.
Run `pnpm check`, selected browser journeys and the integrated demo against isolated services.
Release cannot pass with skipped stock, idempotency or RLS cases.

## Manual remainder and evidence

Production Razorpay account/webhook configuration and approved provider sandbox checks need the account owner's inputs later.
Record these as environment readiness, separate from local fake-provider evidence.
Completion evidence is pending; include before/after stock, coupon, invoice and ledger assertions from tests.
