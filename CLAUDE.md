# EcoKart

<!--
Maintainer notes. Block comments like this are stripped before Claude reads the file, so they cost no context.
- Keep this file under about 200 lines. Longer files lower how well Claude follows them.
- Only keep rules Claude cannot work out by reading the code. If a rule only matters for one folder, move it to .claude/rules/ with a `paths:` filter.
- Fill in "Commands" as soon as package.json exists.
- Review this file at each milestone and delete rules Claude already follows without being told.
-->

EcoKart is a multi-vendor marketplace for India with three kinds of users: buyers, sellers, and administrators.
It is one responsive Next.js app (App Router, React, TypeScript) plus one background worker built from the same codebase.
PostgreSQL is the only stateful service we run, and it also holds full-text search, vectors (pgvector), and the job queue (pg-boss).
A small AI layer, reached through OpenRouter with DeepSeek V4.1 Flash for chat and vision and Voyage Multimodal 3.5 for embeddings, drafts listings, maps import columns, screens listings, powers natural-language and image search, and answers product questions.
One developer builds it, and production launch is Saturday 31 October 2026.

## Where the truth lives

- `docs/system-design.md` is the source of truth for architecture, tables, and flows.
- `docs/backend-spec.md` is the backend build plan.
  Before building a backend step, write what it will build into its section; if anything changes while building, update the section and its change log in the same change.
  Before writing code for a feature, read its section: 4 code layout, 5 data model, 6.1 login, 6.2 listings, 6.3 checkout and payment, 6.4 dispatch, 6.5 returns, 6.6 invoices, 6.7 imports, 6.8 search, 6.9 assistant, 8 security.
- `EcoKart_One_Month_Delivery_Timeline.pdf` has the milestones, the client inputs, and the launch priorities.
- The decisions in section 11 of the design doc are recommendations until the client confirms them.
  Build with the recommended option (Docker plus pg-boss, Drizzle, guest cart, one role per account) unless told otherwise.
  Already decided by the client: AWS for hosting only, OpenRouter for AI, Better Auth for authentication.
  Decided 5 October 2026: the database is PostgreSQL in Docker (the `compose.yaml` image), not Amazon RDS, for now.
- If a change would contradict the design doc, stop and ask first.
  Once a new decision is agreed, update the design doc in the same change so code and doc never drift apart.

## Commands

This is a pnpm 12 workspace.
pnpm downloads the Node.js version from `devEngines.runtime` in `package.json`, so never install Node.js separately for this project.

