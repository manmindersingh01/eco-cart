# T01: Foundation and UI system

| Field | Value |
| --- | --- |
| Status | `not_started` |
| Implemented | No |
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

Implementation evidence: Pending.

Automated test evidence: Pending.

Manual evidence: Pending.

Notes or deviations: None recorded.
