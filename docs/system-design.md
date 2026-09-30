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
| Worker process | Background jobs: AI drafts, embeddings, imports, invoice PDFs, emails, order expiry | One container built from the same codebase |
| PostgreSQL | All data, full-text search, vector search (pgvector), and the job queue (pg-boss) | Managed Postgres with pgvector enabled |
| Object storage + CDN | Product images, import files, invoice PDFs, static assets | Private S3 bucket behind CloudFront |
| External services | Razorpay, DeepSeek API (text), Amazon Bedrock (vision and embeddings), Amazon SES, SMS provider | Client-owned AWS and DeepSeek accounts |

The whole system runs in the client's AWS account in the Mumbai region (`ap-south-1`).

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
| Auth | Own OTP login with database-backed sessions in an HttpOnly cookie | Launch scope is OTP only (email and mobile). Two small tables cover it with no vendor lock-in and a clean fit with row-level security. |
| Background jobs | pg-boss (queue stored in Postgres) with a worker process | Reliable retries and scheduling with zero extra infrastructure. If the web app is hosted on Vercel instead of containers, use Inngest for the same role. |
| Search | Postgres full-text (`tsvector`), trigram fuzzy match (`pg_trgm`), and pgvector (HNSW index) | One database answers keyword, semantic, and image search with filters in a single query. Sufficient well past one million products. |
| AI text tasks | DeepSeek API, `deepseek-chat`, through its OpenAI-compatible endpoint, JSON mode, every result validated against a schema before use | The client's chosen provider and very cheap per token. Covers every text task: listing text, import column mapping, missing-content suggestions, natural-language query parsing, text screening, and the shopping assistant. It cannot read images and has no embeddings endpoint, so those two jobs go to Bedrock. |
| AI vision and embeddings | Amazon Bedrock: Titan Multimodal Embeddings (1024 dimensions) for text and image vectors, Amazon Nova Lite for reading photographs | Same AWS account and bill, IAM authentication, no extra vendor. Titan embeds text and images into one space, so a single index serves semantic search, image search, and similar products. Nova Lite reads seller photographs for the listing builder and flags unusable images during screening. |
| Media | Direct browser upload to S3 with presigned URLs; worker resizes into fixed sizes | Uploads never pass through the web app. Images are served from CloudFront with immutable cache headers. |
| Payments | Razorpay hosted checkout, Orders API, and signature-verified webhooks | Fixed by the quotation. No card data ever touches EcoKart. |
| Email and SMS | Amazon SES for email; an Indian SMS provider with DLT approval (MSG91 or similar) for OTP | SES is in the same account. Email OTP works from day one; SMS OTP switches on when DLT approval arrives. |
| Hosting | AWS Mumbai: ECS Fargate for the web and worker containers, RDS PostgreSQL with pgvector, S3 + CloudFront, Secrets Manager | Client-owned account as the quotation requires. Infrastructure is defined as code, and staging and production are two environments of the same definition. |

### 3.1 AWS deployment shape

| AWS service | Role in EcoKart |
| --- | --- |
| ECR | Stores the one Docker image that both services run |
| ECS Fargate, service `web` | Next.js app behind an Application Load Balancer; two tasks in production, one in staging |
| ECS Fargate, service `worker` | The job runner; one task, no load balancer, scheduled jobs come from pg-boss cron inside it |
| RDS for PostgreSQL 16 | Single instance in staging, Multi-AZ in production, private subnet, automated backups, `vector`, `pg_trgm`, and `citext` extensions enabled |
| S3 | One private bucket per environment for images, import files, and invoice PDFs |
| CloudFront | One distribution in front of the ALB for public page caching and TLS, and one in front of the bucket with origin access control |
| Route 53 + ACM | DNS and certificates |
| SES | Transactional email, domain verified, moved out of the sandbox before launch |
| Bedrock | Titan Multimodal Embeddings and Nova Lite, called from the worker and from the search endpoint |
| Secrets Manager | Database password, Razorpay keys, DeepSeek key, SMS key, injected into task definitions |
| CloudWatch | Logs from both services and alarms on error rate, queue depth, and database CPU |
| GitHub Actions | Builds the image, pushes to ECR, runs migrations, deploys staging, and promotes to production on approval |

Infrastructure is defined with the AWS CDK in the same repository, so the staging and production environments cannot drift apart.
Each container keeps its own small application-side connection pool; RDS Proxy is added only if the number of tasks grows large.
If a Bedrock model is not yet available in Mumbai, the worker calls it in another region; embeddings and image reading are asynchronous or one-off per request, so the extra latency does not affect page speed.

### 3.2 AI provider layer

The application never calls a vendor directly.
The `ai` module exposes three small interfaces, and each has one adapter behind it.

