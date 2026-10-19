# EcoKart System Design

Version 1, written 1 October 2026.
This document is the technical foundation for the EcoKart web marketplace described in the revised quotation (version 4.0, 14 September 2026).
It explains the architecture, the database tables, the main flows, and the choices that keep the system fast at launch and able to grow without a rewrite.
It is written in plain language so that both the developer and the client can read it.

## 1. What we are building

EcoKart is a multi-vendor marketplace for India with three kinds of users.

- Buyers browse, search, add to cart, pay through Razorpay or cash on delivery, and track orders and returns.
- Sellers manage their catalogue, stock, dispatch, and earnings through a seller portal.
- Administrators approve sellers and listings, manage categories, coupons, orders, returns, refunds, and platform settings.

On top of the marketplace sits a small AI layer.
It drafts listings from photographs, maps spreadsheet columns during import, screens submitted listings, powers natural-language and image search, recommends similar products, and answers product questions from catalogue data only.

The launch is web only, one responsive Next.js application, delivered by a single developer in 42 working days.
Everything below is chosen to fit that reality: one application, one database, one background worker, and nothing that needs a dedicated operations team.

## 2. Architecture at a glance

The system has five moving parts.

| Part | What it does | Runs where |
| --- | --- | --- |
| Next.js web app | Storefront, seller portal, admin console, API routes, Razorpay webhook | One or more stateless containers |
| Worker process | Background jobs: AI drafts, embeddings, imports, invoice PDFs, emails, order expiry | A plain Node.js program written in TypeScript, one container built from the same codebase |
| PostgreSQL | All data, full-text search, vector search (pgvector), and the job queue (pg-boss) | PostgreSQL 16 with pgvector in a Docker container, the same image as local development (not Amazon RDS for now) |
| Object storage + CDN | Product images, import files, invoice PDFs, static assets | Private S3 bucket behind CloudFront |
| External services | Razorpay; AI through OpenRouter (DeepSeek V4.1 Flash for chat and vision, Voyage Multimodal 3.5 for embeddings); a transactional email provider; an SMS provider | Client-owned accounts |

Everything we host runs in the client's AWS account in the Mumbai region (`ap-south-1`).
AWS is used for hosting only; AI, payments, email, and SMS are separate client-owned accounts reached over HTTPS.

The web app never does slow work inside a request.
Anything that talks to an AI model, resizes an image, builds a PDF, sends an email, or processes a file is queued and handled by the worker.
This keeps every page and API response fast and keeps the web app easy to scale by adding containers.

The database is deliberately the only stateful piece we operate.
Keeping search, vectors, and the job queue inside Postgres avoids running Elasticsearch, Redis, or a separate vector database at launch.
Each of those can be added later if measurements show a need, and the code is structured so that the swap is local.

## 3. Technology choices and why

| Concern | Choice | Why this one |
| --- | --- | --- |
| Framework | Next.js (App Router), React, TypeScript | Fixed by the quotation. Server components give fast, cacheable public pages and one codebase for all three surfaces. |
| Database access | Drizzle ORM with SQL migrations | Thin layer over SQL, easy to combine with row-level security and raw queries for search. Steps 1 to 6 are built on it. |
| Auth | Better Auth (open source, MIT) with its email OTP, phone number, and admin plugins, sessions stored in Postgres through its Drizzle adapter | Decided by the client. It covers OTP login by email and SMS, roles, suspension, and session handling out of the box, so we do not write auth ourselves. It runs inside our app and database, so there is no third-party auth service and row-level security works unchanged. |
| Background jobs | pg-boss (queue stored in Postgres) with a worker process | Reliable retries and scheduling with zero extra infrastructure. |
| Search | Postgres full-text (`tsvector`), trigram fuzzy match (`pg_trgm`), and pgvector (HNSW index) | One database answers keyword, semantic, and image search with filters in a single query. Sufficient well past one million products. |
| AI gateway | OpenRouter, one OpenAI-compatible endpoint and one key per environment for chat, vision, and embeddings | Decided by the client. Any model is a configuration change, and the same client can point straight at a provider if OpenRouter is ever unavailable. |
| AI chat and vision | `deepseek/deepseek-v4.1-flash` through OpenRouter: DeepSeek's current flash model, reads text and images, 1M context, JSON output | The client's chosen model family at a very low price per token. Reads photographs, so listing drafts from photos and image screening use the same model as every text task. Every JSON reply is validated against a schema and retried once. |
| AI embeddings | `voyageai/voyage-multimodal-3.5` through OpenRouter at 1024 dimensions | DeepSeek has no embeddings endpoint, and this model embeds text and images into one space. One index serves semantic search, image search, and similar products, and an uploaded photo is embedded directly without a vision call. |
| Media | Direct browser upload to S3 with presigned URLs; worker resizes into fixed sizes | Uploads never pass through the web app. Images are served from CloudFront with immutable cache headers. |
| Invoice PDFs | pdfmake (open source, MIT) in the worker, with the Noto Sans font (SIL Open Font License) | The layout is plain data, so the format the chartered accountant approves can change without code that draws pages. It breaks long tables across pages, and Noto Sans has the rupee sign. |
| Payments | Razorpay hosted checkout, Orders API, and signature-verified webhooks | Fixed by the quotation. No card data ever touches EcoKart. |
| Email and SMS | A transactional email API (Resend or Amazon SES, one adapter either way); an Indian SMS provider with DLT approval (MSG91 or similar) for OTP. Locally, both go to Mailpit, a mail catcher in Docker. | Email OTP works from day one; SMS OTP switches on when DLT approval arrives. |
| Hosting | AWS Mumbai, hosting only: ECS Fargate for the web and worker containers, PostgreSQL with pgvector in Docker, S3 + CloudFront, Secrets Manager | Client-owned account as the quotation requires. Infrastructure is defined as code, and staging and production are two environments of the same definition. |

### 3.1 AWS deployment shape

| AWS service | Role in EcoKart |
| --- | --- |
| ECR | Stores the one Docker image that both services run; it must include ffmpeg, which the worker uses to convert product videos |
| ECS Fargate, service `web` | Next.js app behind an Application Load Balancer; two tasks in production, one in staging |
| ECS Fargate, service `worker` | The job runner; one task, no load balancer, scheduled jobs come from pg-boss cron inside it |
| PostgreSQL 16 in Docker | The `pgvector/pgvector` image from `compose.yaml` with its data on a persistent volume, in a private subnet, with the `vector` and `pg_trgm` extensions. Decided 5 October 2026 instead of Amazon RDS, for now. Where the container runs and how it is backed up are settled with the compute shape and the backup plan (section 11). |
| S3 | One private bucket per environment for images, import files, and invoice PDFs, with a CORS rule for uploads from the web app's address and a lifecycle rule that deletes unused uploads after a day. Locally, SeaweedFS from `compose.yaml` stands in for it. |
| CloudFront | One distribution in front of the ALB for TLS and static files, passing page HTML through to Next.js (whose cache is refreshed by tags, section 7), and one in front of the bucket with origin access control for photos |
| Route 53 + ACM | DNS and certificates |
| Secrets Manager | Database password, Razorpay keys, AI provider keys, email and SMS keys, injected into task definitions |
| CloudWatch | Logs from both services and alarms on error rate, queue depth, and database CPU |
| GitHub Actions | Will build the image, push to ECR, run migrations, deploy staging, and promote to production on approval; today it runs the checks on every pull request |

AWS is used for hosting only.
The AI, email, and SMS providers are ordinary HTTPS APIs called from the web and worker tasks, with their keys in Secrets Manager.
Infrastructure will be defined with the AWS CDK in the same repository, so the staging and production environments cannot drift apart; that code is not written yet.
Each container keeps its own small application-side connection pool; a separate connection pooler such as PgBouncer is added only if the number of tasks grows large.

### 3.2 AI provider layer

Decided on 2 October 2026: every AI call goes through OpenRouter.
Chat and vision use DeepSeek V4.1 Flash, and embeddings use Voyage Multimodal 3.5.

The application never imports a vendor SDK.
Every AI call goes through one small HTTP client that speaks the OpenAI-compatible format, which OpenRouter, DeepSeek, and most other providers accept.
Which model answers is decided by environment variables, so changing a model is a configuration change and not a code change.

| Capability | Interface | Model through OpenRouter | Used by |
| --- | --- | --- | --- |
| Chat (text in, JSON out) | `TextModel.json(prompt, schema)` validates the reply against a schema and retries once on invalid output | `deepseek/deepseek-v4.1-flash` | Listing text, import mapping, missing-content suggestions, query parsing, text screening, assistant |
| Vision (images and text in, JSON out) | `VisionModel.describe(images, prompt, schema)` | `deepseek/deepseek-v4.1-flash` (accepts image input, 1M context) | Listing builder from photos, unusable-image screening |
| Embeddings (text or image in, vector out) | `Embedder.embed(inputs)` returns one 1024-dimension vector per text or image | `voyageai/voyage-multimodal-3.5` with `dimensions: 1024` | Product text, product images, search queries, uploaded photos, similar products |

Configuration lives in environment variables, with the same names in staging and production.

```
AI_ENABLED=true                          false switches every AI feature off (decided 12 October 2026)
AI_BASE_URL=https://openrouter.ai/api/v1
AI_API_KEY=<OpenRouter key for this environment>
AI_CHAT_MODEL=deepseek/deepseek-v4.1-flash
AI_VISION_MODEL=deepseek/deepseek-v4.1-flash
AI_EMBED_MODEL=voyageai/voyage-multimodal-3.5
AI_EMBED_DIMENSIONS=1024
AI_EMBED_BASE_URL and AI_EMBED_API_KEY   optional overrides, so embeddings can move to another provider without touching chat
```

