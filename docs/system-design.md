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
| Database access | Drizzle ORM with SQL migrations | Thin layer over SQL, easy to combine with row-level security and raw queries for search. Prisma is the alternative if preferred. |
| Auth | Better Auth (open source, MIT) with its email OTP, phone number, and admin plugins, sessions stored in Postgres through its Drizzle adapter | Decided by the client. It covers OTP login by email and SMS, roles, suspension, and session handling out of the box, so we do not write auth ourselves. It runs inside our app and database, so there is no third-party auth service and row-level security works unchanged. |
| Background jobs | pg-boss (queue stored in Postgres) with a worker process | Reliable retries and scheduling with zero extra infrastructure. |
| Search | Postgres full-text (`tsvector`), trigram fuzzy match (`pg_trgm`), and pgvector (HNSW index) | One database answers keyword, semantic, and image search with filters in a single query. Sufficient well past one million products. |
| AI gateway | OpenRouter, one OpenAI-compatible endpoint and one key per environment for chat, vision, and embeddings | Decided by the client. Any model is a configuration change, and the same client can point straight at a provider if OpenRouter is ever unavailable. |
| AI chat and vision | `deepseek/deepseek-v4.1-flash` through OpenRouter: DeepSeek's current flash model, reads text and images, 1M context, JSON output | The client's chosen model family at a very low price per token. Reads photographs, so listing drafts from photos and image screening use the same model as every text task. Every JSON reply is validated against a schema and retried once. |
| AI embeddings | `voyageai/voyage-multimodal-3.5` through OpenRouter at 1024 dimensions | DeepSeek has no embeddings endpoint, and this model embeds text and images into one space. One index serves semantic search, image search, and similar products, and an uploaded photo is embedded directly without a vision call. |
| Media | Direct browser upload to S3 with presigned URLs; worker resizes into fixed sizes | Uploads never pass through the web app. Images are served from CloudFront with immutable cache headers. |
| Payments | Razorpay hosted checkout, Orders API, and signature-verified webhooks | Fixed by the quotation. No card data ever touches EcoKart. |
| Email and SMS | A transactional email API (Resend or Amazon SES, one adapter either way); an Indian SMS provider with DLT approval (MSG91 or similar) for OTP. Locally, both go to Mailpit, a mail catcher in Docker. | Email OTP works from day one; SMS OTP switches on when DLT approval arrives. |
| Hosting | AWS Mumbai, hosting only: ECS Fargate for the web and worker containers, PostgreSQL with pgvector in Docker, S3 + CloudFront, Secrets Manager | Client-owned account as the quotation requires. Infrastructure is defined as code, and staging and production are two environments of the same definition. |

### 3.1 AWS deployment shape

| AWS service | Role in EcoKart |
| --- | --- |
| ECR | Stores the one Docker image that both services run |
| ECS Fargate, service `web` | Next.js app behind an Application Load Balancer; two tasks in production, one in staging |
| ECS Fargate, service `worker` | The job runner; one task, no load balancer, scheduled jobs come from pg-boss cron inside it |
| PostgreSQL 16 in Docker | The `pgvector/pgvector` image from `compose.yaml` with its data on a persistent volume, in a private subnet, with the `vector` and `pg_trgm` extensions. Decided 5 October 2026 instead of Amazon RDS, for now. Where the container runs and how it is backed up are settled with the compute shape and the backup plan (section 11). |
| S3 | One private bucket per environment for images, import files, and invoice PDFs, with a CORS rule for uploads from the web app's address and a lifecycle rule that deletes unused uploads after a day. Locally, SeaweedFS from `compose.yaml` stands in for it. |
| CloudFront | One distribution in front of the ALB for public page caching and TLS, and one in front of the bucket with origin access control |
| Route 53 + ACM | DNS and certificates |
| Secrets Manager | Database password, Razorpay keys, AI provider keys, email and SMS keys, injected into task definitions |
| CloudWatch | Logs from both services and alarms on error rate, queue depth, and database CPU |
| GitHub Actions | Builds the image, pushes to ECR, runs migrations, deploys staging, and promotes to production on approval |

AWS is used for hosting only.
The AI, email, and SMS providers are ordinary HTTPS APIs called from the web and worker tasks, with their keys in Secrets Manager.
Infrastructure is defined with the AWS CDK in the same repository, so the staging and production environments cannot drift apart.
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
| Embeddings (text or image in, vector out) | `Embedder.embed(input)` returns a 1024-dimension vector | `voyageai/voyage-multimodal-3.5` with `dimensions: 1024` | Product text, product images, search queries, uploaded photos, similar products |

