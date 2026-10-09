# T03: Admin shell and platform settings

| Field | Value |
| --- | --- |
| Status | `implemented_pending_manual_verification` |
| Implemented | No - code and automated checks pass; browser verification remains |
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

Implementation evidence, 8 October 2026:

- Expanded the protected administrator navigation with Overview and Platform settings links.
- Replaced the administrator placeholder with a useful landing page that links only to the delivered settings tool.
- Added the dynamic `/admin/settings` Server Component.
  It resolves the administrator context on the server, reads settings through the core service and row-level security context, and serialises only the setting view needed by the client editor.
- Added five clear settings sections for commerce, payments, AI limits, moderation, and company details.
- Added one independent form per setting, so saving or rejecting one value does not clear edits in any other setting.
- Added visibly different Saved value, Using default, and Setup required badges with text explanations that do not rely on colour.
- Added exact string-based conversion from rupees to paise and percentages to basis points.
  Malformed decimal input is refused before a request and no floating-point multiplication is used.
- Added editors for booleans, whole numbers, one-term-per-line lists, and the complete company details object.
- Preserved API error summaries and issue lists.
  Company field issues, including the GSTIN and PAN relationship and GSTIN state relationship, are also placed beside the matching field.
- A successful save keeps the returned server value, source, and refreshed update time in that setting card.
- A 401 returns to sign-in with the safe settings return path.
  A 503 explains that administrator setup must be completed.

Important files:

- `apps/web/src/app/admin/settings/page.tsx`
- `apps/web/src/components/admin/settings-editor.tsx`
- `apps/web/src/lib/admin-settings.ts`
- `apps/web/src/lib/admin-settings.test.ts`
- `apps/web/src/app/admin/layout.tsx`
- `apps/web/src/app/admin/page.tsx`

Automated test evidence, 8 October 2026:

- `pnpm --filter @ecokart/web typecheck` passed after generating Next.js route types.
- `pnpm lint` passed with no findings.
- `pnpm --filter @ecokart/web test` passed 12 test files and 69 tests.
- The new unit tests prove rupee-to-paise conversion, percentage-to-basis-point conversion, malformed money rejection, whole-number parsing, all three source presentations, and company issue-to-field mapping.
- Existing route tests prove an administrator can list and save settings, a rejected mutation returns its issue, signed-out and buyer requests are refused, an unknown key returns 404, and malformed bodies return 400.
- `pnpm --filter @ecokart/web build` compiled successfully and includes dynamic `/admin` and `/admin/settings` routes.
- Prettier checks passed for every changed application and task file.
- `git diff --check` passed after removing the existing trailing space from the T02 evidence.

Real local-service evidence, 8 October 2026:

- Confirmed PostgreSQL, Mailpit, and object storage were healthy in Docker.
- Signed in the development administrator through the real email-code and Mailpit flow without printing or logging the code.
- The protected `/admin/settings` page rendered all nine setting labels in its server response.
- `GET /api/admin/settings` returned exactly nine settings.
- Saved every setting's current value through its real `PUT /api/admin/settings/{key}` route.
  This exercised percentage, money, boolean, whole-number, string-list, and nested company-object values.
- A commission value above 100% returned HTTP 400 with the backend issue list.
- A signed-out settings request returned HTTP 401.
- The five values that previously came from built-in defaults are now saved with the same effective values in the local development database because the real API verification exercised all nine update routes.

Manual evidence: Pending for browser layout, interaction, focus, and visual checks.

### Manual verification steps

1. Run `pnpm dev` and sign in as `auth-check-admin@ecokart.test` using the newest code in Mailpit at `http://localhost:8025`.
2. Open `http://localhost:3000/admin` in the latest Chrome at a desktop width of at least 1280 pixels.
3. Confirm the shell shows the signed-in administrator, Overview and Platform settings navigation, sign-out, and one delivered Platform settings tool card.
4. Open `/admin/settings` and confirm all nine setting cards appear under Commerce, Payments, AI limits, Moderation, and Company details.
5. Confirm every card shows a source badge, description, current editor, separate Save this setting button, and last-saved time.
6. Change Marketplace commission to `10.25`, save it, and confirm success, `10.25` remains in the field, and the last-saved time refreshes.
7. Enter `100.01` for Marketplace commission, save it, and confirm the backend issue says the value must be at most 10000 basis points without changing another editor.
8. Enter `49.90` for Delivery charge and save it.
   Refresh the page and confirm the field still shows `49.90`, proving the API received 4990 paise.
9. Enter malformed money such as `49.999` and confirm it is refused without a request in the browser network panel.
10. Toggle Cash on delivery, save it, refresh, and confirm the saved choice remains.
11. Enter `4` for Payment timeout, save it, and confirm the backend issue says it must be at least 5.
12. Save `0` for each AI limit and confirm both independent cards report success.
13. Enter duplicate mixed-case prohibited terms on separate lines, save, and confirm the returned list is lower case with duplicates removed.
14. In Company details, enter an invalid PAN, GSTIN, state code, PIN code, support phone, grievance phone, and email, then save.
15. Confirm each backend issue appears in the error summary and beside its matching field.
16. Enter individually valid company fields but use a GSTIN whose embedded PAN differs from the PAN field.
   Confirm the relationship issue remains visible beside GSTIN.
17. Then use a GSTIN whose first two digits differ from the registered-address state code.
   Confirm the state relationship issue remains visible beside GSTIN.
18. Correct the company data, save it, and confirm the card reports success and refreshes its last-saved time.
19. Make unsaved edits in two cards, save only one, and confirm the other card keeps its unsaved text.
20. Use only Tab, Shift+Tab, Space, and Enter across the section links, inputs, checkbox, and save buttons.
   Confirm focus is always visible, field errors are associated with their controls, and success and error notices are announced.
21. Repeat the complete visual check in Chrome and Safari at 390 by 844 and at 1280 pixels or wider.
22. Confirm there is no clipped text, overlapping control, or page-level horizontal scrolling at either width.
23. Open `/admin/settings` while signed out and as a buyer or seller.
   Confirm protected settings content never appears and the account reaches sign-in or access denied as appropriate.
24. Record the browser versions, routes, viewports, and results here.
25. If every check passes, change `Status` to `complete`, change `Implemented` to `Yes`, and update T03 in `README.md` to `Yes`.

Notes or deviations:

- The current Vitest environment is Node-based and has no browser DOM or component-testing library.
  Rendering and interactions are covered by TypeScript, lint, production compilation, pure presentation tests, real server rendering, and the real API flow, while visual and keyboard behavior remains for manual browser verification.