| Interface | What it does | Adapter at launch | Used by |
| --- | --- | --- | --- |
| `TextModel.json(prompt, schema)` | Sends a prompt, asks for JSON, validates the reply against a schema, retries once on invalid output | DeepSeek `deepseek-chat` | Listing text, import mapping, missing-content suggestions, query parsing, text screening, assistant |
| `VisionModel.describe(images, prompt, schema)` | Reads photographs and returns validated JSON | Bedrock Amazon Nova Lite | Listing builder from photos, unusable-image screening |
| `Embedder.embed(text or image)` | Returns a 1024-dimension vector | Bedrock Titan Multimodal Embeddings | Product text and image embeddings, semantic search, image search, similar products |

Swapping a provider is one adapter file and one environment variable.

What DeepSeek alone can and cannot do matters for the quoted feature list.

| Quoted feature | DeepSeek only | DeepSeek + Bedrock |
| --- | --- | --- |
| Listing draft from photographs | Not possible; the draft can only use the seller's notes and category | Full |
| Listing draft from notes | Full | Full |
| Import column mapping and missing-content suggestions | Full | Full |
| Text screening for prohibited terms | Full | Full |
| Unusable-image screening | Not possible | Full |
| Natural-language search | Query parsing works, but ranking falls back to keyword search without embeddings | Full |
| Image search and similar products | Not possible without an embedding model | Full |
| Shopping assistant | Full, with keyword retrieval instead of semantic retrieval | Full |

If the client insists on DeepSeek as the only paid AI vendor, the gap can be closed by running an open-weight image and text embedding model (SigLIP or CLIP through ONNX Runtime) inside the worker container.
That restores semantic search, image search, and similar products with no external vendor, at the cost of a larger worker image and a few hundred milliseconds of CPU per embedding.
Reading photographs would still require a vision model, so the listing builder would work from notes only.

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
      api/webhooks/razorpay/route.ts
  worker/                      background worker (@ecokart/worker)
    src/main.ts                process entry: reads settings, starts, stops gracefully
    src/worker.ts              starts pg-boss and registers every module's jobs
packages/
  core/                        business logic shared by web and worker (@ecokart/core)
    src/modules/
      auth/  catalogue/  cart/  checkout/  orders/  payments/  ledger/
      invoices/  returns/  search/  ai/  imports/  notifications/
      moderation/  settings/  audit/
        (each module: service.ts, queries.ts, jobs.ts, types.ts)
    src/db/
      pool.ts                  database connection pool
      schema/                  Drizzle schema, one file per domain
      migrations/              SQL migrations including RLS policies and indexes
    src/lib/
      razorpay.ts  storage.ts  email.ts  sms.ts  cache.ts
      ai/
        text.ts        DeepSeek adapter behind the TextModel interface
        vision.ts      Bedrock Nova adapter behind the VisionModel interface
        embed.ts       Bedrock Titan adapter behind the Embedder interface
compose.yaml                   local PostgreSQL 16 with pgvector for development
```

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
- Every table has `created_at`; mutable tables also have `updated_at`. Soft delete (`deleted_at`) is used only where history matters (products, addresses).
- Status columns are `text` with a `CHECK` constraint listing the allowed values, so adding a state is a migration and not a type change.
- Products carry denormalised summary fields (minimum price, total stock, rating average) so listing and search pages never join variants or reviews.

### 5.2 Table list

| Domain | Tables |
| --- | --- |
| Identity | `users`, `otp_codes`, `sessions`, `addresses` |
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

That is 35 tables plus the schema that pg-boss creates for itself.

### 5.3 Identity

```
users
  id                 uuid PK
  role               text   buyer | seller | admin
  email              citext UNIQUE, nullable
  phone              text   UNIQUE, nullable, E.164 format
  name               text
  status             text   active | suspended
  email_verified_at  timestamptz
  phone_verified_at  timestamptz
  created_at, updated_at
  CHECK (email IS NOT NULL OR phone IS NOT NULL)

otp_codes
  id            bigserial PK
  identifier    text   the email or phone the code was sent to
  channel       text   email | sms
  code_hash     text   hashed, never the plain code
  purpose       text   login
  expires_at    timestamptz
  attempts      int    default 0, locked after 5
  consumed_at   timestamptz
  created_at
  INDEX (identifier, created_at DESC)

sessions
  id            text PK   SHA-256 of the cookie token
  user_id       uuid FK users
  expires_at    timestamptz
  created_at, last_seen_at
  ip            inet
  user_agent    text
  INDEX (user_id)

addresses
  id            uuid PK
  user_id       uuid FK users
  full_name, phone, line1, line2, landmark, city
  state_code    char(2)   Indian state code, used for GST place of supply
  pincode       char(6)
  is_default    boolean
  created_at, updated_at, deleted_at
  INDEX (user_id)
