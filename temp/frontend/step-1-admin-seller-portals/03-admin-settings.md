# T03: Admin shell and platform settings

| Field | Value |
| --- | --- |
| Status | `not_started` |
| Implemented | No |
| Depends on | T01, T02 |
| Blocks | T04, T05 |

## Goal

Create the protected admin experience and a complete settings screen for every setting supported by backend step 3.

## API contract

- `GET /api/admin/settings` returns `{ settings }`.
- Each setting contains `key`, `description`, `value`, `source`, `updatedAt`, and `updatedBy`.
- `source` is `saved`, `default`, or `missing`.
- `PUT /api/admin/settings/{key}` accepts `{ value }` and returns `{ setting }`.

Settings and editor types:

| Setting | UI |
| --- | --- |
| `commission_bps` | Percentage input converted to integer basis points |
| `delivery_charge_paise` | Rupee input converted to integer paise |
| `free_delivery_threshold_paise` | Rupee input converted to integer paise |
| `cod_enabled` | Boolean switch or checkbox |
| `payment_timeout_minutes` | Whole-number minute input |
| `ai_daily_limit_platform` | Non-negative whole number |
| `ai_daily_limit_seller` | Non-negative whole number |
| `prohibited_terms` | Trimmed one-per-line or token list sent as strings |
| `company_details` | Structured legal, tax, address, support, and grievance form |

## Deliverables

- Add a responsive admin layout with current-account context, navigation, and sign-out.
- Make `/admin` a useful landing page that links only to delivered tools.
- Build `/admin/settings` with clear sections for commerce, payments, AI limits, moderation, and company details.
- Display whether every value is saved, inherited from a default, or missing.
- Explain missing client-owned values without inventing defaults.
- Edit one setting at a time so a failure cannot discard unrelated work.
- Preserve the backend's validation issues near the appropriate editor.
- Show successful saves and refreshed `updatedAt` information.

## Important conversions

Convert rupee text to paise without floating-point arithmetic.
Accept at most two decimal places and reject malformed currency input before sending.
Convert a percentage to basis points without floating-point drift.
Send all backend values in their defined JSON types.
Do not send formatted strings such as `₹49` or `10%`.

## Acceptance criteria

- Signed-out and non-admin users cannot render the admin shell.
- All nine settings render with descriptions and source badges.
- Default and missing values are visually distinct.
- Every editor serializes to the backend's correct type.
- Saving refreshes only the changed setting and retains its server response.
- Invalid GSTIN, PAN, state, phone, money, percentage, and limit values show the backend issue.
- Company GSTIN and PAN relationship errors remain visible and understandable.
- A 503 configuration response is shown as an administrator-action message.
- The screen remains usable at phone width without clipped values or controls.

## Verification plan

- Unit test rupee-to-paise and percentage-to-basis-point parsing at boundaries.
- Test rendering of saved, default, and missing settings.
- Test one successful and one rejected mutation through the API client.
- Manually update each setting type through the real API.
- Run web typecheck, lint, relevant tests, and build.

## Completion evidence

Implementation evidence: Pending.

Automated test evidence: Pending.

Manual evidence: Pending.

Notes or deviations: None recorded.