How OpenRouter is used.

- One API key per environment, each with a credit limit set in the OpenRouter dashboard.
  That limit is the hard cap behind the daily limits counted in `ai_requests`.
- Chat requests ask for JSON mode with `response_format: { "type": "json_object" }`, and every prompt carries an example of the answer's shape.
  The schema itself is not sent (decided 12 October 2026): OpenRouter lists DeepSeek's own endpoint, which our routing prefers, without schema-enforced output, so every reply is validated in code instead and asked for once more if it does not fit.
- Image inputs are sent as `image_url` content parts pointing at the resized card-size image on CloudFront, never the original upload.
- Embedding requests send `input_type: search_document` for catalogue items and `search_query` for buyer queries, and images as `image_url` content parts in the same request format.
- The OpenRouter account's data policy is set to exclude providers that train on prompts, and routing prefers DeepSeek's own endpoint, so catalogue text goes to as few third parties as possible.
- OpenRouter reports each call's cost in its credits, which are US dollars, and `ai_requests` stores it as reported, in millionths of a dollar (decided 12 October 2026).
  DeepSeek direct reports tokens but no cost.
- `AI_ENABLED` must be set in every environment, so AI can be switched off on purpose, for example at launch before the key arrives, and never by a key that went missing.
  When it is `false`, every AI feature answers that it is switched off and the rest of the shop works as before.
- A DeepSeek direct key is kept in Secrets Manager as the emergency switch.
  If OpenRouter is unreachable, pointing `AI_BASE_URL` at `https://api.deepseek.com` with model `deepseek-flash` restores chat and vision; embedding jobs simply wait in the queue until the gateway is back.

Two rules apply to every AI call regardless of provider.
Only catalogue data and the buyer's own question are sent; buyer identity, addresses, and order history never leave EcoKart.
Every call is logged in `ai_requests` with its cost, is subject to the daily limits, and is cached by input hash.

## 4. Code layout

One repository, set up as a pnpm workspace (a monorepo) with two apps and one shared package.
The Next.js app and the worker are separate programs, but both use the same business logic from `packages/core`, so every rule still has exactly one implementation.

```
apps/
  web/                         Next.js app (@ecokart/web)
    src/app/
      (storefront)/            public pages, buyer account, cart, checkout
      seller/                  seller portal
      admin/                   admin console
      api/health/route.ts      health check for the load balancer and smoke tests
      api/auth/[...all]/route.ts   Better Auth: sign-in codes, sessions, administrator account endpoints
      api/me/route.ts          the signed-in account, its roles, and its seller id
      api/account/seller-application/  a buyer applies to sell, reads the application, and changes it
      api/admin/settings/      administrators read and change platform settings
      api/admin/sellers/       administrators create, approve, reject, suspend, and reinstate sellers,
                               ask a seller for verification documents, and enter their bank account
      api/admin/seller-documents/  administrators' queue of documents to review; one request's
                               history, file downloads, accepting, rejecting, and cancelling
      api/seller/profile/      a seller's own business details and support contacts
      api/seller/documents/    the documents asked of a seller, and uploading them
      api/seller/bank-account/ the bank account a seller's payouts go to, last 4 digits only
      api/seller/products/     a seller's listings, variants, stock, and photos; submitting
                               for review, moving back to draft, and archiving
      api/invoices/            an order's invoices and their PDF downloads, for its buyer and sellers
      api/seller/invoices/     a seller's own invoices
      api/admin/invoices/      administrators have an invoice PDF made again
      api/categories/          the visible category tree, for anyone
      api/brands/              active brands A to Z, for anyone
      api/admin/categories/    administrators build and change the category tree
      api/admin/brands/        administrators keep the list of brands
      api/admin/moderation/    administrators' queue of listings waiting for review
      api/admin/products/      administrators review one listing, approve or reject it, and
                               take down a listing on sale
      api/account/addresses/   a signed-in buyer's saved delivery addresses
      api/account/return-photos/  a buyer's return photos: upload, add, and follow the check
      api/return-photos/[id]/file/  a return photo through a short-lived link, for its buyer,
                               the seller of the return, and administrators
      api/admin/ai/usage/      administrators see AI calls, tokens, and cost per day, and today's calls against the limit
      api/home/                the home page: new arrivals and a row per top-level category
      api/products/[slug]/     one product page, for anyone
      api/categories/[slug]/products/   a category page with filters, sorting, and pages
      api/search/              keyword search, limited per visitor address
      api/admin/search/gaps/   the catalogue gap report: searches that found nothing
      api/products/[slug]/reviews/   a product's published reviews for anyone; a buyer writes one,
                               and reads or changes their own under reviews/mine
      api/admin/reviews/       administrators list reviews and hide one or show it again
      api/content/[slug]/      a published policy page in Markdown, for anyone
      api/admin/content/       administrators write and publish the policy pages
      api/company/             the company details and grievance officer for the storefront footer
      api/webhooks/razorpay/route.ts
    src/lib/                   api.ts (handleErrors, one HTTP answer per error), request-context.ts,
                               auth.ts, db.ts, queue.ts, storage.ts, sellers.ts, settings.ts,
                               storefront.ts (the public reads the API and storefront pages share),
                               product-photos.ts (next/image loader for the pre-sized photos)
    src/instrumentation.ts     checks every setting when the server starts, and stops it if one is wrong
    src/cache-handler.ts       the 'use cache' handler: Next.js's in-memory cache, plus the changed tags
                               read from cache_invalidations every second (section 7)
    scripts/create-admin.ts    `pnpm admin:create`: the first administrator
  worker/                      background worker (@ecokart/worker)
    src/main.ts                process entry: reads settings, starts, stops gracefully
    src/worker.ts              starts pg-boss and registers every module's jobs
packages/
  core/                        business logic shared by web and worker (@ecokart/core)
    src/modules/
      auth/  catalogue/  cart/  checkout/  orders/  payments/  ledger/
      invoices/  returns/  search/  ai/  imports/  notifications/
      settings/  audit/  sellers/  rate-limits/
      addresses/  reviews/  content/  assistant/
        (each module has service.ts, plus jobs.ts, types.ts, or config.ts where needed; the
         catalogue splits its services by topic: categories.ts, brands.ts,
         tree.ts for the in-memory category tree, products.ts, images.ts,
         summary.ts for the summary fields on products, moderation.ts for
         submitting, reviewing, and archiving listings, screening.ts for the
         screening job, embeddings.ts for the product embeddings that
         search uses, storefront.ts and storefront-types.ts for the public
         product, category, and home pages and the product list they share
         with search, storefront-cache.ts for the cache tags and
         invalidateStorefront, and jobs.ts; search/ turns a request into
         filters, logs it, limits it, and reads the catalogue's product list)
    src/db/
      pool.ts                  database connection pool
      client.ts                Drizzle database on top of the pool
      context.ts               withContext(): one transaction with the row-level security context
      migrate.ts               `pnpm db:migrate`: SQL migrations, database users, job queue tables
      seed.ts                  `pnpm db:seed`: example data for local development only
      schema/                  Drizzle schema, one file per domain
      migrations/              SQL migrations including RLS policies and indexes
    src/jobs.ts                every job queue and its retry settings, created by `pnpm db:migrate`
    src/worker.ts              worker-only exports (`@ecokart/core/worker`), such as the photo and
                               video jobs and the invoice PDF job, so the web app never loads the
                               image or PDF library or runs ffmpeg
    src/cache.ts               what the web app's cache handler needs (`@ecokart/core/cache`)
    src/errors.ts              the errors services throw; the web app turns each into one HTTP status
    src/index.ts               everything the web app and worker may use; src/env.ts reads required settings
    src/testing/               test database setup and fixtures, used only by tests
    src/lib/
      razorpay.ts  email.ts  sms.ts
      cache.ts       the shared log of changed cache tags (cache_invalidations): record, read, clear
      storage.ts     one S3 client: signed upload forms, signed download links, reading and writing
                     objects, public photo addresses
      storage-setup.ts  sets up the local bucket (`pnpm db:up`) and the test buckets
      images.ts      photo formats, limits, and sizes
      image-processing.ts  checks photos and makes the sizes; loaded only by the worker
      videos.ts      video formats and limits
      video-processing.ts  checks and converts videos with ffmpeg; loaded only by the worker
      spreadsheets.ts  reads CSV and Excel catalogue files as text; loaded only by the worker
      csv.ts         writes CSV files people download, with formulas made harmless
      queue.ts       sends pg-boss jobs inside the caller's transaction
      encryption.ts  seals short secrets, such as queued sign-in codes
      config.ts      validates environment variables at startup
      validation.ts  shared formats (GSTIN, PAN, PIN code, state code, phone, money, GST rates,
                     HSN codes, slugs) and parseInput, which turns problems into plain words
      postgres.ts    recognises unique and foreign-key errors, so services can explain them
      mailpit.ts     local mail catcher, for development and tests only
      pagination.ts  keyset pagination with exact (microsecond) cursors
      slug.ts        readable names for web addresses, numbered when taken
      client-address.ts  the visitor's IP address, read from the trusted end of X-Forwarded-For
      states.ts      the GST state codes with their names; imports nothing, so the browser
                     can use it too (`@ecokart/core/states`)
      ai/
        client.ts      one OpenAI-compatible HTTP client; base URL, key, model from env
        chat.ts        TextModel and VisionModel on top of the chat client
        embed.ts       Embedder on top of the embeddings client
        index.ts       builds the three models from the AI settings
        config.ts      reads and checks the AI settings (`AI_ENABLED` and the rest) at startup
    assets/fonts/              Noto Sans for invoice PDFs, with its licence
compose.yaml                   local PostgreSQL 16 with pgvector, Mailpit, and SeaweedFS (S3-compatible
                               object storage standing in for S3 and CloudFront), for development
```

