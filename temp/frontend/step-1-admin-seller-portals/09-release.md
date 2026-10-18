# T09: Public baseline, hardening, and release evidence

| Field | Value |
| --- | --- |
| Status | `implemented_pending_manual_verification` |
| Implemented | No - implementation and automated verification pass; final manual role, Safari, and accessibility checks remain |
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

Implementation evidence, 18 October 2026:

- `apps/web/src/app/(storefront)/page.tsx` replaces the temporary home page with a responsive introduction, real category hierarchy, bounded brand discovery, and an honest description of the unavailable shopping features.
- `apps/web/src/components/storefront/category-navigation.tsx` adds public category navigation without linking to product routes that do not exist.
- `apps/web/src/components/storefront/brand-discovery.tsx` adds bounded brand search and opaque-cursor pagination through `GET /api/brands`.
- `apps/web/src/lib/public-catalogue.ts` caches public category and brand reads for one hour with separate revalidation tags.
- Admin category and brand mutations revalidate the matching public cache tag after successful writes.
- `apps/web/src/components/auth/account-controls.tsx` shows the correct portal link for administrator and seller accounts and no unsupported portal link for buyers.
- `apps/web/src/app/not-found.tsx`, `apps/web/src/app/global-error.tsx`, and the updated route error boundary provide useful recovery actions.
- Storefront, administrator, and seller route loading files provide visible route-boundary progress.
- `apps/web/src/lib/page-auth.ts` now supplies redirect-aware administrator and seller page contexts so protected pages authenticate before loading protected data.
- The public catalogue route handlers reuse the same cached service wrappers as the home page.
- `apps/web/vitest.setup.ts` provides a test-only Next.js cache adapter so route tests exercise the real route code without requiring the framework incremental-cache request store.
- `apps/web/src/lib/public-home.test.ts` covers bounded brand URLs, empty search handling, cursor preservation, duplicate removal, and recursive category totals.

Automated test evidence, 18 October 2026:

- `pnpm format:check` passed with all matched files using Prettier formatting.
- `pnpm lint` passed with no Oxlint findings.
- `pnpm typecheck` passed for `@ecokart/core`, `@ecokart/web`, and `@ecokart/worker`.
- `pnpm test` passed with 24 core files and 299 tests, 18 web files and 102 tests, and 1 worker file and 6 tests.
- `pnpm build` passed with Next.js 16.3.7 and generated all 25 static pages successfully.
- The production route report marks `/` as a one-hour cached static route and keeps administrator, seller, authentication, and API routes dynamic.
- Live local smoke requests returned the populated public home, two top-level seeded categories, a bounded three-brand response with an opaque next cursor, and the custom 404 response.
- Direct signed-out requests to `/admin` and `/seller` returned streamed redirects to `/sign-in` with the original path in `returnTo`, without loading protected service data.
- Docker reported PostgreSQL, Mailpit, and SeaweedFS healthy before the release matrix.
- `git diff --check` passed with no whitespace errors.

Automated Chrome render evidence, 18 October 2026:

- Google Chrome 155.0.8059.82 rendered `/` at 1440 by 900 without clipped content or dead commerce actions.
- Chrome DevTools device emulation rendered `/` at a true 390 by 844 CSS-pixel viewport.
- At 390 pixels, `window.innerWidth`, `document.documentElement.clientWidth`, `document.documentElement.scrollWidth`, and `document.body.scrollWidth` were all 390 pixels.
- The category navigation deliberately scrolls within its own horizontal region, while the document itself has no horizontal overflow.
- These are automated render checks and do not replace the manual Chrome journeys below.

Accessibility implementation evidence, 18 October 2026:

- The public page has one main heading, labelled landmark navigation, real form labels, visible focus styles, status announcements, semantic lists, and button elements for actions.
- The category menu uses native `details` and `summary` keyboard behaviour.
- Loading, empty, recoverable error, and not-found states use visible text and do not rely on colour alone.
- The existing reduced-motion rule and skip link apply to the new public shell.
- Manual keyboard, screen-reader, dialog-focus, and 200 percent zoom checks remain pending.

Final `pnpm check` evidence, 18 October 2026:

- `pnpm check` passed the authoritative sequence: formatting, lint, type checking, 407 tests across 43 test files, and the production build.

## Manual verification still required

The task cannot be marked complete until the following checks are recorded.
The Windows development machine cannot provide a real Safari engine, and a Safari user-agent string is not an acceptable substitute.

1. Start PostgreSQL, Mailpit, and SeaweedFS with `pnpm db:up`.
2. Start the web app and worker with `pnpm dev` and open `http://localhost:3210`.
3. Complete the visitor, administrator, and seller journey matrices above in Chrome 155 or newer at 390 by 844 and 1440 by 900.
4. Repeat the critical visitor, administrator, and seller journeys in current Safari on an iPhone viewport and at desktop width.
5. Record the Safari version, operating-system version, hardware or simulator, viewport, role, route, and observed result.
6. Navigate every interactive control using only Tab, Shift+Tab, Enter, Space, and Escape.
7. Confirm dialogs move focus inside, keep it inside while open, close with Escape where allowed, and return focus to the trigger.
8. With a screen reader, trigger a form validation error, a failed request, a confirmation dialog, and a successful status update, then confirm each message is announced once and in context.
9. Set browser zoom to 200 percent on the public home, sign-in, main administrator pages, main seller pages, and product editor, then confirm no control or required text is clipped or unreachable.
10. Keep the browser console open through each journey and record any console error with the route and reproduction steps.

Notes or deviations:

- The repository still has no end-to-end test infrastructure, so no e2e coverage is claimed.
- Manual checks are intentionally left open because the developer asked to perform them after implementation.