Configuration lives in environment variables, with the same names in staging and production.

```
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
- Chat requests ask for JSON with `response_format`.
  OpenRouter advertises structured outputs for this model, so the client sends the JSON schema when the model accepts it, but every reply is still validated in code because enforcement varies by provider.
- Image inputs are sent as `image_url` content parts pointing at the resized card-size image on CloudFront, never the original upload.
- Embedding requests send `input_type: search_document` for catalogue items and `search_query` for buyer queries, and images as `image_url` content parts in the same request format.
- The OpenRouter account's data policy is set to exclude providers that train on prompts, and routing prefers DeepSeek's own endpoint, so catalogue text goes to as few third parties as possible.
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
      api/me/route.ts          the signed-in account, its role, and its seller id
      api/admin/settings/      administrators read and change platform settings
      api/admin/sellers/       administrators create, approve, suspend, and reinstate sellers
      api/seller/profile/      a seller's own business details and support contacts
      api/seller/products/     a seller's listings, variants, stock, and photos
      api/categories/          the visible category tree, for anyone
      api/brands/              active brands A to Z, for anyone
      api/admin/categories/    administrators build and change the category tree
      api/admin/brands/        administrators keep the list of brands
      api/webhooks/razorpay/route.ts
    scripts/create-admin.ts    `pnpm admin:create`: the first administrator
  worker/                      background worker (@ecokart/worker)
    src/main.ts                process entry: reads settings, starts, stops gracefully
    src/worker.ts              starts pg-boss and registers every module's jobs
packages/
  core/                        business logic shared by web and worker (@ecokart/core)
    src/modules/
      auth/  catalogue/  cart/  checkout/  orders/  payments/  ledger/
      invoices/  returns/  search/  ai/  imports/  notifications/
      moderation/  settings/  audit/  sellers/  rate-limits/
        (each module: service.ts, queries.ts, jobs.ts, types.ts; the
         catalogue splits its services by topic: categories.ts, brands.ts,
         tree.ts for the in-memory category tree, products.ts, images.ts,
         summary.ts for the summary fields on products, and jobs.ts)
    src/db/
      pool.ts                  database connection pool
      client.ts                Drizzle database on top of the pool
      context.ts               withContext(): one transaction with the row-level security context
      migrate.ts               `pnpm db:migrate`: SQL migrations, database users, job queue tables
      seed.ts                  `pnpm db:seed`: example data for local development only
      schema/                  Drizzle schema, one file per domain
      migrations/              SQL migrations including RLS policies and indexes
    src/jobs.ts                every job queue and its retry settings, created by `pnpm db:migrate`
    src/worker.ts              worker-only exports (`@ecokart/core/worker`), such as the photo job,
                               so the web app never loads the image library
    src/errors.ts              the errors services throw; the web app turns each into one HTTP status
    src/testing/               test database setup and fixtures, used only by tests
    src/lib/
      razorpay.ts  email.ts  sms.ts  cache.ts
      storage.ts     one S3 client: signed upload forms, reading and writing objects, public photo addresses
      storage-setup.ts  sets up the local bucket (`pnpm db:up`) and the test buckets
      images.ts      photo formats, limits, and sizes
      image-processing.ts  checks photos and makes the sizes; loaded only by the worker
      queue.ts       sends pg-boss jobs inside the caller's transaction
      encryption.ts  seals short secrets, such as queued sign-in codes
      config.ts      validates environment variables at startup
      validation.ts  shared formats: GSTIN, PAN, PIN code, state code, phone, money
      mailpit.ts     local mail catcher, for development and tests only
      pagination.ts  keyset pagination with exact (microsecond) cursors
      slug.ts        readable names for web addresses, numbered when taken
      ai/
        client.ts      one OpenAI-compatible HTTP client; base URL, key, model from env
        chat.ts        TextModel and VisionModel on top of the chat client
        embed.ts       Embedder on top of the embeddings client
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
| Sellers | `sellers` |
| Catalogue | `categories`, `brands`, `products`, `product_variants`, `product_images`, `product_moderation`, `product_embeddings` |
| Cart and promotions | `carts`, `cart_items`, `coupons` |
| Orders | `orders`, `order_items`, `shipments`, `order_events`, `return_requests`, `invoices` |
| Payments | `payments`, `payment_events`, `refunds` |
| Seller money | `seller_ledger_entries` |
| Reviews | `reviews` |
| Imports | `catalogue_imports`, `catalogue_import_rows` |
| AI and search | `ai_requests`, `search_queries` |
| Platform | `platform_settings`, `content_pages`, `email_outbox`, `audit_logs`, `rate_limits` |

That is 37 tables, five of them owned by Better Auth, plus the schema that pg-boss creates for itself.
Better Auth keeps its rate-limit counters in `auth_rate_limits`; our own `rate_limits` table, with a different shape, serves checkout, search, and AI.

### 5.3 Identity

The first four tables are created and maintained by Better Auth.
Its CLI generates their Drizzle schema, and application code never reads or writes them directly; it goes through the Better Auth API.
They use UUID ids (`advanced.database.generateId: "uuid"`) and plural snake_case names (`usePlural`) so they look like the rest of the database.
They carry no row-level security policies, because Better Auth is the only code that touches them.
Better Auth also creates `auth_rate_limits` for its rate-limit counters.
Their time columns are `timestamp` without a time zone holding UTC, because that is what the Better Auth CLI generates; every other table uses `timestamptz`.
A CHECK constraint on `users.role` allows only `buyer`, `seller`, and `admin`.

```
users                                   core + phone number plugin + admin plugin
  id                      uuid PK
  name                    text
  email                   text UNIQUE   phone-only accounts get a placeholder generated by the plugin
  email_verified          boolean
  image                   text, nullable
  phone_number            text UNIQUE, nullable, E.164 format
  phone_number_verified   boolean
  role                    text   buyer | seller | admin
  banned                  boolean       our "suspended"
  ban_reason              text
  ban_expires             timestamptz
  created_at, updated_at

