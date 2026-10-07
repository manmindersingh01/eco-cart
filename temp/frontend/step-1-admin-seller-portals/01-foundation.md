# T01: Foundation and UI system

| Field | Value |
| --- | --- |
| Status | `complete` |
| Implemented | Yes |
| Depends on | None |
| Blocks | T02 |

## Goal

Create the route structure, visual language, shared primitives, formatters, and frontend test conventions that every later screen uses.

## Read before implementation

- `AGENTS.md` sections Commands, Architecture rules, Naming and locale, and How to work;
- `apps/web/AGENTS.md`;
- Next.js 16 guides for layouts and pages, Server and Client Components, CSS, metadata, loading UI, and error handling;
- `docs/system-design.md` sections 1 and 4;
- the current `layout.tsx`, `page.tsx`, and `globals.css`.

## Deliverables

- Establish `(storefront)`, `admin`, and `seller` route areas without changing their public URLs.
- Add shared page-width, spacing, colour, typography, border, focus, success, warning, and danger tokens.
- Build the minimum reusable primitives needed by later tasks.
- Add shared formatters for INR from paise, basis points, Indian dates, and status labels.
- Add a typed browser API helper that parses JSON safely and preserves `{ error, issues[] }`.
- Define a consistent loading, empty, error, and success-message pattern.
- Add root metadata, viewport behavior, and a skip link.
- Keep the bundle small and use no new UI framework.

Suggested primitives:

- `Button`, `IconButton`, and `LinkButton`;
- `Field`, `Input`, `Textarea`, `Select`, `Checkbox`, and field error text;
- `StatusBadge`, `Notice`, `Card`, `EmptyState`, `Skeleton`, and `PaginationButton`;
- accessible confirmation dialog;
- desktop table plus phone row-card pattern;
- page header and responsive portal navigation shell.

## Implementation notes

Keep primitives presentational and accept standard element props.
Do not create a generic form framework.
Use semantic HTML before adding ARIA.
Use inline SVG icons or a tiny local icon module rather than adding a dependency for a handful of icons.
Keep server-only code out of client component import trees.

The API helper should:

1. send JSON with the correct content type;
2. accept 204 responses without trying to parse a body;
3. parse success JSON by the caller's expected type;
4. turn known error JSON into a structured frontend error;
5. produce a plain fallback for invalid or empty error responses;
6. support `AbortSignal` for searches, uploads, and polling.

## Acceptance criteria

- All three route areas render through their intended layout.
- Shared controls are keyboard accessible and have visible focus.
- INR formatting proves `19900` renders as `₹199.00` or the agreed no-decimal display consistently.
- Basis points prove `1000` renders as `10%`.
- Dates explicitly use `Asia/Kolkata`.
- API errors retain both the summary and field issue list.
- A 204 response does not throw a JSON parsing error.
- The existing home page still renders while later tasks replace its content.
- No database, auth secret, or server module is imported into a Client Component.

## Verification plan

- Add focused unit tests for formatting and API error parsing because these rules are reused across every form.
- Run `pnpm --filter @ecokart/web typecheck`.
- Run `pnpm lint`.
- Run `pnpm --filter @ecokart/web test`.
- Inspect the shell at phone and desktop widths with keyboard-only navigation.

## Completion evidence

Implementation evidence:

- Added the public route group at `apps/web/src/app/(storefront)/`, administrator shell at `apps/web/src/app/admin/`, and seller shell at `apps/web/src/app/seller/`.
- Added the shared UI primitives in `apps/web/src/components/ui/`.
- Added reusable locale formatters in `apps/web/src/lib/format.ts`.
- Added the typed browser API helper in `apps/web/src/lib/api-client.ts`.
- Added design tokens, focus styles, reduced-motion handling, root metadata, viewport settings, loading UI, error UI, and a skip link.
- No dependency or backend change was needed.

Automated test evidence, 8 October 2026:

- `pnpm --filter @ecokart/web typecheck` passed after Next.js generated the route types.
- `pnpm lint` passed with no findings.
- `pnpm --filter @ecokart/web test` passed 10 test files and 47 tests.
- The new tests prove INR from paise, basis points, `Asia/Kolkata` dates, status labels, JSON requests, structured API errors, invalid error fallbacks, 204 responses, and `AbortSignal` forwarding.
- `pnpm --filter @ecokart/web build` compiled successfully and generated `/`, `/admin`, and `/seller` as static routes.
- A development-server smoke test requested `/`, `/admin`, and `/seller`.
  Every route returned HTTP 200 and its HTML contained `main-content`, the skip link, and `width=device-width` viewport metadata.

Manual evidence, 8 October 2026:

- The project owner checked `/`, `/admin`, and `/seller` in the latest Chrome, Safari, and Firefox.
- The checks covered phone and desktop viewports, layout overflow, clipped or overlapping content, portal navigation, keyboard order, visible focus, the skip link, and reduced motion.
- Every available check passed.
- The confirmation dialog interaction check is deferred until T04, T05, or T08 first places the shared component on a real screen.
  T01 builds the primitive but has no destructive user action that should display it.

### Manual verification steps

1. Run `pnpm dev` and wait until Next.js reports `http://localhost:3000` as ready.
2. In Chrome, open `/`, `/admin`, and `/seller` at a 390 by 844 pixel phone viewport.
3. Repeat the three routes at a 1280 pixel or wider desktop viewport.
4. Confirm there is no horizontal page overflow, clipped text, overlapping content, or control smaller than 44 pixels high.
5. Confirm `/` has the EcoKart header, existing coming-soon message, and footer.
6. Confirm `/admin` and `/seller` use their own labelled portal shell, show an Overview link, and change from a top navigation on phone to a left navigation on desktop.
7. On each route, reload the page and press Tab before using the mouse.
8. Confirm the first focusable item is `Skip to main content`, its focus ring is visible, and Enter moves focus to the `main-content` landmark.
9. Continue through every link and button using Tab and Shift+Tab.
10. Confirm focus is always visible and follows the visual reading order.
11. When T04, T05, or T08 first uses `ConfirmationDialog`, open it from the keyboard, confirm focus stays inside it, press Escape to close it, reopen it, choose Cancel, and confirm focus returns to the trigger.
12. Enable the operating system's reduced-motion setting and confirm no long animation or smooth scrolling remains.
13. Repeat steps 2 through 12 in Safari on macOS or iOS.
14. Record the browser version, route, viewport, and result here.

Notes or deviations:

- The confirmation dialog uses the browser's native modal dialog behavior for focus containment and Escape handling.
- Step 11 cannot run yet because no foundation route has a real confirmation action.
- Test step 11 when the first destructive action integrates the component, and record that evidence in the consuming task.
