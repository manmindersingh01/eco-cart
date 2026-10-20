# 02: Integrate backend and reconcile account roles

| Field | Value |
| --- | --- |
| Status | Planned |
| Implemented | No |
| Depends on | 01 |
| Blocks | Every feature relying on newer backend contracts |

## Outcome and starting point

Create a reviewed integration containing the existing portal frontend and the newer backend before implementing screens against its APIs.
Read both versions of `AGENTS.md`, the design's account/role decisions, auth services and request context helpers.
The supplied local instructions still assume one role, while inspected upstream records the 20 October decision for combined buyer/seller accounts.
Confirm that recorded upstream decision is the integration target with the project lead if it conflicts with instructions still in force.
Do not silently overwrite instructions or implement a contradictory role model.

## Ordered implementation

1. Preserve existing user edits and capture `git status`, branch name and both heads.
2. Refresh remote references as a separate implementation action, review the new diff and record the reviewed backend commit.
3. Integrate into a focused branch; resolve conflicts by preserving frontend protection and upstream service semantics.
4. Re-read migrations and queue registration, install the lockfile, apply migrations to the isolated test database, and prove worker startup.
5. Audit frontend assumptions before enabling new navigation.
6. Update the current architecture/instructions and the backend tracker only to match agreed decisions and demonstrated results.

Never merge migrations by blindly renaming already-applied migration files.
Respect the incoming migration journal and use a new migration for any necessary correction.
Run `pnpm db:migrate` against development only as an explicit setup step after verifying its target and preserving development data.

## Backend to reuse and verify

Inspect upstream `modules/auth/service.ts`, `modules/auth/auth.ts`, `modules/sellers/applications.ts`, and `apps/web/src/lib/request-context.ts`.
`rolesOf(user.role)` reads the comma-separated Better Auth roles.
Each request still runs in one RLS context.
Seller routes resolve seller context; ordinary shopping resolves buyer context; shared APIs use `areaOf(request)` and `?as=seller` where supported.
Applicants may access designated document routes without receiving catalogue management privileges.
Business suspension must not ban shopping for a combined buyer/seller account.
Reconcile hashed phone-code behaviour and buyer profile endpoints with the actual integrated Better Auth configuration.

## Frontend changes

Audit `lib/auth-routing.ts`, `lib/page-auth.ts`, `components/auth/account-controls.tsx`, portal layouts, sign-in redirects and client account types.
Use `/api/me.roles` for available areas and `role` only for the current request's context.
Do not hide the seller portal just because default `/api/me.role` is `buyer`.
Do not rely on default `/api/me.sellerId`, which can be null for a combined account's buyer request.
Resolve seller identity through protected seller context on seller pages.
Preserve safe same-origin `returnTo`, server-first role checks, signed-out redirects and clear forbidden states.
For shared invoice/return downloads carry the intended area where its handler requires it.
Keep personal pages uncached and public cache data anonymous.
Keep incoming `connection()` and `'use cache'` behaviour compatible with the installed Next.js guides.

## Automated acceptance

| ID | Scenario | Expected result |
| --- | --- | --- |
| I01 | Visitor opens protected page directly and refreshes | Sign-in redirect; no protected data in HTML or streamed response |
| I02 | Buyer, seller-only, combined account and admin use each area | Only permitted data/actions; combined account can shop and sell |
| I03 | Pending/rejected applicant opens documents versus products | Own requested documents accessible; catalogue management refused |
| I04 | Seller business suspended for combined account | Selling refused; buyer journey remains available under agreed policy |
| I05 | Shared invoice download with and without seller area | Correct ownership checked in each context; unrelated user refused |
| I06 | Product/category change and worker media completion | Public cached page refreshes through core invalidation |
| I07 | Clean migrated test database starts worker | All registered queues and video tools recognised |
| I08 | Existing admin settings/sellers/catalogue and seller edit journeys | No portal regression after integration |

Extend auth core tests, `/api/me` route tests and proposed `e2e/role-access.spec.ts`.
Run `pnpm check` and `pnpm test:e2e:smoke` on the integrated commit.
After integration, run `pnpm demo:flow --base-url http://127.0.0.1:3211` only against the prepared isolated running stack.
The demo creates data and is not a substitute for browser coverage.
Inspect skips: a zero exit code with skipped required capabilities is not proof they passed.

## Completion evidence

Pending.
Record both parent commits, resolved semantic differences, final commit, migration/worker output, actual tests, and any remaining decision using the evidence template.
