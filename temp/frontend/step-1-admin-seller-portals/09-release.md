# T09: Public baseline, hardening, and release evidence

| Field | Value |
| --- | --- |
| Status | `not_started` |
| Implemented | No |
| Depends on | T04, T05, T08 |
| Blocks | Pull request |

## Goal

Finish the honest public baseline, verify the complete role journeys, resolve accessibility and responsive defects, and collect reproducible release evidence.

## Public API boundary

The public frontend currently has only:

- `GET /api/categories` for the active category tree;
- `GET /api/brands?q=&cursor=&limit=` for active brands.

There is no public product-list or product-detail API in this branch.
Do not mock products or link category and brand items to product pages that cannot work.

## Deliverables

- Replace the temporary home page with a polished EcoKart introduction.
- Add a public header with logo, category navigation, sign-in or account controls, and role-aware portal links.
- Show active categories with their hierarchy and a bounded active-brand discovery section.
- Explain that product shopping is coming when the catalogue is published without presenting a broken shop.
- Add useful not-found and unexpected-error pages consistent with the visual system.
- Add loading states at route boundaries where data fetching can be visible.
- Audit all mutation confirmations, empty states, error messages, focus behavior, and responsive layouts.
- Remove dead links, debug output, placeholder controls, and unsupported navigation.
- Fill the evidence sections in every task file.

## Full manual journey matrix

### Visitor and buyer

1. Open `/` signed out and navigate the category hierarchy.
2. Search or page through the bounded brand section if that interaction is exposed.
3. Request an email code and sign in as a new buyer.
4. Confirm the buyer returns to `/` and does not see portal links they cannot use.
5. Attempt direct `/admin` and `/seller` access and confirm protected content never renders.
6. Sign out and confirm the session is gone.

### Administrator

1. Sign in as a local administrator.
2. Open every admin route through navigation and direct URL entry.
3. View and update representative scalar, boolean, list, money, percentage, and company settings.
4. Create a seller, edit it, approve it, suspend it with a reason, and reinstate it.
5. Create and move a category, exercise depth refusal, and verify active-state display.
6. Search, create, edit, deactivate, and delete a brand where allowed.
7. Verify validation, conflict, not-found, and 204 delete behavior.
8. Sign out from the admin shell.

### Seller

1. Sign in as `seller1@ecokart.test` with the code from Mailpit.
2. View the business profile and update a support contact.
3. Filter and paginate the own-product list.
4. Create a simple draft and a multi-variant draft.
5. Edit listing details and variant commercial values.
6. Upload a valid photo and observe processing to ready.
7. Exercise a failed photo and read its reason.
8. Edit image alt text and variant association, reorder photos, and delete a photo.
9. Delete a draft and confirm it leaves the list.
10. Sign out from the seller shell.

## Browser and viewport matrix

Run the critical visitor, admin, and seller journeys in:

- Chrome at 390 by 844 and 1440 by 900;
- Safari at a current iPhone viewport and desktop width.

Safari verification may use physical Apple hardware, the iOS simulator, or an approved browser-testing service.
Record the exact Safari version and platform.
Do not substitute a Chromium browser with a Safari user-agent string.

Check keyboard-only operation at desktop width and screen-reader announcements for form errors, dialogs, and status updates.
Check 200 percent zoom for the main pages.

## Automated release matrix

Run from the repository root with Docker services healthy:

```text
pnpm format:check
pnpm lint
pnpm typecheck
pnpm test
pnpm build
pnpm check
```

The individual commands make failures easier to attribute during development.
The final `pnpm check` is the authoritative CI-equivalent result.
Do not claim e2e coverage because the repository does not yet have e2e infrastructure.

## Acceptance criteria

- The public page uses only real available data and contains no dead commerce actions.
- Every route in the route map has loading, empty, success, and error behavior appropriate to its work.
- All protected routes pass the role matrix through direct navigation and refresh.
- Every destructive or high-impact action asks for explicit confirmation.
- All forms preserve useful input after a recoverable backend error.
- No console error appears during the manual critical journeys.
- Chrome and Safari checks pass at phone and desktop sizes.
- Keyboard and focus checks pass.
- All task documents contain implementation and verification evidence.
- `pnpm check` passes against the local PostgreSQL, Mailpit, and SeaweedFS services.

## Pull request notes to prepare

The PR should target the reviewed predecessor chosen by the project lead, expected to be `windows/fixes` until backend step 6 reaches another integration branch.
Its description should list delivered routes, explain the public API limitation, state that backend steps 7 and later remain out of scope, and include the final command results.
Include a short manual-test table by role and browser.

## Completion evidence

Implementation evidence: Pending.

Automated test evidence: Pending.

Manual Chrome evidence: Pending.

Manual Safari evidence: Pending.

Accessibility evidence: Pending.

Final `pnpm check` evidence: Pending.

Notes or deviations: None recorded.
