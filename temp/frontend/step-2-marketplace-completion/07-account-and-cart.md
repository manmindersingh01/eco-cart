# 07: Buyer account, addresses, cart and coupons

| Field | Value |
| --- | --- |
| Status | Planned |
| Implemented | No |
| Depends on | 06 |
| Blocks | Checkout |

## Contracts to read

Read design sections 5.3, 5.6, 6.1 and 8, auth configuration, address service/types, cart service/types/pricing/coupons and route tests.
Use `/api/me`, configured Better Auth profile/verification APIs, `/api/account/addresses`, `/api/cart`, cart item/coupon routes and admin coupon routes.
Read the actual login cart-merge hook and guest-cookie handling after task 02.
Never make a frontend-only cart or trust saved browser prices.

## Frontend work in order

1. Add proposed `/account` with supported name/email/phone updates and verified/unverified states.
2. Extend sign-in for configured phone OTP without exposing phone-only placeholder email addresses.
3. Add proposed `/account/addresses` for create/edit/default/delete with server validation and confirmation.
4. Add proposed `/cart` and a header/cart entry point, wiring product Add to cart to the current service.
5. Show line prices, discounts, delivery charge and totals from the server cart; support change quantity and remove.
6. Add coupon apply/remove with readable expired/ineligible/exhausted feedback.
7. Add proposed `/admin/coupons` using current scalar/date/percentage/fixed-value contracts and keyset lists.

Use E.164 phone storage and India delivery-number rules from the service.
Do not allow changing role or verification flags through profile forms.
Guest carts must survive reload and merge on real login; explain any unavailable/repriced line after merge.
For each line set quantity minimum from the server's `minQuantity` or equivalent DTO field, not an old product-card copy.
If a minimum changes after the cart was created, show the new minimum and offer correction/removal.
Treat a minimum of 10 as at least 10 of that variant, not increments of 10.
Keep invalid/unavailable lines visible with actionable explanations according to the current cart DTO.
Do not silently change commercial amounts or drop lines without explaining the server response.
Keep personal/cart reads uncached and prevent cross-user browser-context leakage.

## Backend work

Reuse current account/address/cart/coupon services and login merge behaviour.
Extend coverage for any missing merge, quantity propagation, stale-data or ownership cases.
Do not hard-code commission, delivery charge or free-delivery thresholds; settings remain authoritative.
Do not add new coupon rules without a confirmed requirement.

## Automated acceptance

| ID | Scenario | Required result |
| --- | --- | --- |
| A01 | Update allowed account data and verify changed contact | Correct verification required; forbidden fields refused |
| A02 | Address add/edit/default/delete, invalid PIN/state/phone | Persisted valid values and useful server errors |
| A03 | Guest adds minimum-10 variant, reloads, signs into existing cart | Stable cart, server-defined merge, no duplicate or missing quantity |
| A04 | Quantity 9, 10, 11, fraction, excessive stock | Floor enforced; 11 accepted if stock permits; bypass calls still checked |
| A05 | Another user/seller guesses address/cart identifiers | No private data or changes |
| A06 | Seller raises minimum, changes price or disables variant | Cart refresh explains changed purchasability/totals |
| A07 | Fixed/percentage coupon and expiry/limits/minimum spend | Correct integer-paise totals and no unsupported discount |
| A08 | Combined buyer/seller account switches area | Shopping cart remains buyer-context data |

Add proposed `e2e/account-addresses.spec.ts`, `cart.spec.ts` and `coupons.spec.ts`.
Retain real database tests for pricing rounding, coupon limits, guest merge and ownership.
Use controllable dates/relative fixture validity; avoid sale dates that become stale on the calendar.
Run relevant core/web tests, lint/typecheck and browser suites.
Completion evidence is pending.