sessions                                core + admin plugin
  id               uuid PK
  user_id          uuid FK users
  token            text UNIQUE   the cookie value, opaque
  expires_at       timestamptz
  ip_address       text
  user_agent       text
  impersonated_by  text, nullable   set when an admin impersonates a user
  created_at, updated_at
  INDEX (user_id)

accounts                                core; links a user to a sign-in method
  id            uuid PK
  user_id       uuid FK users
  provider_id   text    e.g. email-otp, phone-number
  account_id    text
  password      text, nullable   unused at launch
  created_at, updated_at
  INDEX (user_id)

verifications                           core; holds OTP codes while they are valid
  id            uuid PK
  identifier    text    the email or phone the code was sent to
  value         text    the code, stored hashed (storeOTP: hashed)
  expires_at    timestamptz
  created_at, updated_at
  INDEX (identifier)

addresses
  id            uuid PK
  user_id       uuid FK users
  full_name, phone, line1, line2, landmark, city
  state_code    char(2)   two-digit GST state code (e.g. 27 for Maharashtra), used for GST place of supply
  pincode       char(6)
  is_default    boolean
  created_at, updated_at, deleted_at
  INDEX (user_id)
```

One account has one role.
A seller account is created by an administrator through the seller onboarding, which creates the owner's account with the `seller` role through Better Auth (its internal `createUser`) and the linked `sellers` row together.
If the business cannot be saved, the new account is removed again, and Better Auth's own administrator endpoints refuse to hand out the `seller` role, so a seller account always has a business.
Suspending a buyer or seller is Better Auth's `banUser`, which also revokes every session; the reason is kept in `ban_reason`.
If a person needs to be both a buyer and a seller they use two accounts at launch; the admin plugin can hold several roles on one account, so this can be relaxed later without a schema change.

### 5.4 Sellers

```
sellers
  id                uuid PK
  owner_user_id     uuid FK users, UNIQUE
  slug              text UNIQUE
  display_name      text
  legal_name        text
  gstin, pan        text
  line1, city, state_code, pincode
  support_email, support_phone
  commission_bps    int, nullable   overrides the platform default when set
  invoice_prefix    text            used in GST invoice numbers
  invoice_seq       int default 0
  invoice_seq_fy    text            financial year the sequence belongs to, e.g. 2026-27
  status            text   pending | approved | suspended
  approved_at, suspended_reason
  created_at, updated_at