Both programs are Node.js.
The web app is Next.js, which is itself a Node.js server, and the worker is a plain Node.js process with no HTTP server at all; it connects to Postgres, takes jobs from pg-boss, and runs the same module code the web app uses.
Better Auth lives in `packages/core/src/modules/auth/` (its configuration, plugins, and the OTP delivery callbacks) and is mounted in the web app at `apps/web/src/app/api/auth/[...all]/route.ts`.

Splitting the apps keeps each one small.
The worker never loads Next.js, and the web app never loads worker-only code.
`packages/core` is plain TypeScript with no build step of its own.
The worker runs it directly on Node.js 24, and the web app compiles it as part of its own build.

Three rules keep this maintainable.

1. Pages, server actions, and API routes call module services; they never write SQL themselves.
2. Module services own their tables and expose plain functions; jobs call the same services, so there is one implementation of every rule.
3. Modules talk to each other through their public service functions, never by reaching into another module's tables.

## 5. Data model

### 5.1 Principles

- Every amount is stored as an integer number of paise in a `bigint` column named `*_paise`. No floating point anywhere near money.
- Tax rates are stored in basis points in `*_bps` columns, so 18 percent is `1800`.
- Prices are tax inclusive, as they are shown to buyers. GST is back-calculated at order time and frozen on the order line.
- Orders snapshot everything they need: product title, SKU, options, price, MRP, GST rate, HSN code, address, and commission rate. Later catalogue edits never change a past order or invoice.
- Primary keys are UUIDs for entities exposed in URLs and `bigserial` for append-only logs.
- Every table has `created_at`; mutable tables also have `updated_at`, kept current by a database trigger.
  Soft delete (`deleted_at`) is used only where history matters (products, addresses).
- Status columns are `text` with a `CHECK` constraint listing the allowed values, so adding a state is a migration and not a type change.
- Products carry denormalised summary fields (minimum price, total stock, rating average) so listing and search pages never join variants or reviews.

### 5.2 Table list

| Domain | Tables |
| --- | --- |
| Identity | `users`, `sessions`, `accounts`, `verifications`, `auth_rate_limits` (the five managed by Better Auth), `addresses` |
| Sellers | `sellers`, `seller_document_requests`, `seller_document_files` |
| Catalogue | `categories`, `brands`, `products`, `product_variants`, `product_images`, `product_videos`, `product_moderation`, `product_embeddings` |
| Cart and promotions | `carts`, `cart_items`, `coupons` |
| Orders | `orders`, `order_items`, `shipments`, `order_events`, `return_requests`, `return_photos`, `invoices` |
| Payments | `payments`, `payment_events`, `refunds` |
| Seller money | `seller_ledger_entries`, `seller_bank_accounts` |
| Reviews | `reviews` |
| Imports | `catalogue_imports`, `catalogue_import_rows` |
| AI and search | `ai_requests`, `search_queries` |
| Platform | `platform_settings`, `content_pages`, `email_outbox`, `audit_logs`, `rate_limits`, `cache_invalidations` |

That is 43 tables, five of them owned by Better Auth, plus the schema that pg-boss creates for itself.
Better Auth keeps its rate-limit counters in `auth_rate_limits`; our own `rate_limits` table, with a different shape, serves the per-address sign-in code limit, and later checkout, search, and AI.

### 5.3 Identity

The first four tables are created and maintained by Better Auth.
Its CLI generates their Drizzle schema, and application code never reads or writes them directly; it goes through Better Auth, either its API in requests or its internal adapter (`AccountDirectory`) in services.
They use UUID ids (`advanced.database.generateId: "uuid"`) and plural snake_case names (`usePlural`) so they look like the rest of the database.
They carry no row-level security policies, because Better Auth is the only code that touches them.
Better Auth also creates `auth_rate_limits` for its rate-limit counters.
Their time columns are `timestamp` without a time zone holding UTC, because that is what the Better Auth CLI generates; every other table uses `timestamptz`.
A CHECK constraint on `users.role` allows only `buyer`, `seller`, `admin`, and `buyer,seller`.

```
users                                   core + phone number plugin + admin plugin
  id                      uuid PK
  name                    text
  email                   text UNIQUE   phone-only accounts get a placeholder generated by the plugin
  email_verified          boolean
  image                   text, nullable
  phone_number            text UNIQUE, nullable, E.164 format
  phone_number_verified   boolean
  role                    text   buyer | seller | admin | buyer,seller (the admin plugin's comma-separated roles)
  banned                  boolean       our "suspended"
  ban_reason              text
  ban_expires             timestamp (UTC)
  created_at, updated_at

sessions                                core + admin plugin
  id               uuid PK
  user_id          uuid FK users
  token            text UNIQUE   the cookie value, opaque
  expires_at       timestamp (UTC)
  ip_address       text
  user_agent       text
  impersonated_by  text, nullable   set when an admin impersonates a user
  created_at, updated_at
  INDEX (user_id)

accounts                                core; for password and social sign-in, so empty at launch
  id            uuid PK
  user_id       uuid FK users
  provider_id   text    for example credential; code sign-in writes no rows here
  account_id    text
  access_token, refresh_token, id_token        text, nullable
  access_token_expires_at, refresh_token_expires_at   timestamp, nullable
  scope         text, nullable
  password      text, nullable   unused: EcoKart has no passwords
  created_at, updated_at
  INDEX (user_id)

verifications                           core; holds OTP codes while they are valid
  id            uuid PK
  identifier    text    the email or phone the code was sent to
  value         text    email codes stored hashed (storeOTP: hashed); phone codes as a hash
                        keyed with the auth secret (backend spec, step 2)
  expires_at    timestamp (UTC)
  created_at, updated_at
  INDEX (identifier)

auth_rate_limits                        Better Auth's rate-limit counters
  id            uuid PK
  key           text UNIQUE   the address and path being counted
  count         int
  last_request  bigint        milliseconds since 1970

addresses
  id            uuid PK
  user_id       uuid FK users
  full_name, phone, line1, line2, landmark, city
  state_code    char(2)   two-digit GST state code (e.g. 27 for Maharashtra), used for GST place of supply
  pincode       char(6)
  is_default    boolean
  created_at, updated_at, deleted_at
  INDEX (user_id)
  UNIQUE (user_id) WHERE is_default AND deleted_at IS NULL     one default address per buyer
```

A buyer keeps up to 20 addresses, and always has exactly one default while they have any.
The delivery phone must be an Indian mobile number, and the state code must be one of the 36 GST state codes; the database checks only the broader formats.
Deleting an address sets `deleted_at`, and nothing refers to an address by foreign key, because an order copies the address into `orders.shipping_address` at checkout (backend spec, step 10).