- Install: `pnpm install`
- Local services (PostgreSQL 16 with pgvector on port 5434, and Mailpit, which catches every email and SMS, at http://localhost:8025): `pnpm db:up`, stop with `pnpm db:down`
- Apply migrations, set the `ecokart_web` and `ecokart_worker` passwords, and install the pg-boss tables: `pnpm db:migrate` (reads `packages/core/.env`)
- Write a new migration after changing the Drizzle schema: `pnpm db:generate`.
  For SQL that Drizzle cannot express (grants, triggers, functions), use `pnpm --filter @ecokart/core exec drizzle-kit generate --custom --name=<name>` and fill in the file.
- Regenerate the Better Auth tables after changing its plugins: `pnpm auth:schema`, then `pnpm db:generate`
- First administrator: `pnpm admin:create --email <email> --name <name>`, then sign in with the code that arrives in Mailpit
- Web app and worker together: `pnpm dev` (web on http://localhost:3000)
- Worker only: `pnpm --filter @ecokart/worker dev`
- Everything CI runs, in order: `pnpm check` (format check, lint, typecheck, test, build)
- Single steps: `pnpm typecheck`, `pnpm lint`, `pnpm test`, `pnpm build`, `pnpm format`
- Tests in one package: `pnpm --filter @ecokart/core test`
- Add a dependency: `pnpm --filter @ecokart/web add <name>`.
  The version goes into the `catalog` in `pnpm-workspace.yaml` and `package.json` gets `catalog:`.
- Tests rebuild their own databases (`ecokart_test_core`, `ecokart_test_web`, `ecokart_test_worker`) from the migrations on every run and never touch the development database.
- Example data for local development (example platform settings for now): `pnpm db:seed`; it only fills what is missing and refuses production.
- Not set up yet: e2e tests.
  Add them here when they exist.

## Architecture rules

- Follow the layout in design doc section 4: routes in `apps/web/src/app/`, business logic in `packages/core/src/modules/<domain>/` (`service.ts`, `queries.ts`, `jobs.ts`, `types.ts`), schema in `packages/core/src/db/schema/`, SQL migrations in `packages/core/src/db/migrations/`, worker job registration in `apps/worker/src/worker.ts`, external clients in `packages/core/src/lib/`.
- The worker runs `packages/core` and its own code as TypeScript directly on Node.js, so use only type-level TypeScript syntax (no `enum`, `namespace`, or constructor parameter properties) and import local files with their `.ts` extension.
- Pages, server actions, and API routes call module services.
  They never write SQL themselves.
- Services throw the errors in `packages/core/src/errors.ts` (not signed in, forbidden, not found, conflict, validation, not configured), and API routes wrap their handler in `handleErrors` from `apps/web/src/lib/api.ts`, so every route answers with the same status codes and `{ "error", "issues" }` shape.
- Services check input with `parseInput` and the shared formats and `strictObject` in `packages/core/src/lib/validation.ts`, so every message is plain language.
- A service that also changes a Better Auth account (through `AccountDirectory`) takes the database and runs its own transactions in a safe order; other services take a transaction.
- A module owns its tables.
  Other modules call its exported service functions and never query its tables directly.
- Jobs call the same service functions as the web app, so every business rule has exactly one implementation.
- Never do slow work inside a request.
  AI calls, embeddings, image resizing, PDFs, emails, and file imports go to a pg-boss job that the worker runs.
- Do not add Redis, Elasticsearch, a separate vector database, or another queue.
  Postgres covers all of these at launch, and section 9 of the design doc says when that changes.
- Uploads go straight from the browser to object storage with presigned URLs.
  Files never pass through the web app.
- Public pages (home, category, product, content) use tag-based caching and must revalidate their tag when the product or category changes.
  Personal pages (cart, orders, seller portal, admin) are never cached.

## Money, tax, and orders

- Money is an integer number of paise in a `bigint` column named `*_paise`.
  Never use floats or decimals for money, in SQL or in TypeScript.
- Tax rates are basis points in `*_bps` columns, so 18% is `1800`.
- Prices are tax inclusive.
  GST is back-calculated at order time and frozen on the order line.
- Orders and invoices snapshot everything they show: title, SKU, options, price, MRP, GST rate, HSN code, address, and commission rate.
  Later catalogue edits must never change a past order or invoice.
- Carts store no prices.
  Read price and stock fresh from `product_variants` every time the cart is shown or checked out.
- Commercial values (commission, delivery charge, free-delivery threshold) and company details come from platform settings through `getSetting`, never from constants in code.
- The catalogue service updates the summary fields on `products` (`min_price_paise`, `total_stock`, `rating_avg`, `search_text`, and the rest) on every write that affects them.
- The seller ledger (`seller_ledger_entries`) is append only.
  Fix a mistake with a new `adjustment` entry, never with UPDATE or DELETE.
- If seller and buyer are in the same state, the invoice uses CGST plus SGST.
  If they are in different states, it uses IGST.
- Invoice numbers come from the seller's own sequence and reset each Indian financial year (1 April to 31 March).

## Checkout, payments, and concurrency

- Never trust the browser.
  Recompute prices, totals, discounts, stock, and permissions on the server.
- Decrement stock with one conditional statement: `UPDATE product_variants SET stock = stock - $qty WHERE id = $id AND stock >= $qty`.
  Zero rows updated means the item sold out, so roll back.
  Use the same pattern for `coupons.used_count` and invoice sequences.
- Never call Razorpay or any other external API inside a database transaction.
  Commit first, then call, and run the compensating rollback on failure (design doc section 6.3, step 4).
- Verify the Razorpay webhook signature before reading anything from the payload.
- Webhooks are idempotent through the unique `(provider, event_id)` on `payment_events` with `ON CONFLICT DO NOTHING`.
  A replay does nothing and still returns success.
- The webhook and the browser return both confirm payment through the one idempotent `confirmOrderPayment` function.
  Never add a second path.
- EcoKart never receives card data.
  Keep it that way.

## Database and security

- Every table holding buyer or seller data has row-level security (RLS).
  Run buyer and seller work through `withContext` (`packages/core/src/db/context.ts`), which sets `app.role`, `app.user_id`, `app.seller_id`, and `app.guest_token` with `set_config(..., true)`, the parameterised `SET LOCAL`.
  Never use plain `SET`, because the connection pooler runs in transaction mode.
- Use the `system` context role only for work that changes several parties' data at once (checkout, payment confirmation, order expiry, cancellation, refunds), and only after the service has checked permissions itself.
- RLS is the safety net, not the check.
  Application code still checks permissions explicitly.
- The web app logs in as `ecokart_web` and the worker as `ecokart_worker`, which has a full-access `worker_all` policy on every RLS table.
  Never use the worker user from the web app, and never let either program log in as the database owner.
- A new table needs, in its migration, RLS policies (or a reason it has none in the spec), grants for both users, and an `updated_at` trigger if it has that column.
  `packages/core/src/db/schema-rules.test.ts` fails if one is missing.
- `INSERT ... RETURNING` must also pass the table's read policy, so a context that may add rows but not read them (for example a visitor queueing an email in `email_outbox`) reserves the id with `nextval` and inserts without `RETURNING`.
- Background jobs are sent with `JobQueue.send(tx, ...)` inside the business transaction, and every queue is listed in `packages/core/src/jobs.ts` so `pnpm db:migrate` creates it.
- Short secrets that wait in the database, such as sign-in codes, are sealed with `sealSecret` (`MESSAGE_ENCRYPTION_KEY`) and removed once used.
- Status columns are `text` with a `CHECK` constraint listing allowed values.
  Adding a state means a new migration.
- Every table has `created_at`, and mutable tables also have `updated_at`.
  Use soft delete (`deleted_at`) only for products and addresses.
- Use UUID primary keys for anything that appears in a URL and `bigserial` for append-only logs.
- Every list the UI shows needs a matching composite index and keyset pagination with the helpers in `packages/core/src/lib/pagination.ts`, whose cursor keeps microseconds.
  Never use OFFSET.
- Never edit a migration that has already run anywhere.
  Add a new one.
- Emails go through `email_outbox`, written in the same transaction as the business change.
- Every admin action writes to `audit_logs`, and every order state change writes to `order_events`.
- Secrets live only in environment variables.
  Never commit `.env` files, keys, or tokens, and never log OTP codes, session tokens, or webhook secrets.
- Authentication is Better Auth (decided 2 October 2026) with the `emailOTP`, `phoneNumber`, and `admin` plugins and the Drizzle adapter (`provider: "pg"`, `usePlural: true`, `advanced.database.generateId: "uuid"`).
  Its configuration lives in `packages/core/src/modules/auth/`, and it is mounted at `apps/web/src/app/api/auth/[...all]/route.ts`.
- The tables `users`, `sessions`, `accounts`, `verifications`, and `auth_rate_limits` belong to Better Auth.
  Generate their schema with its CLI, never hand-edit them, and read or change users and sessions only through the Better Auth API (`getSession`, `createUser`, `setRole`, `banUser`).
  Suspending an account is `banUser`.
- Accounts that an administrator creates (administrators and sellers) are created with `emailVerified: true`, because Better Auth's clean-up for unverified accounts does not work with UUID ids (see the backend spec, step 2).
- Seller accounts are made only by `createSeller`, together with their business; Better Auth's administrator endpoints refuse the `seller` role and refuse to change the role of an account that owns a business.
- OTP codes are stored hashed (`storeOTP: "hashed"`), and the OTP delivery callbacks only queue the email or SMS; they never send inline.
- Object storage buckets are private, and every download is a short-lived signed URL.

## AI features

- Every AI call goes through `packages/core/src/lib/ai/`, one OpenAI-compatible HTTP client whose base URL, API key, and model names come from environment variables (`AI_BASE_URL`, `AI_API_KEY`, `AI_CHAT_MODEL`, `AI_VISION_MODEL`, `AI_EMBED_MODEL`, `AI_EMBED_DIMENSIONS`, see design doc section 3.2).
  Never import a vendor SDK anywhere else, and never hard-code a provider or model name outside that folder.
- The gateway is OpenRouter (`https://openrouter.ai/api/v1`), decided by the client on 2 October 2026.
  Chat and vision use `deepseek/deepseek-v4.1-flash`; embeddings use `voyageai/voyage-multimodal-3.5` at 1024 dimensions.
  Changing a model is a configuration change, and changing the embedding model also needs a re-embed job.
- Ask for JSON with `response_format`, put the word "json" and an example of the shape in the prompt, validate the reply against a schema, and retry once.
  Never trust an unvalidated reply, even when the gateway advertises structured outputs.
- Send images as `image_url` content parts pointing at the resized card-size image on CloudFront, never the original upload.
- Embeddings live in `product_embeddings` as `vector(1024)`: one `text` row per product and one `image` row per product image, all from the same multimodal model, so text and photos share one index.
  Use `input_type: search_document` for catalogue items and `search_query` for buyer queries.
  Re-embed only when `content_hash` changes.
- Log every AI call in `ai_requests`.
  Check the cache on `(feature, input_hash)` first, and enforce the daily platform and per-seller limits before calling out.
- Run deterministic checks before AI checks.
  For example, listing screening checks price above MRP and prohibited terms before asking the model.
- The shopping assistant answers only from the product data it was given and says so when it cannot answer.
  It returns a structured object with cited product ids, and the storefront renders product cards from that object, never raw model text as HTML.

## Naming and locale

- Use British and Indian English spelling in code, UI, and docs, matching the design doc: `catalogue`, `colour`, `cancelled`.
- Show money in rupees with Indian digit grouping, for example `new Intl.NumberFormat('en-IN', { style: 'currency', currency: 'INR' })` gives ₹1,00,000.
- Store times as `timestamptz` and show them in `Asia/Kolkata`.
- Store phone numbers in E.164 format (`+91...`).

## Scope and priorities

- Scope is fixed by quotation version 4.0 (14 September 2026).
  Do not build features outside it.
  If you spot a good idea, suggest it as a post-launch item and move on.
- If the launch date is at risk, this order wins: payment integrity, order accuracy, catalogue management, the core buyer journey, and only then AI conveniences.
- The launch-critical automated tests cover checkout, webhook idempotency, stock under concurrency, and row-level security.
  Keep them green at all times.

## How to work

- Before a non-trivial change, read the matching design doc section and the existing code in that module, then make a short plan.
- Match the style of the code around you.
  Comments explain why, not what.
- For a bug, first reproduce it the way a user would hit it (in the browser or through the real API), then fix it, then show the same reproduction passing.
- A task is done only when typecheck, lint, and the relevant tests pass.
  Show the command you ran and its output as evidence instead of just saying it works.
- For UI work, check the result in Chrome and Safari at phone and desktop widths, and fix anything that looks off even if it was not part of the task.
- If you see a lint error, a failing test, or a flaky test, fix it or raise it.
  Never leave it silently.

## Communication

- Always explain things in simple terms.
  Use short sentences and everyday words, and define any technical term the first time you use it.
- Start with the answer or the result, then give the reason.
- When an idea is tricky, add a small concrete example from EcoKart, such as an order, a seller, or a coupon.
- Assume the client may read anything in `docs/`, so write docs in plain language, the way the design doc is written.
- If something is unclear or the decision belongs to the client, ask instead of guessing.

## Writing and attribution

- Never add your name, "Claude", "AI-generated", or any similar attribution to code comments, commit messages, PR descriptions, or docs.
  This includes `Co-Authored-By` and "Generated with" lines.
- Never use the em dash character.
  Use a plain hyphen (-) instead.
- In long Markdown files, put each sentence on its own line.