```

### 5.5 Catalogue

```
categories
  id                uuid PK
  parent_id         uuid FK categories, nullable
  name, slug        slug UNIQUE; name UNIQUE among siblings, ignoring capital letters
  depth             int    0 to 2: three levels at most
  gst_rate_bps      int    the client's chartered accountant approves this per category; one of the current GST rates
  default_hsn_code  text   4, 6, or 8 digits
  sort_order        int
  is_active         boolean  an inactive category hides everything below it
  created_at, updated_at

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
  status              text    draft | pending_review | approved | rejected | archived
  rejection_reason    text
  published_at        timestamptz
  -- denormalised read fields, maintained by the catalogue service on every write
  min_price_paise     bigint
  max_price_paise     bigint
  min_mrp_paise       bigint
  total_stock         int
  in_stock            boolean GENERATED AS (total_stock > 0)
  rating_avg          numeric(3,2)
  rating_count        int
  primary_image_id    uuid
  -- search
  search_text         text      title + brand + category + highlights, rebuilt on write
  search_vector       tsvector  GENERATED from search_text
  ai_draft_request_id uuid FK ai_requests, nullable
  created_at, updated_at, deleted_at
  INDEX (seller_id, created_at DESC, id DESC)            the seller's list
  INDEX (seller_id, status, created_at DESC, id DESC)
  INDEX (category_id, status)
  INDEX (status, created_at DESC)
  INDEX (status, min_price_paise)
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
  storage_key   text    images/{id}; the public sizes are images/{id}/{thumb|card|gallery}.webp
  status        text    processing | ready | failed
  upload_key    text    UNIQUE, the browser's upload, so it becomes one photo
  failure_reason text   shown to the seller when the photo cannot be used
  content_hash  text
  width, height int
  alt           text
  sort_order    int
  created_at, updated_at
  INDEX (product_id, sort_order)

product_moderation
  id             uuid PK
  product_id     uuid FK products
  submitted_at   timestamptz
  ai_flags       jsonb   array of {code, detail}, e.g. price_above_mrp, prohibited_term
  ai_risk        text    low | medium | high
  ai_request_id  uuid FK ai_requests, nullable
  decision       text    approved | rejected, nullable while open
  decided_by     uuid FK users, nullable
  decided_at     timestamptz
  reason         text    shown to the seller on rejection
  created_at
  INDEX (product_id, created_at DESC)
  INDEX (created_at) WHERE decision IS NULL     the admin queue

product_embeddings
  id            uuid PK
  product_id    uuid FK products
  kind          text   text | image
  image_id      uuid FK product_images, nullable, set when kind = image
  model         text
  content_hash  text   hash of the text or image that was embedded
  embedding     vector(1024)   Voyage Multimodal 3.5 at 1024 dimensions; changing the model means a re-embed job
  created_at
  UNIQUE (product_id, kind, image_id)
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
  created_at, updated_at
  CHECK (user_id IS NOT NULL OR guest_token IS NOT NULL)

cart_items
  id          uuid PK
  cart_id     uuid FK carts
  variant_id  uuid FK product_variants
  quantity    int  CHECK (quantity BETWEEN 1 AND 10)
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
```

Cart items store no price.
Every time the cart is shown or checked out, prices and stock are read fresh from `product_variants`, so the cart can never show a stale price.
Per-user coupon usage is counted from `orders` (same coupon, same user, not cancelled), so no extra table is needed.

### 5.7 Orders

```
orders
  id                uuid PK
  order_number      text UNIQUE   human readable, e.g. EK-261001-000123
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
  INDEX (user_id, created_at DESC)
  INDEX (status, created_at)

order_items
  id                    uuid PK
  order_id              uuid FK orders
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
  INDEX (seller_id, status, created_at DESC)

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
  order_item_id  uuid, nullable
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
  INDEX (status, created_at)
  INDEX (user_id)
  INDEX (seller_id)

invoices
  id                          uuid PK
  order_id                    uuid FK orders
  seller_id                   uuid FK sellers
  invoice_number              text UNIQUE   {seller prefix}/{FY}/{sequence}
  issued_at                   timestamptz
  seller_snapshot             jsonb   legal name, GSTIN, address
  buyer_snapshot              jsonb   name, address, state code
  place_of_supply_state_code  char(2)
  is_interstate               boolean
  taxable_paise, cgst_paise, sgst_paise, igst_paise, total_paise   bigint
  lines                       jsonb   the invoice lines exactly as printed
  pdf_storage_key             text, nullable until the worker renders it
  created_at
  UNIQUE (order_id, seller_id)
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
  method               text, nullable   upi | card | netbanking | wallet | cod
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
  provider_refund_id  text, nullable   typed in by the admin from the Razorpay dashboard
  method              text   gateway | bank_transfer
  note                text
  recorded_by         uuid FK users
  recorded_at         timestamptz
  created_at
  INDEX (order_id)
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
  INDEX (seller_id, created_at)
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
  title, body    text
  status         text   published | hidden
  created_at, updated_at
  UNIQUE (product_id, user_id)