```

One account has one role.
A seller account is created by an administrator and linked to a `sellers` row.
If a person needs to be both a buyer and a seller they use two accounts at launch; this is the simplest rule and can be relaxed later by moving `role` into a join table.

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
  name, slug        slug UNIQUE
  depth             int
  gst_rate_bps      int    the client's chartered accountant approves this per category
  default_hsn_code  text
  sort_order        int
  is_active         boolean
  created_at, updated_at

brands
  id        uuid PK
  name      text
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
  hsn_code            text
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
  INDEX (seller_id, status)
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
  created_at, updated_at
  UNIQUE (product_id, sku)

product_images
  id            uuid PK
  product_id    uuid FK products
  variant_id    uuid FK product_variants, nullable
  storage_key   text    key in object storage; sizes derived from it
  content_hash  text
  width, height int
  alt           text
  sort_order    int
  created_at
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
  embedding     vector(1024)
  created_at
  UNIQUE (product_id, kind, image_id)
  HNSW INDEX (embedding vector_cosine_ops) WHERE kind = 'text'
  HNSW INDEX (embedding vector_cosine_ops) WHERE kind = 'image'
```

Every submission creates a new `product_moderation` row, so the history of approvals and rejections is kept.
Embeddings live in their own table because vectors are large and would slow down every scan of `products`.
The `content_hash` column means an embedding is only regenerated when the underlying text or image actually changed, which is what the quotation calls storing embeddings to avoid repeat cost.

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
  provider       text   deepseek | bedrock | local
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

Emails go through an outbox table rather than being sent inline.
The row is written in the same transaction as the business change, so an email is never lost or sent for a change that was rolled back, and the worker retries failures.

## 6. Main flows

### 6.1 Login

1. The user enters an email or mobile number.
2. The server checks `rate_limits`, generates a six-digit code, stores its hash in `otp_codes` with a ten-minute expiry, and queues the email or SMS.
3. The user enters the code; the server verifies the hash, marks it consumed, creates or finds the user, and inserts a `sessions` row.
4. The browser receives an HttpOnly, Secure, SameSite cookie containing the session token.
5. On every request the session is looked up by the hash of the token and the user, role, and seller id are set as Postgres session variables for row-level security.

### 6.2 Listing lifecycle

```
draft -> pending_review -> approved
                        -> rejected -> (seller edits) -> pending_review
approved -> archived
```

1. A seller creates a listing by hand, from photographs with the AI listing builder, or through a catalogue import. Every path produces a product in `draft`.
2. On submit the product moves to `pending_review`, a `product_moderation` row is created, and a screening job runs.
3. The screening job runs deterministic checks first (price above MRP, missing images or description, prohibited terms from platform settings), then asks the text model (DeepSeek) whether the title and description describe a prohibited category and the vision model (Bedrock Nova) whether any image is unusable, and stores flags and a risk level on the moderation row.
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
2. A job reads the headers and the first few rows, asks DeepSeek for a suggested mapping from the seller's column names to EcoKart fields, and stores it with a confidence per column.
3. The seller reviews and confirms the mapping in the portal.
4. A job validates every row deterministically (required fields, price and MRP numeric and sane, stock non-negative, category resolvable), optionally asks DeepSeek to propose missing descriptions or categories for rows that lack them, and creates draft products and variants for valid rows.
5. Failed rows are written to an error report CSV with row numbers and reasons, and the seller submits the valid drafts for review.

### 6.8 Search and discovery

All four discovery features end in the same place: one SQL query over `products` with filters and a ranking expression.

- Keyword search: `search_vector @@ websearch_to_tsquery(...)`, ranked by `ts_rank`, with a trigram similarity fallback on `search_text` for typos.
- Natural-language search: DeepSeek turns the sentence into structured filters and a clean query string (category, brand, price range, attributes), the query string is embedded with Titan, and the results are ordered by cosine distance over the text embeddings with the filters applied. Parsed queries are cached by hash for a day, and if the parser times out the sentence is run as a keyword search instead.
- Image search: the uploaded photo is embedded with the same Titan model and matched against product image embeddings; results are de-duplicated by product.
- Similar products: nearest neighbours of the product's own text embedding within the same category, computed on demand and cached with the product page.

Every search writes a `search_queries` row, and zero-result queries surface in the admin console as the catalogue gap report.

### 6.9 Shopping assistant