One account can be both buyer and seller (decided 20 October 2026); an administrator has only the `admin` role.
A seller account comes about in one of two ways.
An administrator creates it through the seller onboarding, which creates the owner's account with the `seller` role through Better Auth (its internal `createUser`) and the linked `sellers` row together; if the business cannot be saved, the new account is removed again.
Or a signed-in buyer applies to sell (section 5.4), and approving the application adds the `seller` role to their account through Better Auth's internal adapter, keeping `buyer`.
Better Auth's own administrator endpoints refuse to hand out the `seller` role, so an account with that role always has a business.
An account that both buys and sells picks the role it acts in by the area of each request: the seller portal and its APIs act as the seller, everything else as the buyer, and routes both use (an order's invoices, return photos) take `?as=seller` from the seller portal.
Each request still runs with one role in its row-level security context, so the policies are the same as for two separate accounts.
Suspending a buyer is Better Auth's ban (its `banUser` endpoint), which also revokes every session; the reason is kept in `ban_reason`.
Suspending a seller suspends the business (section 5.4): its listings leave the storefront and the seller portal refuses it.
An account that only sells, which an administrator created, is banned as well, as before; an account that also buys keeps signing in and shopping, and banning that login stays a separate administrator action.

### 5.4 Sellers

```
sellers
  id                uuid PK
  owner_user_id     uuid FK users, UNIQUE
  slug              text UNIQUE
  display_name      text
  legal_name        text
  gstin, pan        text, nullable until approval, which needs both; kept from then on,
                    because every sale needs a GST invoice
  line1, city, state_code, pincode
  support_email, support_phone
  commission_bps    int, nullable   overrides the platform default when set
  invoice_prefix    text UNIQUE     1 to 4 capital letters or digits, used in GST invoice numbers
  invoice_seq       int default 0
  invoice_seq_fy    text            financial year the sequence belongs to, e.g. 2026-27
  status            text   pending | approved | suspended | rejected
  approved_at, suspended_reason
  rejection_reason  text, nullable   why an administrator rejected the application, shown to the applicant
  created_at, updated_at
  INDEX (status, created_at DESC, id DESC)     the administrators' seller list
  INDEX (created_at DESC, id DESC)

seller_document_requests        a document an administrator asks a seller for: GST certificate, PAN card,
                                bank proof, business registration, address proof, or other, with a note;
                                requested | processing | received | accepted | cancelled (with a reason).
                                A seller is approved only once every request is accepted or cancelled.
seller_document_files           each file the seller uploads for a request (PDF, JPEG, or PNG, at most 10 MB),
                                with the worker's check (photos re-encoded) and the administrator's
                                acceptance or rejection reason, kept as the request's history
```

A signed-in buyer applies to sell with the business details: display name, legal name, GSTIN, PAN, address, support email, and support phone.
The application is their own `sellers` row, `pending`, with `owner_user_id` set to their account, so each account has at most one; an invoice prefix is suggested from the display name when they leave it out, and an administrator can change it until the first invoice.
While it waits, the applicant reads its status, changes the details, and uploads the documents an administrator asks for through the same document flow as any seller, and keeps shopping as a buyer.
Administrators see applications in the seller list filtered to `pending`, and approve them with the same rules as any seller.
Or they reject one with a reason: the status becomes `rejected`, and the applicant may change the details and apply again, which makes it `pending` once more.
Each decision is written to `audit_logs` and emailed to the applicant through `email_outbox`.

### 5.5 Catalogue

```
categories
  id                uuid PK
  parent_id         uuid FK categories, nullable
  name, slug        slug UNIQUE; name UNIQUE among siblings, ignoring capital letters
  depth             int    0 to 2: three levels at most
  gst_rate_bps      int    the client's chartered accountant approves this per category; one of the current GST rates
  default_hsn_code  text, nullable   4, 6, or 8 digits
  sort_order        int
  is_active         boolean  an inactive category hides everything below it
  created_at, updated_at
  INDEX (parent_id, sort_order)

brands
  id        uuid PK
  name      text   UNIQUE ignoring capital letters
  slug      text UNIQUE
  is_active boolean

products
  id                  uuid PK
  seller_id           uuid FK sellers
  category_id         uuid FK categories
  brand_id            uuid FK brands, nullable
  title               text
  slug                text UNIQUE
  description         text
  highlights          jsonb   array of short bullet strings
  attributes          jsonb   object, e.g. {"material": "bamboo"}
  option_names        text[]  e.g. {Size, Colour}; variants carry the values
  hsn_code            text    4, 6, or 8 digits
  gst_rate_bps        int     copied from the category at approval, can be overridden
  min_order_quantity  int     default 1, between 1 and 1000 (a CHECK); the fewest units of
                              one variant a buyer may order at once, changeable any time
  status              text    draft | pending_review | approved | rejected | archived
  rejection_reason    text
  published_at        timestamptz   first approval; an approved product also has its
                                    GST rate and HSN code (a CHECK)
  -- denormalised read fields, maintained by the catalogue service on every write
  min_price_paise     bigint
  max_price_paise     bigint
  min_mrp_paise       bigint
  total_stock         int
  in_stock            boolean GENERATED AS (total_stock > 0)
  rating_avg          numeric(3,2)
  rating_count        int
  primary_image_id    uuid FK product_images, ON DELETE SET NULL; the first ready photo
  -- search
  search_text         text      title + brand + category + highlights, rebuilt on write
  search_vector       tsvector  GENERATED from search_text
  ai_draft_request_id uuid FK ai_requests, nullable
  created_at, updated_at, deleted_at
  INDEX (seller_id, created_at DESC, id DESC)            the seller's list
  INDEX (seller_id, status, created_at DESC, id DESC)
  INDEX (category_id, status)
  INDEX (status, created_at DESC, id DESC)
  INDEX (status, min_price_paise, id)
  -- storefront lists, only products on sale (WHERE status = 'approved' AND deleted_at IS NULL)
  INDEX (category_id, published_at DESC, id DESC)       category pages, newest first
  INDEX (category_id, min_price_paise, id)              category pages by price, both ways
  INDEX (published_at DESC, id DESC)                    the home page's new arrivals
  INDEX (brand_id)                                      the brand filter
  GIN INDEX (search_vector)
  GIN INDEX (search_text gin_trgm_ops)

product_variants
  id           uuid PK
  product_id   uuid FK products
  sku          text
  options      jsonb   e.g. {"Size": "M", "Colour": "Green"}
  price_paise  bigint  CHECK (price_paise > 0)
  mrp_paise    bigint  CHECK (mrp_paise >= price_paise)
  stock        int     CHECK (stock >= 0)
  is_active    boolean
  sort_order   int     the seller's order, for example S, M, L
  created_at, updated_at
  UNIQUE (product_id, sku)

product_images
  id            uuid PK
  product_id    uuid FK products
  variant_id    uuid FK product_variants, nullable
  storage_key   text UNIQUE   images/{id}; the public sizes are images/{id}/{thumb|card|gallery}.webp
  status        text    processing | ready | failed
  upload_key    text    UNIQUE, the browser's upload, so it becomes one photo
  failure_reason text   shown to the seller when the photo cannot be used
  content_hash  text
  width, height int
  alt           text
  sort_order    int     the seller's order; the first is the main photo, and a product has
                        at most 4 photos (one main photo and three more)
  created_at, updated_at
  INDEX (product_id, sort_order)

product_videos
  id            uuid PK
  product_id    uuid FK products, UNIQUE: a product has at most one video
  storage_key   text UNIQUE   videos/{id}; the public files are videos/{id}/video.mp4 and poster.jpg
  status        text    processing | ready | failed, like a photo
  upload_key    text    UNIQUE, the browser's upload (MP4, MOV, or WebM, at most 50 MB and 60 seconds)
  failure_reason text   shown to the seller when the video cannot be used
  duration_ms, width, height int   of the converted file: H.264 and AAC in MP4, at most 720p
  created_at, updated_at

product_moderation
  id             uuid PK
  product_id     uuid FK products
  submitted_at   timestamptz
  ai_flags       jsonb   array of {code, detail}, e.g. prohibited_term, large_discount
  ai_risk        text    low | medium | high, null until screening finishes
  risk_rank      smallint GENERATED: 0 high, 1 medium, 2 low, 3 not screened yet
  ai_request_id  uuid FK ai_requests, nullable
  decision       text    approved | rejected | withdrawn (the seller took it back), nullable while open
  decided_by     uuid FK users, nullable; the administrator, the seller who withdrew,
                 or null when the system decided
  decided_at     timestamptz, set exactly when decision is
  reason         text    shown to the seller; required on rejection
  created_at, updated_at
  INDEX (product_id, created_at DESC)
  INDEX (risk_rank, submitted_at, id) WHERE decision IS NULL     the admin queue
  UNIQUE (product_id) WHERE decision IS NULL     one open review per product

product_embeddings
  id            uuid PK
  product_id    uuid FK products
  kind          text   text | image
  image_id      uuid FK product_images ON DELETE CASCADE, nullable, set when kind = image
  model         text
  content_hash  text   hash of the text or image that was embedded
  embedding     vector(1024)   Voyage Multimodal 3.5 at 1024 dimensions; changing the model means a re-embed job
  created_at
  UNIQUE NULLS NOT DISTINCT (product_id, kind, image_id)   so one text row per product
  HNSW INDEX (embedding vector_cosine_ops) WHERE kind = 'text'
  HNSW INDEX (embedding vector_cosine_ops) WHERE kind = 'image'
```

Every submission creates a new `product_moderation` row, so the history of approvals and rejections is kept.
Embeddings live in their own table because vectors are large and would slow down every scan of `products`.
The `content_hash` column means an embedding is only regenerated when the underlying text or image actually changed, which is what the quotation calls storing embeddings to avoid repeat cost.
The `text` row holds the vector of the product's text, and each `image` row holds the vector of one product image, both from the same multimodal model.
Because they share one space, a typed query can match a photo and an uploaded photo can match a description.
Changing the embedding model means a one-off re-embed job, because vectors from different models cannot be compared.

### 5.6 Cart and promotions

```
carts
  id           uuid PK
  user_id      uuid FK users, UNIQUE, nullable
  guest_token  text UNIQUE, nullable   cookie token for guests, merged on login
  coupon_code  text, nullable
  created_at, updated_at   every change to the cart or its items moves updated_at
  CHECK (user_id IS NOT NULL OR guest_token IS NOT NULL)
  INDEX (updated_at) WHERE user_id IS NULL   a nightly job removes guest carts unchanged for 31 days, after their 30-day cookie has run out

cart_items
  id          uuid PK
  cart_id     uuid FK carts
  variant_id  uuid FK product_variants
  quantity    int  CHECK (quantity BETWEEN 1 AND 1000)   at least the product's minimum buying quantity, at most the stock
  created_at, updated_at
  UNIQUE (cart_id, variant_id)

coupons
  id                  uuid PK
  code                text UNIQUE, stored upper case
  description         text
  discount_type       text   percent | fixed
  discount_value      int    basis points for percent, paise for fixed
  min_order_paise     bigint
  max_discount_paise  bigint, nullable
  usage_limit         int, nullable
  per_user_limit      int, nullable
  used_count          int default 0
  starts_at, ends_at  timestamptz
  is_active           boolean
  created_by          uuid FK users
  created_at, updated_at
  INDEX (created_at DESC, id DESC)   the administrators' coupon list
```

Cart items store no price.
Every time the cart is shown or checked out, prices and stock are read fresh from `product_variants`, so the cart can never show a stale price.
Per-user coupon usage is counted from `orders` (same coupon, same user, not cancelled), so no extra table is needed.

### 5.7 Orders

```
orders
  id                uuid PK
  order_number      text UNIQUE   human readable, e.g. EK-261001-000123 (date in India, then the next number of order_number_seq)
  user_id           uuid FK users
  status            text   pending_payment | confirmed | cancelled | completed
  payment_method    text   razorpay | cod
  subtotal_paise, discount_paise, delivery_paise, tax_paise, total_paise   bigint
  coupon_id         uuid FK coupons, nullable
  coupon_code       text, snapshot
  shipping_address  jsonb  snapshot of the address at checkout
  buyer_name, buyer_phone, buyer_email   snapshots
  placed_at, paid_at, cancelled_at, completed_at
  cancel_reason     text
  created_at, updated_at
  INDEX (user_id, created_at DESC, id DESC)
  INDEX (status, created_at, id)
  INDEX (created_at DESC, id DESC)     the administrators' list of every order

order_items
  id                    uuid PK
  order_id              uuid FK orders
  line_number           int      1, 2, 3 in cart order, so the lines always show in the same order
  seller_id             uuid FK sellers
  product_id            uuid FK products
  variant_id            uuid FK product_variants
  shipment_id           uuid FK shipments, nullable
  title, sku, options, image_key      snapshots
  hsn_code              text
  gst_rate_bps          int
  unit_price_paise, unit_mrp_paise    bigint
  quantity              int
  line_total_paise      bigint   unit price times quantity
  discount_share_paise  bigint   this line's share of the coupon discount
  taxable_paise         bigint   back-calculated from the tax-inclusive amount
  tax_paise             bigint
  commission_bps        int      snapshot of the rate applied
  commission_paise      bigint
  status                text   confirmed | dispatched | delivered | cancelled | return_requested | returned
  created_at, updated_at
  INDEX (order_id)
  INDEX (seller_id, status, created_at DESC, id DESC)

shipments
  id               uuid PK
  order_id         uuid FK orders
  seller_id        uuid FK sellers
  courier_name     text
  tracking_number  text
  tracking_url     text, nullable
  status           text   dispatched | delivered
  dispatched_at, delivered_at
  created_by       uuid FK users
  created_at
  INDEX (order_id, seller_id)

order_events
  id             bigserial PK
  order_id       uuid FK orders
  order_item_id  uuid FK order_items, nullable
  actor_user_id  uuid, nullable
  actor_role     text   buyer | seller | admin | system
  event_type     text   e.g. placed, paid, dispatched, cancelled, refund_recorded
  from_status, to_status   text
  note           text
  created_at
  INDEX (order_id, created_at)

return_requests
  id             uuid PK
  order_id       uuid FK orders
  order_item_id  uuid FK order_items
  user_id        uuid FK users
  seller_id      uuid FK sellers
  quantity       int
  reason_code    text
  reason_text    text
  images         jsonb   storage keys of buyer photos, optional
  status         text   requested | approved | rejected | refunded
  admin_note     text
  decided_by     uuid FK users, nullable
  decided_at     timestamptz
  refund_id      uuid FK refunds, nullable
  created_at, updated_at
  INDEX (status, created_at, id)
  INDEX (user_id, created_at DESC, id DESC)     the buyer's returns
  INDEX (seller_id, created_at DESC, id DESC)   the seller's returns
  UNIQUE (order_item_id) WHERE status is requested or approved: one open return per line

return_photos     a buyer's photo for a return: uploaded before the return is sent, checked and
                  re-encoded by the worker (processing | ready | failed), private, and attached
                  to the return request it was sent with, whose images list its storage key;
                  a photo can be sent within 24 hours, and one never sent is deleted after 48

invoices
  id                          uuid PK
  order_id                    uuid FK orders
  seller_id                   uuid FK sellers
  invoice_number              text UNIQUE   {seller prefix}/{FY}/{sequence}, at most 16 characters,
                                            e.g. GRB/2627/000041 (section 11)
  issued_at                   timestamptz   the time of the payment confirmation
  seller_snapshot             jsonb   legal and trade name, GSTIN, address with state name, support contacts
  buyer_snapshot              jsonb   name, delivery address with state name, order number and date,
                                      payment method, and the buyer's account id (not printed)
  place_of_supply_state_code  char(2)   the delivery address's state
  is_interstate               boolean
  taxable_paise, cgst_paise, sgst_paise, igst_paise, total_paise   bigint
  lines                       jsonb   the invoice lines exactly as printed
  pdf_storage_key             text, nullable until the worker renders it
  cancelled_at, cancel_reason   set when the order is cancelled before dispatch; the number stays used
  created_at, updated_at
  UNIQUE (order_id, seller_id)
  INDEX (seller_id, issued_at DESC, id DESC)     the seller's invoice list
```

One buyer order can contain items from several sellers.
The buyer sees one order; each seller sees only their own lines and dispatches them as their own shipment.
GST invoices are issued per seller, so there is one invoice per order per seller.
The order-level status only tracks payment and cancellation; fulfilment progress lives on the items and shipments.

### 5.8 Payments

```
payments
  id                   uuid PK
  order_id             uuid FK orders
  provider             text   razorpay | cod
  provider_order_id    text UNIQUE, nullable    Razorpay order id
  provider_payment_id  text UNIQUE, nullable    Razorpay payment id
  amount_paise         bigint
  currency             text default INR
  status               text   created | captured | failed | refunded | partially_refunded
  method               text, nullable   whatever Razorpay reports, for example upi or card, or cod; not limited to a list
  failure_reason       text
  raw                  jsonb   last provider payload
  created_at, updated_at
  INDEX (order_id)

payment_events
  id               bigserial PK
  provider         text
  event_id         text    Razorpay's x-razorpay-event-id header
  event_type       text
  payload          jsonb
  signature_valid  boolean
  received_at      timestamptz
  processed_at     timestamptz, nullable
  error            text, nullable
  UNIQUE (provider, event_id)

refunds
  id                  uuid PK
  order_id            uuid FK orders
  payment_id          uuid FK payments, nullable
  return_request_id   uuid FK return_requests, nullable
  amount_paise        bigint
  provider_refund_id  text UNIQUE, nullable   typed in by the admin from the Razorpay dashboard
  method              text   gateway | bank_transfer
  note                text
  recorded_by         uuid FK users
  recorded_at         timestamptz
  created_at
  INDEX (order_id)
  UNIQUE (return_request_id) where it is set: a return is refunded once
```

The unique constraint on `(provider, event_id)` is what makes webhook processing idempotent.
A replayed webhook inserts nothing, and the handler returns success without touching the order.

### 5.9 Seller money

```
seller_ledger_entries
  id                 bigserial PK
  seller_id          uuid FK sellers
  order_id           uuid FK orders, nullable
  order_item_id      uuid FK order_items, nullable
  return_request_id  uuid FK return_requests, nullable
  entry_type         text   sale | commission | refund_reversal | commission_reversal | payout | adjustment
  amount_paise       bigint   signed; sales are positive, commission and payouts are negative
  description        text
  reference          text, nullable   bank transfer reference for payouts
  created_by         uuid FK users, nullable
  created_at
  INDEX (seller_id, created_at, id)

seller_bank_accounts   the account a seller's payouts go to, one per seller, entered by administrators:
                       account holder, IFSC, the account number sealed with MESSAGE_ENCRYPTION_KEY,
                       and its last 4 digits, the only part ever shown
```

The ledger is append only.
A seller's balance is the sum of their entries.
A settlement statement is the CSV export of entries in a period, and a manual bank payment is recorded as a `payout` entry with the bank reference.

### 5.10 Reviews

```
reviews
  id             uuid PK
  product_id     uuid FK products
  user_id        uuid FK users
  order_item_id  uuid FK order_items, nullable   set when it is a verified purchase
  rating         smallint CHECK (rating BETWEEN 1 AND 5)
  author_name    text   the name the buyer chose to show, 1 to 50 characters, frozen with the review
  title, body    text
  status         text   published | hidden
  created_at, updated_at
  UNIQUE (product_id, user_id)
  INDEX (product_id, status, created_at DESC, id DESC)
  INDEX (status, created_at DESC, id DESC)          administrators' list
```

Writing a review updates `products.rating_avg` and `rating_count` in the same transaction, through the database function `app.refresh_product_rating`, which recalculates both from the published reviews (a buyer may change no product directly).

### 5.11 Imports

```
catalogue_imports
  id                 uuid PK
  seller_id          uuid FK sellers
  uploaded_by        uuid FK users
  file_storage_key   text
  original_filename  text
  file_type          text   csv | xlsx
  status             text   uploaded | mapping_suggested | mapping_confirmed | validating | importing | completed | failed
  headers            text[]
  column_mapping     jsonb   {"Product Name": "title", "Price (Rs)": "price", ...}, set only when the seller confirms
  suggested_mapping  jsonb, nullable   per column: the field, a confidence from 0 to 1, and whether the name or the AI chose it
  ai_request_id      uuid FK ai_requests, nullable
  total_rows, ok_rows, error_rows   int
  error_report_key   text, nullable   CSV of failed rows with reasons
  error              text, nullable
  created_at, completed_at
  INDEX (seller_id, created_at DESC, id DESC)

catalogue_import_rows
  id             bigserial PK
  import_id      uuid FK catalogue_imports
  row_number     int
  raw            jsonb   the row as uploaded
  normalized     jsonb   the row after mapping and cleaning
  status         text    pending | ok | error
  error_message  text
  product_id     uuid FK products, nullable
  created_at
  UNIQUE (import_id, row_number)
  INDEX (import_id, status)
```

Rows are stored individually so the worker can process a large file in batches, resume after a crash, and produce a row-level error report.

### 5.12 AI and search

```
ai_requests
  id             uuid PK
  feature        text   listing_draft | import_mapping | import_fill | nl_search | image_search | similar | assistant | screening | embedding
  user_id        uuid FK users, nullable
  seller_id      uuid FK sellers, nullable
  provider       text   e.g. deepseek | openrouter | local
  model          text
  input_hash     text   hash of the normalised input, used as a cache key
  input_tokens, output_tokens   int
  cost_micro_usd bigint, nullable   as the provider reports it; OpenRouter bills in US dollars
  status         text   queued | running | succeeded | failed
  result         jsonb, nullable
  error          text, nullable
  latency_ms     int
  created_at, completed_at
  INDEX (feature, input_hash)
  INDEX (seller_id, created_at)
  INDEX (created_at)

search_queries
  id            bigserial PK
  user_id       uuid, nullable
  session_id    text, nullable
  kind          text   keyword | natural | image
  query_text    text
  parsed        jsonb, nullable   filters the AI extracted
  result_count  int
  latency_ms    int
  created_at
  INDEX (created_at) WHERE result_count = 0     the catalogue gap report
```

One table serves all three AI operating controls from the quotation.
Counting rows per seller per day enforces the usage limits.
Looking up `(feature, input_hash)` returns a cached result for repeated inputs.
Summing tokens and cost gives the cost report, which administrators read at `GET /api/admin/ai/usage`.

How the limits count (backend spec step 17):

- A day runs from midnight to midnight India time.
- Every row is one call on the day it was created, including failed calls; a cache hit writes no row and counts against nothing.
- Each feature's rule is fixed in the AI module: listing drafts and import mapping count against the seller and the platform; screening, search, similar products, and the assistant count against the platform only; embeddings count against neither, because one approved import needs thousands of them at a tiny fraction of a chat call's price, and they are still logged with their cost.
- Counting and writing the row happen under one lock, so two calls racing for the last call of the day cannot both get it.
- The web app may only write rows that are still `queued` or `running`, so no request can change an answer that other requests are served from the cache.

### 5.13 Platform

```
platform_settings
  key         text PK
  value       jsonb
  updated_by  uuid FK users, nullable
  updated_at
  keys: commission_bps, delivery_charge_paise, free_delivery_threshold_paise,
        cod_enabled, return_window_days, payment_timeout_minutes, ai_daily_limit_platform,
        ai_daily_limit_seller, prohibited_terms, company_details

content_pages
  id            uuid PK
  slug          text UNIQUE   terms | privacy | shipping | returns | refunds | seller-agreement
  title         text
  body_markdown text
  status        text   draft | published
  updated_by    uuid FK users, nullable   empty for the development seed's placeholder text
  published_at, created_at, updated_at

email_outbox
  id                   bigserial PK
  user_id              uuid, nullable
  to_email             text
  template             text   otp | order_placed | payment_received | dispatched | cancelled | refund_recorded | seller_application
  subject              text
  payload              jsonb
  status               text   queued | sent | failed
  attempts             int
  provider_message_id  text
  last_error           text
  created_at, sent_at
  INDEX (status, created_at)

audit_logs
  id             bigserial PK
  actor_user_id  uuid, nullable
  actor_role     text
  action         text   e.g. product.approve, seller.suspend, settings.update, refund.record
  entity_type    text
  entity_id      text
  before, after  jsonb, nullable
  ip             inet
  created_at
  INDEX (entity_type, entity_id)
  INDEX (actor_user_id, created_at)

rate_limits
  key           text PK   e.g. otp:phone:+91..., checkout:user:<id>, ip:1.2.3.4:search
  window_start  timestamptz
  count         int
  INDEX (window_start)   a nightly job removes windows that started over a day ago; no rule may count over a longer window

cache_invalidations                     append only; no row-level security: only tags of public pages
  id            bigserial PK
  tag           text   e.g. product:<id>, category:<id>, home, catalogue
  created_at    the time of the statement that recorded it
  INDEX (created_at)    every web container reads the latest rows each second
```

Each setting has a rule its value must follow, checked whenever it is saved or read.
Settings that only the client can decide (commission, delivery charge, free-delivery threshold, company details) have no default, so anything that needs one stops with a clear "not configured yet" error until an administrator saves it.
The others have defaults: cash on delivery on, a 30-minute payment timeout, AI limits of 2000 a day for the platform and 100 per seller, and an empty prohibited-terms list.
Every change is written to `audit_logs`, and `pnpm db:seed` fills in obvious example values for local development only.

Emails go through an outbox table rather than being sent inline.
The row is written in the same transaction as the business change, so an email is never lost or sent for a change that was rolled back, and the worker retries failures.
Administrators see the emails that failed and the ones that are stuck (still queued but unchanged for 30 minutes), and the background jobs that failed in each queue, newest first.
They can retry one, which gives an email fresh attempts or a job one more attempt, and each retry is written to `audit_logs`.
A sign-in code is never sent again, because it has expired by then; the person asks for a new one.

## 6. Main flows

### 6.1 Login

Login is handled by Better Auth, mounted in the web app at `/api/auth/*`.

1. The user enters an email or mobile number and the browser calls Better Auth's email OTP or phone number plugin.
   Mobile numbers must be Indian (`+91` and ten digits starting with 6 to 9), and phone sign-in stays off until an SMS provider is configured.
2. Before a code is made, two limits are checked: five code requests a minute from one IP address (Better Auth, counted in `auth_rate_limits`), and five codes an hour for one email address or number from anywhere (our `rate_limits`, with the address hashed).
3. Better Auth generates a six-digit code with a five-minute expiry, stores it hashed in `verifications`, and calls our callback.
   The callback queues the email through `email_outbox`, or the SMS as a job, with the code encrypted; the worker decrypts it, sends the message, and then removes the code.
4. The user enters the code.
   Better Auth verifies it, allows three attempts, creates the user on first sign-in (with the `buyer` role by default; a phone-only account gets a placeholder email under the reserved `.invalid` domain), and writes a `sessions` row.
   It deletes the code once used, and every expired code whenever it checks one, so `verifications` needs no clean-up job.
5. The browser receives the `ecokart.session_token` cookie: HttpOnly, SameSite Lax, and Secure on https.
6. On every request the app reads the session through Better Auth, looks up the seller id for a seller account, and runs the request's queries through `withContext`, which sets the user id, role, and seller id with `SET LOCAL` for row-level security.

A signed-in buyer can add the way of signing in they do not have yet, each confirmed with a code: a phone number to an email account (Better Auth's phone verification with `updatePhoneNumber`), or an email to a phone account (its email-change endpoints, with the code sent to the new address).
Changing an email or number that is already there is not offered yet.
A buyer can never remove the phone number that is their only way to sign in, and accounts that only sell, and administrators, cannot use these endpoints.

The first administrator is created with `pnpm admin:create`.
Administrators manage accounts through Better Auth's admin endpoints: create accounts, set roles, ban and unban, and revoke sessions, each written to `audit_logs`.
They cannot impersonate users, delete them, or set passwords or emails.

### 6.2 Listing lifecycle

```
draft -> pending_review -> approved
                        -> rejected -> (seller edits) -> pending_review
approved -> archived                   the seller takes it off sale
approved -> rejected                   an administrator takes it down, with a reason
pending_review -> draft                the seller withdraws it to change it
approved -> draft                      the seller changes it; off sale until approved again
archived -> draft                      the seller brings it back to change and resubmit
```

Listing details change only in `draft` and `rejected`; price, MRP, stock, and a variant's active flag change in every state.

1. A seller creates a listing by hand, from photographs with the AI listing builder, or through a catalogue import. Every path produces a product in `draft`.
2. On submit the product moves to `pending_review`, a `product_moderation` row is created, and a screening job runs.
   A listing that could not be sold as it is (no ready photo, a main photo that could not be used, a photo or video still being processed, no active variant, no HSN code from the product or its category, or an inactive category or brand) is refused at once with a list of what to fix.
3. The screening job runs deterministic checks first (prohibited terms from platform settings as whole words, a price 70% or more below its MRP, an empty description; the database already refuses a price above the MRP), then asks the text model whether the title and description describe a prohibited category and the vision model whether any image is unusable (both DeepSeek V4.1 Flash through OpenRouter), and stores flags and a risk level on the moderation row.
4. An administrator sees the queue sorted by risk, highest first and then oldest first, approves (only once screening has finished) or rejects with a reason, and the decision is written to the moderation row, the product, and `audit_logs`.
5. On approval the product's GST rate is copied from its category (an administrator may choose another current rate), its HSN code is its own or the category's default, its first publication time is set, its search text and summary fields are rebuilt, embeddings are queued, and the product page cache tag is revalidated.
6. When a category's GST rate changes, its approved products that still have the old rate get the new one in the same transaction, with an audit entry; a rate an administrator chose at approval stays (decided 12 October 2026, for the client to confirm).
   A new default HSN code does not change approved products, because a product's code may be the seller's own choice.
7. A seller who withdraws a listing from review, or moves one on sale or archived back to draft, edits it and submits it again; a withdrawn review stays in the history.
   An administrator can take down a listing that is on sale: it becomes `rejected` with a reason the seller sees, written to `audit_logs`.

### 6.3 Checkout and payment

This is the flow that has to be correct under concurrency, so it is spelled out step by step.

1. The buyer submits checkout with an address and payment method. The server ignores any prices sent by the browser.
2. In one database transaction:
   - Read the cart items with their current variant prices and stock.
   - Validate the coupon: active, within dates, minimum order met, global and per-user limits not exceeded.
   - Compute subtotal, discount, delivery charge (flat charge, free above the threshold), per-line tax, and total.
   - For each line run `UPDATE product_variants SET stock = stock - $qty WHERE id = $id AND stock >= $qty`. If zero rows are updated the transaction is rolled back and the buyer is told which item ran out. This single statement is what prevents overselling; two buyers racing for the last unit cannot both succeed.
   - Increment `coupons.used_count` with the same conditional pattern.
   - Insert the order (`pending_payment` for Razorpay, `confirmed` for cash on delivery), the order items with all snapshots, an `order_events` row, and a `payments` row.
   - Delete the cart items.
3. After the transaction commits, call the Razorpay Orders API to create a gateway order for the total amount. The API call is deliberately outside the transaction so a slow gateway never holds database locks.
4. If the Razorpay call fails, a compensating transaction cancels the order, adds the stock back, decrements the coupon counter, and records the failure. The buyer sees an error and their cart is restored.
5. The browser opens Razorpay hosted checkout with the gateway order id.
6. Payment confirmation arrives two ways and both go through the same idempotent `confirmOrderPayment` function:
   - The webhook (`payment.captured` or `order.paid`): verify the signature with the webhook secret, insert into `payment_events` with `ON CONFLICT DO NOTHING`, and stop if it was a replay.
   - The browser return: verify the checkout signature and, as a safety net, fetch the payment status from the Razorpay API.
7. `confirmOrderPayment` runs in one transaction: mark the payment captured, mark the order confirmed, write ledger entries for each seller (sale and commission), queue one invoice per seller, queue the order-placed and payment-received emails, and revalidate product caches.
8. A scheduled job every five minutes cancels orders still `pending_payment` after the configured timeout and restores stock and coupon usage. If a capture webhook arrives for an order that was already cancelled, the payment is stored as captured and the order is flagged in the admin console for a manual refund.

Cash on delivery skips steps 3 to 6 and confirms immediately. Its payment row is marked captured when the seller marks the shipment delivered; for an order from several sellers, when the last parcel is delivered and the order completes.

### 6.4 Dispatch, delivery, and cancellation

- A seller sees their order lines grouped by order, picks the lines to dispatch, enters courier name and tracking number, and the service creates a `shipments` row, updates the lines to `dispatched`, writes an event, and queues the dispatched email.
- Buyers can cancel an order while none of its lines are dispatched. Cancellation restores stock, reverses ledger entries, and for paid orders creates a refund task for the administrator.
- Marking a shipment delivered sets the lines to `delivered`; when every line of an order is delivered or cancelled the order becomes `completed`.

### 6.5 Returns and refunds

1. A buyer opens a return request on a delivered line within the return window.
2. An administrator approves or rejects it.
3. On approval the administrator issues the refund in the Razorpay dashboard, then records it in EcoKart with the Razorpay refund id and amount.
4. Recording the refund, in one transaction, inserts the `refunds` row, marks the return `refunded`, sets the line to `returned`, restores stock, writes `refund_reversal` and `commission_reversal` ledger entries for the seller, and queues the refund-recorded email.

### 6.6 Invoices

Payment confirmation (and cash on delivery checkout, which confirms at once) issues the invoices inside its own transaction, handing over the order's frozen details, one for each seller in the order, taking the sellers in order of their id so two confirmations never deadlock.
Each invoice takes the next number from the seller's own sequence with one conditional update, whose row lock makes confirmations for the same seller take turns; a confirmation that rolls back gives its number back, so numbers never repeat or leave gaps.
The sequence starts again at 1 at the start of each financial year (1 April, counted in Asia/Kolkata).
The invoice freezes the seller's details, the buyer's delivery address, and the seller's order lines, and a job to make its PDF is queued in the same transaction.
Intra-state orders split GST into CGST and SGST; inter-state orders use IGST, decided by comparing the seller's state code with the shipping address state code.
Within a state, each line's tax is split with CGST rounded down to the paisa and SGST taking the rest, so the two always add up to the tax on the order line.
A worker job renders each invoice to PDF from the `invoices` row alone, using the format approved by the client's chartered accountant, and stores it privately.
The buyer, the issuing seller, and administrators download the PDF through a signed link that lasts five minutes, and administrators can have a PDF made again.
When an order is cancelled before dispatch, its invoices are marked cancelled, with the time and reason, and keep their numbers, as GST requires; each PDF is made again with a cancelled notice.
GST credit notes for returns are deferred, as quotation 4.0 says.

### 6.7 Catalogue import

1. The seller uploads a CSV or XLSX file straight to object storage and a `catalogue_imports` row is created.
2. A job reads the headers and the first few rows and suggests a field for each column, with a confidence.
   Names settle most columns without any AI, such as "Product Name" for the title or "Price (Rs)" for the price.
   Only the columns the names leave open go to the text model, in a second job, with a few sample values each; its answer is checked, and only columns and fields it was asked about are kept.
   The call counts against the seller's daily AI calls from the moment the file is read.
   With AI switched off, a daily limit used up, or an answer that cannot be used, the names' suggestion stands.
3. The seller reviews and confirms the mapping in the portal, choosing any column the suggestion left open.
   The seller may confirm before the AI has answered, and a suggestion is never applied without them.
   Each row becomes one draft with one variant, and a file has at most 5,000 rows and 10 MB.
4. A job validates every row deterministically (required fields, price and MRP numeric and sane, stock non-negative, category resolvable), optionally asks the text model to propose missing descriptions or categories for rows that lack them, and creates draft products and variants for valid rows.
5. Failed rows are written to an error report CSV with row numbers and reasons, and the seller submits the valid drafts for review.

### 6.8 Search and discovery

All four discovery features end in the same place: one SQL query over `products` with filters and a ranking expression.

- Keyword search: `search_vector @@ websearch_to_tsquery(...)`, ranked by `ts_rank`, with a trigram similarity fallback on `search_text` for typos.
  The fallback runs only when the words match nothing, and the answer says which kind of match it is.
  The match itself runs in two small database functions that return only products on sale, because the full-text and trigram operators cannot use their indexes under row-level security (backend spec, step 9).
  Category pages and search share one product list, with the same filters (brand, price, in stock), sorts (newest, price, and relevance for search), and keyset pages.
- Natural-language search: the text model turns the sentence into structured filters and a clean query string (category, brand, price range, attributes), the query string is embedded as a search query, and the results are ordered by cosine distance over the product text embeddings with the filters applied.
  Parsed queries are cached by hash for a day, and if the parser times out the sentence is run as a keyword search instead.
- Image search: the uploaded photo is resized, embedded with the same multimodal model, and matched against the product image embeddings; results are de-duplicated by product.
  No vision call is needed at query time, so a photo search costs one embedding call.
  Product images are embedded once, when the listing is approved.
- Similar products: nearest neighbours of the product's own text embedding within the same category, computed on demand and cached with the product page.

Every search writes a `search_queries` row, and zero-result queries surface in the admin console as the catalogue gap report.
A row is written for each new search, not for each further page, and keyword search rows carry no user or session, because the report needs only the words and the count.
Searches are limited per visitor address (120 a minute), counted in `rate_limits`.

### 6.9 Shopping assistant

The assistant is stateless on the server.
The browser sends the question and the last few turns; the server retrieves the most relevant approved, in-stock products by embedding similarity plus any products the buyer named, and calls the text model with a strict instruction to answer only from the supplied product data and to say so when it cannot.
The response is requested in JSON mode and validated as a structured object with the answer text, the product ids it cited, an optional two-product comparison, and a declined flag, so the storefront can render product cards and links instead of trusting free text.
Nothing about the buyer except the question itself is included in the prompt.
Every call is logged in `ai_requests` and counted against the daily platform limit.

## 7. Why it is fast

| Technique | Where it applies | Effect |
| --- | --- | --- |
| Full-page caching with tags | Home, category, product, and content pages | Rendered once, served from cache, and refreshed only when the underlying product or category changes. Each change records its tags in `cache_invalidations` in its own transaction, and every web container reads them within a second, so a change made through another container or by the worker refreshes the pages too, without Redis. Personal pages (cart, orders, seller, admin) are never cached. |
| CDN in front of static files and photos | Images, static assets | Most bytes never reach the application. Page HTML is not cached at the CDN, because it cannot see tag invalidations; Next.js serves cached pages from memory without touching the database. |
| Denormalised summary fields | `products.min_price_paise`, `total_stock`, `rating_avg`, `search_text` | Listing, search, and category pages read one table with one index. |
| Purpose-built indexes | Every list the UI shows has a matching composite index (see section 5) | No sequential scans on hot paths. |
| Keyset pagination | Product lists, order lists, ledgers, seller lists | Page 200 costs the same as page 1. The cursor keeps the time to the microsecond, so rows created in the same millisecond are never repeated or skipped. |
| Small category tree in memory | Category filters and breadcrumbs | Descendant category ids are computed in the app from the tree, loaded in one small query; no recursive queries. Cached pages keep the result, so the tree needs no cache of its own and is never behind an administrator's change. |
| Everything slow goes to the worker | AI calls, embeddings, image resizing, PDFs, emails, imports | Requests stay under a few hundred milliseconds regardless of external service latency. |
| Pre-sized images on the CDN | Thumbnail, card, and gallery sizes generated at upload | No on-the-fly resizing; immutable cache headers, because each photo has its own id in its address and its files never change. |
| Connection pooling | Every database connection | Each container keeps a small connection pool. The row-level security values are set with `SET LOCAL` inside each transaction, so they never leak to the next request on a pooled connection, and they keep working if a transaction-mode pooler such as PgBouncer is added later. |
| Atomic conditional updates | Stock, coupon usage, invoice sequences | Correct under concurrency without table locks or application-level mutexes. |

## 8. Security

- Row-level security is enabled on every table that holds buyer or seller data.
  The web app connects as the `ecokart_web` database user, which is subject to the policies, and sets `app.role`, `app.user_id`, `app.seller_id`, and `app.guest_token` with `SET LOCAL` in each transaction.
  Buyers can only see their own orders and addresses, sellers only their own products, order lines, ledger, and imports, guests only their own cart, and administrators see everything.
  Visitors see a product only while both the product and its seller are approved, so suspending a seller hides all their listings at once.
- The role `system` is used for work that changes several parties' data at once, such as checkout and payment confirmation, after the service has checked permissions itself.
- The worker connects as the `ecokart_worker` user, which has a full-access policy on every table with row-level security. Grants still limit it: it only reads the Better Auth tables, and only reads and adds rows in the append-only tables.
  An explicit policy, rather than the `BYPASSRLS` attribute, works the same on any PostgreSQL, including managed services such as Amazon RDS that cannot grant that attribute.
- Only the database owner, used by `pnpm db:migrate`, can change the table structure.
  Neither the web nor the worker user can update or delete the seller ledger, order events, or audit log, and a trigger refuses those changes even to the owner.
- The full list of row-level security rules is in `docs/backend-spec.md`, step 1.
- Application code still checks permissions explicitly; row-level security is the safety net that makes a missed check a bug rather than a data leak.
  In the same spirit, a database trigger refuses any change by the web app without full access that approves or rejects a product or sets its GST rate, so a seller can never approve their own listing.
- Authentication is Better Auth: opaque session tokens in an HttpOnly cookie, email and phone codes stored hashed, three attempts per code, and suspending an account through Better Auth's ban, which revokes every session of that user.
- Better Auth rate limits its own endpoints (OTP sending and verification), with the counters in the database so the limits hold across web containers.
  A second limit caps the codes sent to any one email address or phone number.
  Checkout, search, and every AI endpoint use the `rate_limits` table with an upsert per window.
  Per-address limits read the visitor's address from the end of `X-Forwarded-For` that our own proxies wrote, counting `TRUSTED_PROXY_COUNT` entries from the right (1 behind the load balancer, 2 with CloudFront in front), because the visitor can put anything at the start of it.
- Keyword search matches through two `SECURITY DEFINER` database functions, the same technique as the order policies' seller check, so that the search indexes work under row-level security.
  They return only the ids of products visitors may see anyway, and the storefront query applies its own checks and row-level security on top.
- Sign-in codes waiting to be sent are encrypted with `MESSAGE_ENCRYPTION_KEY` and removed once sent.
- Razorpay webhooks are verified with the webhook secret before anything is read from the payload, and the checkout return is verified with the key secret. No card data is ever received by EcoKart.
- All prices, totals, stock, and permissions are recomputed on the server; the browser is never trusted.
- Secrets live in environment variables in the hosting platform, never in the repository. Object storage buckets are private and every download of a private file (originals, imports, invoices, buyers' return photos) is a short-lived signed URL. Only the product photo sizes under `images/` and the converted product videos under `videos/` are public, served through CloudFront with origin access control.
- Uploads go straight from the browser to the bucket with a signed form that allows one key, one content type, and at most 10 MB for a photo or 50 MB for a video. The worker checks every photo and video and re-encodes it, which removes all metadata such as GPS locations, so nothing a browser sent is ever served as it arrived.
- Standard Next.js protections cover cross-site scripting and request forgery; parameterised queries through Drizzle cover injection.
- Every administrator action and every state change on an order is written to `audit_logs` or `order_events`.

## 9. How it grows

The launch deployment is two small web tasks, one worker task, one PostgreSQL server in Docker (two to four vCPUs), and one bucket.
That comfortably handles thousands of orders a day and a catalogue in the hundreds of thousands.

When measurements show pressure, the steps are, in order, and none of them changes the code structure.

1. Raise the desired count of the `web` service, or enable ECS auto scaling on CPU. The app is stateless, so this is a slider.
2. Give the database a larger server, then add a read replica and point storefront reads at it. Moving to a managed service such as Amazon RDS at this point needs no code change, only a new connection string.
3. Add ElastiCache Redis for page fragment caching and rate limiting if the database shows cache-miss pressure.
4. Raise the desired count of the `worker` service; pg-boss distributes jobs across tasks automatically.
5. Move search to a dedicated engine (Meilisearch or Typesense) only if the catalogue passes a few million products or search latency matters more than simplicity. The search module is the only code that changes.
6. Partition `orders`, `order_items`, and `order_events` by month when they reach tens of millions of rows.

## 10. Risks and how the design handles them

| Risk | Handling |
| --- | --- |
| Two buyers buy the last unit | Conditional stock decrement in one statement; the second transaction rolls back. |
| Razorpay replays a webhook or sends it twice | Unique `(provider, event_id)` in `payment_events`; replays are no-ops. |
| Webhook arrives after the order was auto-cancelled | Payment recorded as captured and flagged for manual refund in the admin console. |
| Gateway is slow or down at checkout | Gateway call happens after the database transaction commits; failure triggers a compensating rollback. |
| Filtered vector search returns too few rows | Over-fetch candidates and fall back to keyword search when the filtered vector result is short. |
| Row-level security breaks with connection pooling | Session variables are set with `SET LOCAL` inside a transaction, so they end with it, on our own pools today and with a transaction-mode pooler if one is added. |
| GST or invoice format disputes | Invoice data is frozen in `invoices.lines`; the PDF template is data driven so the format can change without touching order data. |
| SMS DLT approval is late | Email OTP works from day one; SMS OTP switches on with the `SMS_PROVIDER` environment variable once a provider is ready. |
| AI costs run away | Daily platform and per-seller limits counted from `ai_requests`; results cached by input hash; embeddings regenerated only when content changes. |
| The AI provider is slow or unavailable | Every AI call runs in the worker with retries, or behind a short timeout on the request-time paths (query parsing, photo embedding, and the assistant). Keyword search never depends on AI, and natural-language search falls back to keyword search. |
| OpenRouter is unreachable | The client speaks the OpenAI format, so pointing the base URL at DeepSeek direct with the standby key restores chat and vision in minutes. Embedding jobs wait in the queue and run when the gateway returns; search keeps working on the vectors already stored. |
| The model returns malformed JSON | DeepSeek offers JSON mode but not enforced schemas, so every reply is validated against a schema and retried once. A second failure fails the job visibly instead of storing bad data. |
| Catalogue text leaves the AWS account for the AI provider | Only catalogue content and the buyer's question are sent, never buyer identity or orders. The client should confirm the chosen provider's data terms are acceptable for its own product data. |
| Single developer and a fixed deadline | Modules with one responsibility each; automated tests on checkout, webhook idempotency, stock, and row-level security; everything else verified through the acceptance checklist. |

## 11. Decisions to confirm before build

| Decision | Status | Choice or recommendation | Alternative |
| --- | --- | --- | --- |
| Cloud | Decided 1 October 2026 | AWS, for hosting only | - |
| AI providers | Decided 2 October 2026 | OpenRouter as the gateway, `deepseek/deepseek-v4.1-flash` for chat and vision, `voyageai/voyage-multimodal-3.5` for embeddings | DeepSeek direct plus a separate embeddings source |
| Database hosting | Decided 5 October 2026 | PostgreSQL in Docker, the same image as local development, for now | Amazon RDS, with managed backups and Multi-AZ failover |
| Database backups | Open | Continuous WAL archiving plus a nightly base backup to the private S3 bucket (for example with pgBackRest), and a tested restore before launch. With Docker, backups are ours to run. | Move to Amazon RDS, which takes backups itself |
| AWS compute shape | Open | ECS Fargate for the web and worker, the database container on its own host with a persistent volume, S3 + CloudFront, defined with the CDK | App Runner for the web app with a Fargate worker, or a single EC2 host running Docker Compose for the pilot |
| ORM | Open | Drizzle (Better Auth ships a Drizzle adapter; the schema, migrations, and services of steps 1 to 6 are built on it, so changing now means rewriting them) | Prisma |
| Auth | Decided 2 October 2026 | Better Auth with the email OTP, phone number, and admin plugins, Drizzle adapter, UUID ids | Own OTP tables and sessions, or Auth.js |
| Guest cart | Open | Yes, cookie-based, merged into the account on login | Require login before adding to cart |
| Roles | Decided 20 October 2026 | One account can be both buyer and seller: a buyer applies to sell, and approval adds the seller role (section 5.3) | One role per account, with a separate seller account |
| Commission base | Open | Applied to the seller's line total after the coupon discount share | Applied before discounts |
| Delivery revenue | Open | Delivery charge belongs to the platform | Passed through to sellers |
| Page caching | Decided 12 October 2026 | Next.js caches public pages in each web container and expires them by tag, with changed tags shared through PostgreSQL; CloudFront caches only static files and photos | CloudFront caching page HTML, purged on every change |
| Invoice number format | Decided 12 October 2026; the chartered accountant confirms | `GRB/2627/000041`: a prefix of 1 to 4 characters, the financial year as four digits, and a six-digit sequence, within the 16 characters GST allows | `GREENB/26/000041`, keeping prefixes of up to 6 characters and writing only the year the financial year starts in |
| Invoices of cancelled orders | Decided 12 October 2026; the chartered accountant confirms | Mark the invoice cancelled, keep its number used, and make its PDF again with "Cancelled" on it; GST credit notes stay deferred, as quotation 4.0 says | Leave the invoice as it is, and the seller handles the cancellation in their own accounts |
| EcoKart's own invoices | Decided 12 October 2026: not part of the launch build; for the client's chartered accountant | An invoice from EcoKart for the delivery charge, if the delivery charge belongs to EcoKart, and for the commission it charges sellers, decided with the chartered accountant | Leave both to EcoKart's own accounting software |
| GST rates that depend on price | Open | Clothing and footwear are taxed at 5% up to ₹2,500 a piece and 18% above it. An optional price limit and higher rate on the category, applied to each order line from its own price at checkout. Until the chartered accountant agrees, approval copies the category's single rate (backend spec, step 7); it must be settled before checkout freezes rates on order lines (step 12). | A rate per product set by hand, or separate categories per price band |
| Delivery phone | Open | An Indian mobile number, because couriers call or text the person receiving the parcel (backend spec, step 10) | Any phone number in international format |

Open rows are recommendations and are built as written unless the client decides otherwise.
