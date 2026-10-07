# EcoKart frontend handoff

## Current state

- [x] Work from `backend/step-6-products` in `github.com/manmindersingh01/eco-cart`.
  The branch has not been merged into `main` yet.
- [x] Backend steps 2 through 6 are implemented: email-code sign-in with Better Auth, buyer/seller/admin roles, platform settings, seller onboarding, categories and GST rates, brands, and seller listings with variants, stock, and photos.
- [x] Local PostgreSQL, Mailpit, and SeaweedFS run through Docker Compose.
- [x] The local PostgreSQL host port is `15434`.
  Project examples, test defaults, documentation, and local `.env` files use the same port.
- [x] The repository uses `AGENTS.md` as the shared source of agent instructions and `apps/web/AGENTS.md` for Next.js-specific instructions.
- [ ] Backend step 7, listing review, is not implemented.
- [ ] Backend step 9, storefront product and search APIs, is not implemented.
- [ ] Cart, checkout, orders, and payments are not implemented.

## Frontend task

Build the admin console and seller portal first because their required APIs already exist.
For the storefront, only `GET /api/categories` and `GET /api/brands` are currently available.

Put frontend routes in the existing Next.js 16 app under `apps/web/src/app`:

- `(storefront)/` for buyer-facing pages
- `seller/` for the seller portal
- `admin/` for the admin console

Before implementing a feature, read:

- `AGENTS.md` for repository rules (`CLAUDE.md` is a compatibility pointer)
- `apps/web/AGENTS.md` and the relevant guides in `node_modules/next/dist/docs/` for Next.js 16 behavior
- `docs/system-design.md`, especially sections 1, 4, 6.1, and 6.2
- `docs/backend-spec.md`, especially steps 2 through 6 and each step's API table

## Local setup

- [x] Install dependencies with `pnpm install`.
- [x] Copy `packages/core/.env.example`, `apps/web/.env.example`, and `apps/worker/.env.example` to matching `.env` files.
- [x] Start local services with `pnpm db:up`.
- [x] Applied all 10 migrations with `pnpm db:migrate`; database users, pg-boss, and job queues are ready.
- [x] Seeded example settings, sellers, categories, and brands with `pnpm db:seed`.
- [x] Verified that `pnpm dev` starts the web app and worker successfully.
- [x] Confirmed that `http://localhost:3000/api/health` returns HTTP 200 with the database healthy.
- [x] Ran `pnpm check`: formatting, lint, type checking, 342 tests, and the production build pass.

Mailpit is at `http://localhost:8025` and captures local sign-in codes.
SeaweedFS serves public local product images from `http://localhost:8333/ecokart/images/...`.
The example seller login is `seller1@ecokart.test`.
Create an administrator with `pnpm admin:create --email you@example.com --name "Your Name"`, then retrieve the sign-in code from Mailpit.

## API and UI conventions

- Server Components may call `@ecokart/core` services directly.
- Client Components call API routes.
- Pages never contain SQL.
- Send a sign-in code with `POST /api/auth/email-otp/send-verification-otp`, then sign in with `POST /api/auth/sign-in/email-otp`.
  Better Auth's React client with `emailOTPClient` wraps both calls.
- `GET /api/me` returns the signed-in user's role and seller ID.
- API errors use `{ error, issues[] }` with status 400, 401, 403, 404, 409, or 503.
  Show the plain-English issues to the user.
- Paginated lists return `{ items, nextCursor }`.
  Request the next page with `?cursor=<nextCursor>`.
- Money is stored as whole paise.
  For example, `19900` is ₹199 and should be formatted with `Intl.NumberFormat('en-IN', { style: 'currency', currency: 'INR' })`.
- Photo upload has three stages: request a signed form from `POST .../images/uploads`, upload the file directly to object storage, then register its `uploadKey` with `POST .../images`.
- A new photo remains in `processing` until the worker finishes.
  Poll the product until the photo becomes `ready` or `failed`.
- Use British and Indian English, including `colour` and `catalogue`.
- Check phone and desktop layouts in Chrome and Safari.
- Ask the project lead before contradicting the system design or backend specification.