The assistant is stateless on the server.
The browser sends the question and the last few turns; the server retrieves the most relevant approved, in-stock products by embedding similarity plus any products the buyer named, and calls DeepSeek with a strict instruction to answer only from the supplied product data and to say so when it cannot.
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
| Keyset pagination | Product lists, order lists, ledgers | Page 200 costs the same as page 1. |
| Small category tree in memory | Category filters and breadcrumbs | Descendant category ids are computed in the app from a 60-second cached tree; no recursive queries. |
| Everything slow goes to the worker | AI calls, embeddings, image resizing, PDFs, emails, imports | Requests stay under a few hundred milliseconds regardless of external service latency. |
| Pre-sized images on the CDN | Thumbnail, card, and gallery sizes generated at upload | No on-the-fly resizing; immutable cache headers keyed by content hash. |
| Connection pooling | Every database connection | Transaction-mode pooling from day one, which also works with the row-level security session variables because they are set with `SET LOCAL` inside the transaction. |
| Atomic conditional updates | Stock, coupon usage, invoice sequences | Correct under concurrency without table locks or application-level mutexes. |

## 8. Security

- Row-level security is enabled on every table that holds buyer or seller data. The web app connects as a database role that is subject to the policies and sets `app.user_id`, `app.role`, and `app.seller_id` with `SET LOCAL` in each transaction. Buyers can only see their own orders and addresses, sellers only their own products, order lines, ledger, and imports, and administrators see everything. The worker connects as a separate role that bypasses the policies.
- Application code still checks permissions explicitly; row-level security is the safety net that makes a missed check a bug rather than a data leak.
- Sessions are opaque random tokens stored hashed, with rotation on login and server-side revocation on suspension.
- Rate limits apply to OTP sending and verification, login, checkout, search, and every AI endpoint, using the `rate_limits` table with an upsert per window.
- Razorpay webhooks are verified with the webhook secret before anything is read from the payload, and the checkout return is verified with the key secret. No card data is ever received by EcoKart.
- All prices, totals, stock, and permissions are recomputed on the server; the browser is never trusted.
- Secrets live in environment variables in the hosting platform, never in the repository. Object storage buckets are private and every download is a short-lived signed URL.
- Standard Next.js protections cover cross-site scripting and request forgery; parameterised queries through Drizzle cover injection.
- Every administrator action and every state change on an order is written to `audit_logs` or `order_events`.

## 9. How it grows

The launch deployment is two small web tasks, one worker task, one RDS instance (two to four vCPUs), and one bucket.
That comfortably handles thousands of orders a day and a catalogue in the hundreds of thousands.

When measurements show pressure, the steps are, in order, and none of them changes the code structure.

1. Raise the desired count of the `web` service, or enable ECS auto scaling on CPU. The app is stateless, so this is a slider.
2. Grow the RDS instance class, then add a read replica and point storefront reads at it.
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
| SMS DLT approval is late | Email OTP works from day one; SMS OTP is a switch in settings. |
| AI costs run away | Daily platform and per-seller limits counted from `ai_requests`; results cached by input hash; embeddings regenerated only when content changes. |
| DeepSeek is slow or unavailable | Every AI call runs in the worker with retries, or behind a short timeout on the two request-time paths (query parsing and the assistant). Keyword search never depends on AI, and natural-language search falls back to keyword search. |
| DeepSeek cannot read images or embed | Bedrock covers vision and embeddings in the same AWS account; the provider layer in section 3.2 keeps the swap local if the client changes vendors. |
| Catalogue text leaves the AWS account for DeepSeek | Only catalogue content and the buyer's question are sent, never buyer identity or orders. The client should confirm DeepSeek's data terms are acceptable for its own product data. |
| Single developer and a fixed deadline | Modules with one responsibility each; automated tests on checkout, webhook idempotency, stock, and row-level security; everything else verified through the acceptance checklist. |

## 11. Decisions to confirm before build

| Decision | Recommendation | Alternative |
| --- | --- | --- |
| AWS compute shape | ECS Fargate for both web and worker, RDS, S3 + CloudFront, defined with the CDK | App Runner for the web app with a Fargate worker, or a single EC2 host running Docker Compose for the pilot |
| AI providers | DeepSeek for every text task, Bedrock Titan and Nova for embeddings and photographs | DeepSeek only, with open-weight CLIP or SigLIP embeddings self-hosted in the worker and no photo reading, so the listing builder works from notes only |
| ORM | Drizzle | Prisma |
| Auth | Own OTP tables and database sessions | Better Auth or Auth.js with an OTP plugin |
| Guest cart | Yes, cookie-based, merged into the account on login | Require login before adding to cart |
| Roles | One role per account; a seller uses a separate seller account | One account can be both buyer and seller |
| Commission base | Applied to the seller's line total after the coupon discount share | Applied before discounts |
| Delivery revenue | Delivery charge belongs to the platform | Passed through to sellers |