```

Writing a review updates `products.rating_avg` and `rating_count` in the same transaction.

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
  column_mapping     jsonb   {"Product Name": "title", "Price (Rs)": "price", ...}
  ai_request_id      uuid FK ai_requests, nullable
  total_rows, ok_rows, error_rows   int
  error_report_key   text, nullable   CSV of failed rows with reasons
  error              text, nullable
  created_at, completed_at

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
  cost_micro_inr bigint, nullable
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
Summing tokens gives the cost report.

### 5.13 Platform

```
platform_settings
  key         text PK
  value       jsonb
  updated_by  uuid FK users, nullable
  updated_at
  keys: commission_bps, delivery_charge_paise, free_delivery_threshold_paise,
        cod_enabled, payment_timeout_minutes, ai_daily_limit_platform,
        ai_daily_limit_seller, prohibited_terms, company_details

content_pages
  id            uuid PK
  slug          text UNIQUE   terms | privacy | shipping | returns | refunds | seller-agreement
  title         text
  body_markdown text
  status        text   draft | published
  updated_by    uuid FK users
  published_at, created_at, updated_at

email_outbox
  id                   bigserial PK
  user_id              uuid, nullable
  to_email             text
  template             text   otp | order_placed | payment_received | dispatched | cancelled | refund_recorded
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
```

Each setting has a rule its value must follow, checked whenever it is saved or read.
Settings that only the client can decide (commission, delivery charge, free-delivery threshold, company details) have no default, so anything that needs one stops with a clear "not configured yet" error until an administrator saves it.
The others have defaults: cash on delivery on, a 30-minute payment timeout, AI limits of 2000 a day for the platform and 100 per seller, and an empty prohibited-terms list.
Every change is written to `audit_logs`, and `pnpm db:seed` fills in obvious example values for local development only.

Emails go through an outbox table rather than being sent inline.
The row is written in the same transaction as the business change, so an email is never lost or sent for a change that was rolled back, and the worker retries failures.

## 6. Main flows

### 6.1 Login

Login is handled by Better Auth, mounted in the web app at `/api/auth/*`.

1. The user enters an email or mobile number and the browser calls Better Auth's email OTP or phone number plugin.
   Mobile numbers must be Indian (`+91` and ten digits starting with 6 to 9), and phone sign-in stays off until an SMS provider is configured.
2. Before a code is made, two limits are checked: five code requests a minute from one IP address (Better Auth, counted in `auth_rate_limits`), and five codes an hour for one email address or number from anywhere (our `rate_limits`, with the address hashed).
3. Better Auth generates a six-digit code with a five-minute expiry, stores it in `verifications` (hashed for email), and calls our callback.
   The callback queues the email through `email_outbox`, or the SMS as a job, with the code encrypted; the worker decrypts it, sends the message, and then removes the code.
4. The user enters the code.
   Better Auth verifies it, allows three attempts, creates the user on first sign-in (with the `buyer` role by default; a phone-only account gets a placeholder email under the reserved `.invalid` domain), and writes a `sessions` row.
5. The browser receives the `ecokart.session_token` cookie: HttpOnly, SameSite Lax, and Secure on https.
6. On every request the app reads the session through Better Auth, looks up the seller id for a seller account, and runs the request's queries through `withContext`, which sets the user id, role, and seller id with `SET LOCAL` for row-level security.

The first administrator is created with `pnpm admin:create`.
Administrators manage accounts through Better Auth's admin endpoints: create accounts, set roles, ban and unban, and revoke sessions, each written to `audit_logs`.
They cannot impersonate users, delete them, or set passwords or emails.

### 6.2 Listing lifecycle

```
draft -> pending_review -> approved
                        -> rejected -> (seller edits) -> pending_review
approved -> archived
```

1. A seller creates a listing by hand, from photographs with the AI listing builder, or through a catalogue import. Every path produces a product in `draft`.
2. On submit the product moves to `pending_review`, a `product_moderation` row is created, and a screening job runs.
3. The screening job runs deterministic checks first (price above MRP, missing images or description, prohibited terms from platform settings), then asks the text model whether the title and description describe a prohibited category and the vision model whether any image is unusable (both DeepSeek V4.1 Flash through OpenRouter), and stores flags and a risk level on the moderation row.
4. An administrator sees the queue sorted by risk, approves or rejects with a reason, and the decision is written to the moderation row, the product, and `audit_logs`.
5. On approval the product's GST rate is copied from its category, its search text and summary fields are rebuilt, embeddings are queued, and the product page cache tag is revalidated.

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

Cash on delivery skips steps 3 to 6 and confirms immediately. Its payment row is marked captured when the seller marks the shipment delivered.

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

A worker job renders each invoice to PDF from the `invoices` row using the format approved by the client's chartered accountant.
Intra-state orders split GST into CGST and SGST; inter-state orders use IGST, decided by comparing the seller's state code with the shipping address state code.
Invoice numbers come from the seller's own sequence, incremented with a row lock inside the confirmation transaction, and reset at the start of each financial year.
Buyers and sellers download the PDF through a short-lived signed URL.

### 6.7 Catalogue import

1. The seller uploads a CSV or XLSX file straight to object storage and a `catalogue_imports` row is created.
2. A job reads the headers and the first few rows, asks the text model for a suggested mapping from the seller's column names to EcoKart fields, and stores it with a confidence per column.
3. The seller reviews and confirms the mapping in the portal.
4. A job validates every row deterministically (required fields, price and MRP numeric and sane, stock non-negative, category resolvable), optionally asks the text model to propose missing descriptions or categories for rows that lack them, and creates draft products and variants for valid rows.
5. Failed rows are written to an error report CSV with row numbers and reasons, and the seller submits the valid drafts for review.

### 6.8 Search and discovery

All four discovery features end in the same place: one SQL query over `products` with filters and a ranking expression.

- Keyword search: `search_vector @@ websearch_to_tsquery(...)`, ranked by `ts_rank`, with a trigram similarity fallback on `search_text` for typos.
- Natural-language search: the text model turns the sentence into structured filters and a clean query string (category, brand, price range, attributes), the query string is embedded as a search query, and the results are ordered by cosine distance over the product text embeddings with the filters applied.
  Parsed queries are cached by hash for a day, and if the parser times out the sentence is run as a keyword search instead.
- Image search: the uploaded photo is resized, embedded with the same multimodal model, and matched against the product image embeddings; results are de-duplicated by product.
  No vision call is needed at query time, so a photo search costs one embedding call.
  Product images are embedded once, when the listing is approved.
- Similar products: nearest neighbours of the product's own text embedding within the same category, computed on demand and cached with the product page.

Every search writes a `search_queries` row, and zero-result queries surface in the admin console as the catalogue gap report.

### 6.9 Shopping assistant

The assistant is stateless on the server.
The browser sends the question and the last few turns; the server retrieves the most relevant approved, in-stock products by embedding similarity plus any products the buyer named, and calls the text model with a strict instruction to answer only from the supplied product data and to say so when it cannot.
The response is requested in JSON mode and validated as a structured object with the answer text, the product ids it cited, an optional two-product comparison, and a declined flag, so the storefront can render product cards and links instead of trusting free text.
Nothing about the buyer except the question itself is included in the prompt.
Every call is logged in `ai_requests` and counted against the daily platform limit.

## 7. Why it is fast

| Technique | Where it applies | Effect |
| --- | --- | --- |
| Full-page caching with tags | Home, category, product, and content pages | Rendered once, served from cache, and refreshed only when the underlying product or category changes. Personal pages (cart, orders, seller, admin) are never cached. |
| CDN in front of everything public | Cached pages, images, static assets | Most storefront traffic never reaches the application. |
| Denormalised summary fields | `products.min_price_paise`, `total_stock`, `rating_avg`, `search_text` | Listing, search, and category pages read one table with one index. |
| Purpose-built indexes | Every list the UI shows has a matching composite index (see section 5) | No sequential scans on hot paths. |
| Keyset pagination | Product lists, order lists, ledgers, seller lists | Page 200 costs the same as page 1. The cursor keeps the time to the microsecond, so rows created in the same millisecond are never repeated or skipped. |
| Small category tree in memory | Category filters and breadcrumbs | Descendant category ids are computed in the app from a 60-second cached tree; no recursive queries. |
| Everything slow goes to the worker | AI calls, embeddings, image resizing, PDFs, emails, imports | Requests stay under a few hundred milliseconds regardless of external service latency. |
| Pre-sized images on the CDN | Thumbnail, card, and gallery sizes generated at upload | No on-the-fly resizing; immutable cache headers keyed by content hash. |
| Connection pooling | Every database connection | Transaction-mode pooling from day one, which also works with the row-level security session variables because they are set with `SET LOCAL` inside the transaction. |
| Atomic conditional updates | Stock, coupon usage, invoice sequences | Correct under concurrency without table locks or application-level mutexes. |

## 8. Security

- Row-level security is enabled on every table that holds buyer or seller data.
  The web app connects as the `ecokart_web` database user, which is subject to the policies, and sets `app.role`, `app.user_id`, `app.seller_id`, and `app.guest_token` with `SET LOCAL` in each transaction.
  Buyers can only see their own orders and addresses, sellers only their own products, order lines, ledger, and imports, guests only their own cart, and administrators see everything.
  Visitors see a product only while both the product and its seller are approved, so suspending a seller hides all their listings at once.
- The role `system` is used for work that changes several parties' data at once, such as checkout and payment confirmation, after the service has checked permissions itself.
- The worker connects as the `ecokart_worker` user, which has a full-access policy on every table.
  An explicit policy, rather than the `BYPASSRLS` attribute, works the same on any PostgreSQL, including managed services such as Amazon RDS that cannot grant that attribute.
- Only the database owner, used by `pnpm db:migrate`, can change the table structure.
  Neither the web nor the worker user can update or delete the seller ledger, order events, or audit log, and a trigger refuses those changes even to the owner.
- The full list of row-level security rules is in `docs/backend-spec.md`, step 1.
- Application code still checks permissions explicitly; row-level security is the safety net that makes a missed check a bug rather than a data leak.
- Authentication is Better Auth: opaque session tokens in an HttpOnly cookie, OTP codes stored hashed, three attempts per code, and suspension through `banUser`, which revokes every session of that user.
- Better Auth rate limits its own endpoints (OTP sending and verification), with the counters in the database so the limits hold across web containers.
  A second limit caps the codes sent to any one email address or phone number.
  Checkout, search, and every AI endpoint use the `rate_limits` table with an upsert per window.
- Sign-in codes waiting to be sent are encrypted with `MESSAGE_ENCRYPTION_KEY` and removed once sent.
- Razorpay webhooks are verified with the webhook secret before anything is read from the payload, and the checkout return is verified with the key secret. No card data is ever received by EcoKart.
- All prices, totals, stock, and permissions are recomputed on the server; the browser is never trusted.
- Secrets live in environment variables in the hosting platform, never in the repository. Object storage buckets are private and every download of a private file (originals, imports, invoices, buyers' return photos) is a short-lived signed URL. Only the product photo sizes under `images/` are public, served through CloudFront with origin access control.
- Uploads go straight from the browser to the bucket with a signed form that allows one key, one content type, and at most 10 MB. The worker checks every photo and re-encodes it, which removes all metadata such as GPS locations, so nothing a browser sent is ever served as it arrived.
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
| Row-level security breaks with connection pooling | Session variables are set with `SET LOCAL` inside a transaction; the pooler runs in transaction mode. |
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
| ORM | Open | Drizzle (Better Auth ships a Drizzle adapter, and the repo is scaffolded for it) | Prisma |
| Auth | Decided 2 October 2026 | Better Auth with the email OTP, phone number, and admin plugins, Drizzle adapter, UUID ids | Own OTP tables and sessions, or Auth.js |
| Guest cart | Open | Yes, cookie-based, merged into the account on login | Require login before adding to cart |
| Roles | Open | One role per account; a seller uses a separate seller account | One account can be both buyer and seller |
| Commission base | Open | Applied to the seller's line total after the coupon discount share | Applied before discounts |
| Delivery revenue | Open | Delivery charge belongs to the platform | Passed through to sellers |
| GST rates that depend on price | Open | Clothing and footwear are taxed at 5% up to ₹2,500 a piece and 18% above it. An optional price limit and higher rate on the category, applied to each order line from its own price at checkout. Needs the chartered accountant's agreement before approval copies rates onto products (backend spec, step 7). | A rate per product set by hand, or separate categories per price band |

Open rows are recommendations and are built as written unless the client decides otherwise.
