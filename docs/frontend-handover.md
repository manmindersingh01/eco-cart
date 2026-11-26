# EcoKart frontend handover

Written 20 November 2026 for the engineer who builds the rest of EcoKart's screens.
It explains what EcoKart is, how to run it, the rules every screen follows, what is already built, what is left, and every API you can call.
The backend is finished: shop, cart, checkout, Razorpay payments, orders, dispatch, invoices, returns, refunds, seller money, reviews, policy pages, and the AI features all have working APIs.
Your job is the screens on top of them.

Read this file first, then keep these open while you work:

- [`AGENTS.md`](../AGENTS.md): the repository rules.
  They are strict and they apply to you.
- [`docs/system-design.md`](system-design.md): the source of truth for how everything works (section 6 has the flows).
- [`docs/backend-spec.md`](backend-spec.md): how each backend step was built.
- [`temp/frontend/step-2-marketplace-completion/`](../temp/frontend/step-2-marketplace-completion/README.md): the original screen plan, one file per task (06 to 12), with acceptance cases.

## 1. EcoKart in one minute

EcoKart is a marketplace for India with three kinds of users.

- **Buyers** browse, search, add to a cart (even before signing in), pay online with Razorpay or with cash on delivery, follow their orders, download GST invoices, ask for returns, and write reviews.
- **Sellers** are independent businesses.
  They list products with photos, a video, and variants (for example size or colour), import products from a spreadsheet, dispatch orders, and see what EcoKart owes them.
- **Administrators** approve sellers and listings, run the category tree and brands, set commission and delivery charges, handle orders, returns and refunds, pay sellers, and edit the policy pages.

One account can be a buyer and a seller at once.
Sign-in is by a one-time code sent by email (phone codes are supported by the backend too), never by password.

It is one Next.js app (`apps/web`), one background worker (`apps/worker`), and shared business logic (`packages/core`).
PostgreSQL is the only database.
The worker does the slow work: resizing photos, converting videos, making invoice PDFs, sending emails, reading imports, and AI calls.
That is why many actions answer "accepted" (HTTP 202) and the screen has to check back until the work is done.

## 2. Where things stand

### Built and working

| Area | Screens |
| --- | --- |
| Sign-in | `/sign-in` (email code and phone code when SMS is enabled), `/access-denied` |
| Shop | Home with product shelves, `/categories/[slug]`, `/products/[slug]` (gallery, video, variants, minimum quantity, review list and buyer review form), `/search` (keyword) |
| Cart and checkout | `/cart` (quantities, coupons), `/checkout` (address, cash on delivery or Razorpay) |
| Buyer account | `/account` (profile and display name), `/account/orders`, `/account/orders/[id]` (progress, tracking, invoices, cancel, Pay now), `/account/addresses`, `/account/seller-application` |
| Seller portal | Overview, business profile, verification documents, products (list, create, full editor with photos, video, variants, submit for review), catalogue imports, orders (list, detail, dispatch and delivery), read-only returns, earnings with statements and masked bank summary, invoice list |
| Administrator portal | Overview, platform settings, sellers (list, create, detail, approve, reject, suspend, reinstate, ask for documents), seller document review, categories, brands, listing moderation, orders (filtered list, detail, cancellation, refund recording, delivery and invoice regeneration), returns (filtered list, detail, approve, reject and record external refunds), seller balances, bank/ledger details, external payout and adjustment recording, settlement statements, customer review moderation |

The shop, cart, checkout, and buyer order screens were built on 19 November 2026 and are on `main`.
Start your work from the latest `main`.

### Not built yet

Coupons administration, policy pages and their editor, background work tools, the AI screens, and a few account extras.
Section 7 lists each one with its route, its APIs, and what "done" means.
The backend for every one of them already exists.

## 3. Running it on your computer

You need Docker Desktop, pnpm 12, and ffmpeg with ffprobe on your `PATH` (the worker refuses to start without them).
Never install Node.js yourself: pnpm downloads the right version from `package.json`.

1. Install packages:

   ```bash
   pnpm install
   ```

2. Copy each example settings file and keep the values as they are for local work: `apps/web/.env.example` to `apps/web/.env`, `apps/worker/.env.example` to `apps/worker/.env`, and `packages/core/.env.example` to `packages/core/.env`.
   Never commit a `.env` file.
3. Start PostgreSQL (port 15434), Mailpit (every email and SMS lands here, at http://localhost:8025), and SeaweedFS (stands in for Amazon S3, at http://localhost:8333):

   ```bash
   pnpm db:up
   ```

4. Create the tables:

   ```bash
   pnpm db:migrate
   ```

5. Add example settings, three approved sellers, a category tree, brands, example products on sale, and placeholder policy pages (it only adds what is missing, and refuses to run in production):

   ```bash
   pnpm db:seed
   ```

6. Create your administrator, then sign in at `/sign-in` with the code that arrives in Mailpit:

   ```bash
   pnpm admin:create --email admin@ecokart.test --name "Local Admin"
   ```

7. Start the web app and the worker together; the web app is at http://localhost:3210:

   ```bash
   pnpm dev
   ```

**Test accounts.**
The seed's sellers sign in as `seller1@ecokart.test`, `seller2@ecokart.test`, and `seller3@ecokart.test`.
Any new email address becomes a new buyer account when it signs in.
Every code arrives in Mailpit.

**Products.**
The seed's example products are already on sale, with a photo each.
To make more, sign in as a seller, create a product with a photo, submit it, then approve it as the administrator.
`pnpm demo:flow`, run against the running app, also creates people and an approved product every run, and walks the whole marketplace through the real APIs.

**Online payment locally.**
Online payment is switched off while the three `RAZORPAY_*` values in `apps/web/.env` are blank; checkout then offers only cash on delivery.
Section 8 explains how to switch it on with Razorpay test keys.

**AI locally.**
`AI_ENABLED=false` is the default, and every AI screen must still work with AI off (section 7.11).

## 4. How screens are built here

### This is Next.js 16 with Cache Components

The installed Next.js differs from older versions you may know.
Before writing a page, read the matching guide in `apps/web/node_modules/next/dist/docs/`.
The points that matter most:

- `cacheComponents: true` is on.
  Anything that reads the request (cookies, headers, `searchParams`, `params`, the session) must sit inside a `<Suspense>` boundary, with the page's fixed parts (title, tabs) outside it.
  Look at `apps/web/src/app/(storefront)/account/orders/page.tsx` for the pattern.
- A page that reads the session also exports `export const instant = false`.
- `typedRoutes: true` is on, so every `href` is checked against real routes.
  A link to a page that does not exist yet fails the typecheck.
  That is on purpose: build the page, then link to it.
- Public pages are cached by tag.
  Read public data only through the cached helpers in `apps/web/src/lib/storefront.ts` and `apps/web/src/lib/public-catalogue.ts`.
  Never call `revalidateTag` yourself; the backend expires the right tags when data changes.
- Personal pages (cart, orders, account, both portals) are never cached.

### Where code goes

| What | Where |
| --- | --- |
| Shop and buyer pages | `apps/web/src/app/(storefront)/...` |
| Seller pages | `apps/web/src/app/seller/...`, add each to the menu in `apps/web/src/app/seller/layout.tsx` |
| Administrator pages | `apps/web/src/app/admin/...`, add each to the menu in `apps/web/src/app/admin/layout.tsx` |
| Interactive parts (client components) | `apps/web/src/components/<area>/...` (`buyer`, `seller`, `admin`, `storefront`, `auth`) |
| Shared building blocks | `apps/web/src/components/ui/...` |
| Small helpers | `apps/web/src/lib/...` |
| API routes (already written) | `apps/web/src/app/api/...` |

### Two ways to get data, and when to use each

1. **Server components call the core services directly.**
   A page imports a service such as `listBuyerOrders` from `@ecokart/core` and runs it inside `withContext(getDatabase(), context, (tx) => ...)`.
   Use this for the first render of a page.
   The page never writes SQL; it only calls services.
2. **Client components call the API with `apiRequest`** from `apps/web/src/lib/api-client.ts`.
   Use this for every change (save, approve, cancel) and for data that must be read in the browser (for example the cart, because a guest's cart lives in a cookie).
   After a change, either update local state from the answer or call `router.refresh()` to re-render the server parts.

### Who may open a page

Every protected page checks the account on the server first:

| Area | Helper | File |
| --- | --- | --- |
| Administrator pages | `requireAdminPage(returnTo)` or `requireAdminPageContext(returnTo)` | `src/lib/page-auth.ts` (the admin layout already calls it) |
| Seller pages | `requireSellerPage(returnTo)` or `requireSellerPageContext(returnTo)` | `src/lib/page-auth.ts` (the seller layout already calls it) |
| Buyer pages | `requireBuyerPage(returnTo)` | `src/lib/buyer-page.ts` |

Each sends a signed-out visitor to `/sign-in?returnTo=...` and someone with the wrong role to `/access-denied`.
The `Context` versions also give you the request context you pass to services.
The server checks permissions again on every API call, so hiding a button is never the only protection.

**Accounts that buy and sell.**
One account can hold both roles; its roles are stored together, for example `buyer,seller`.
Check roles with `rolesOf(user.role).includes('seller')`, never `user.role === 'seller'`.
A request acts in one role at a time: seller routes act as the seller, everything else as the buyer.
A few routes are used by both portals (invoices, settlement statements, return photos).
From the seller portal, add `?as=seller` to those, or a seller who also buys gets their buyer view.

### Errors

Every API error has the same shape:

```json
{ "error": "Plain sentence for the user", "issues": ["fieldName: what is wrong"] }
```

`apiRequest` throws an `ApiError` with `message`, `status`, and `issues`.
Show `message` as the title of a `Notice` and `issues` as a list under it; the backend already writes them in plain language.

| Status | Meaning | What the screen does |
| --- | --- | --- |
| 400 | Something the user typed is not valid | Show the message and the issues next to the form |
| 401 | Not signed in | Send to `/sign-in?returnTo=...` |
| 403 | Signed in, but not allowed | Explain, do not retry |
| 404 | Not found, or not yours | Show a not-found state |
| 409 | The thing changed meanwhile (sold out, already dispatched, total changed) | Show the message, reload the data, let the user try again |
| 429 | Too many attempts | Ask them to wait a minute |
| 503 | Not set up yet (for example company details not saved) | Explain what is missing |
| 202 | Accepted; the worker finishes it | Check back until it is ready (see below) |

### Lists and pages of results

Every list answers `{ "items": [...], "nextCursor": "..." | null }`.
Pass `nextCursor` back as `?cursor=` to get the next page; there are no page numbers and no "jump to page 5".
Keep the cursor in the address so Back and Reload work, and drop it when a filter or sort changes.
`apps/web/src/components/storefront/listing-pager.tsx` and `apps/web/src/app/(storefront)/account/orders/page.tsx` show the pattern.

### Uploading files

Files never pass through the web app.
Every upload is three steps:

1. Ask for a signed form: for example `POST /api/seller/products/{id}/images/uploads` with `{ "contentType": "image/jpeg", "size": 2400000 }`.
   The answer has `url`, `fields`, `key`, and `maxBytes`.
2. Send the file straight to storage: a POST to `url` with the body from `signedUploadBody(fields, file)` (`src/lib/product-editor.ts`), which puts every entry of `fields` first and the file last, as storage requires.
3. Tell the app: for example `POST /api/seller/products/{id}/images` with `{ "uploadKey": key }`.
   It answers 202, because the worker checks and re-encodes the file.

The seller photo editor (`apps/web/src/components/seller/product-photo-editor.tsx`) is a complete working example; copy its approach for return photos, seller documents, imports, and photo search.

### Work the worker finishes later (202 answers)

When an API answers 202, the record has a status such as `processing`, `queued`, `running`, `ready`, `succeeded`, or `failed`.
Read it again every two or three seconds until it is finished, stop when the page closes, and show `failed` with its reason.
This applies to photos, videos, return photos, seller documents, imports, invoice PDFs, settlement statements, and AI listing drafts.

### Money, dates, phone numbers, and words

- Money is always a whole number of paise (₹1 = 100 paise) in fields named `...Paise`.
  Never use decimals for money and never add up a total in the browser; show the totals the server sends.
- Show money with `formatPrice` (`src/lib/storefront-display.ts`) on buyer screens, which gives ₹1,00,000 or ₹199.50, and `formatInr` (`src/lib/format.ts`) in the portals.
- When a user types rupees, convert with `parseRupeesToPaise` (`src/lib/admin-settings.ts`), which never uses floating point.
- Prices include GST.
  Tax rates are basis points: 1800 means 18%; show them with `formatBasisPoints`.
- Show every date in Indian time with `formatIndianDate` (`src/lib/format.ts`).
- Phone numbers are stored as `+919812345678`.
  Let people type ten digits and convert with `toIndianMobile` (`src/components/buyer/address-form.tsx`).
- Write in British and Indian English: catalogue, colour, cancelled.
  Use short, plain sentences.
  Never use the long dash character in code, text, or docs; use a plain hyphen.

### Safety rules for screens

- Never trust the browser: the server recomputes prices, stock, discounts, and permissions.
  Screens may disable a button, but the server decides.
- Never render text from a seller, a buyer, or the AI as HTML.
  Show it as plain text.
  Policy pages are Markdown: render them with a maintained Markdown library with raw HTML switched off.
- Never show a full bank account number; the APIs only return the last 4 digits, on purpose.
- Private files (invoices, statements, documents, return photos) are opened through their `.../file` or `.../pdf` route, which redirects to a link that works for five minutes.
  Use a plain link to that route; never store the redirected address.

## 5. Look and feel

- Colours, spacing, and dark mode come from the tokens in `apps/web/src/app/globals.css`.
  Use the Tailwind names (`bg-surface`, `text-muted`, `border`, `text-brand-strong`, `bg-danger-soft`, and so on); never write a colour by hand.
  Dark mode follows the device setting automatically.
- Build with the shared parts in `apps/web/src/components/ui/`:
  `Button`, `LinkButton`, `IconButton`; `Card`, `Notice`, `EmptyState`, `StatusBadge`, `Skeleton`; `Field`, `Input`, `Select`, `Textarea`, `Checkbox`; `DataTable`, `DataCard`, `DetailList`, `ResponsiveDataList`; `PageHeader`; `ConfirmationDialog` (use it for every action that cannot be undone, and set `dismissLabel` when "Cancel" would be confusing); `PageLoading`, `ContentLoading`, `FormLoading`.
- Portal pages sit inside `PortalShell` through their layout; start each with `PageHeader`.
  Shop pages use `page-container` for their width.
- `cx()` in `src/lib/classes.ts` only joins class names; it does not resolve two classes that fight (for example `px-4` and `px-2`).
  Do not pass a size or padding to a component that already sets one; give the component an option instead.
- Every page must work at phone width (375 pixels) and desktop width with no sideways scrolling.
  Verify one browser (Chrome by default) at large (1440 x 900), medium (768 x 1024) and mobile (390 x 844) sizes, and fix visible issues.
  The project lead agreed this focused scope on 24 November 2026; it replaces mandatory multi-browser and real Safari checks.
- Every control needs a visible label or an `aria-label`, buttons must be at least 44 pixels tall (`min-h-11`), and status messages use `Notice`, which announces itself to screen readers.

## 6. What every finished screen needs

A screen is done when all of these are true:

1. It works through the real APIs against `pnpm dev`, for the right role, and refuses the wrong one.
2. It shows loading, empty, error, and success states, and every message from the server.
3. It looks right at large, medium and mobile sizes in one browser, in light and dark mode, with keyboard access and no horizontal overflow.
   Focus on the main journey, permissions and important errors; testing every possible scenario is not required.
4. These pass, run one at a time from the repository root:

   ```bash
   pnpm format
   ```

   ```bash
   pnpm lint
   ```

   ```bash
   pnpm typecheck
   ```

   ```bash
   pnpm --filter @ecokart/web test
   ```

   ```bash
   pnpm --filter @ecokart/web build
   ```

5. Before a merge to `main`, the full check passes:

   ```bash
   pnpm check
   ```

The existing tests for checkout, payment webhooks, stock, and row-level security are launch-critical and must stay green.
Each task plan in `temp/frontend/step-2-marketplace-completion/` names browser tests (Playwright, in `apps/web/e2e/`).
On 20 October the project lead chose speed over new automated tests until launch, so ask the lead before you write or skip them.
Run checks and the browser tests one at a time in one checkout, because each rewrites Next.js's generated route types.

If a screen needs something the API does not offer, do not work around it in the browser.
Tell the project lead; backend changes follow `AGENTS.md` and update the design doc in the same change.

## 7. Screens still to build

They are in launch order: payment and order accuracy first, AI last.
Each item gives the route to create, the APIs it uses (all listed in section 10), and what to watch for.

### 7.1 Seller orders and dispatch (shipping)

Task 01 adds `/seller/orders` and `/seller/orders/[id]` on 21 November 2026.
Task 01 was completed on 24 November 2026, with Chrome checks at all three agreed sizes and `pnpm check` passing.
The screens show seller-only lines, delivery details, status filters, cursor navigation and seller invoice downloads, with an Orders menu entry.
Implementation verification is recorded in [task 01](../temp/frontend/step-3-remaining-screens/01-seller-orders.md).
Task 02 adds line selection, courier details, optional HTTPS tracking links and confirmed delivery actions to the order detail page.
Its verification evidence is recorded in [task 02](../temp/frontend/step-3-remaining-screens/02-seller-dispatch.md).
The existing API contracts below are unchanged.

There is no courier company integration.
The seller books their own courier (for example Delhivery or India Post), then records the courier name and tracking number in EcoKart.
The buyer sees the tracking details and link on their order page straight away.

- `/seller/orders`: tabs "To dispatch", "Dispatched", "Delivered", "Cancelled" from `GET /api/seller/orders?tab=to_dispatch|dispatched|delivered|cancelled`.
  Each row is a `SellerOrderSummary`: order number, date, buyer name, only this seller's lines, and `sellerTotalPaise`.
- `/seller/orders/[id]`: `GET /api/seller/orders/{id}` gives the delivery address, the buyer's phone (the courier needs it), the seller's lines with their status, and the seller's own invoice.
  - **Dispatch:** the seller ticks the confirmed lines that go in one parcel and types the courier name, the tracking number, and an optional `https://` tracking link, then `POST /api/seller/orders/{id}/shipments` with `{ "lineIds": [...], "courierName", "trackingNumber", "trackingUrl" }`.
    An order can go in several parcels.
  - **Delivered:** `POST /api/seller/shipments/{shipmentId}/delivered` marks a parcel delivered.
    For cash on delivery this is when the payment counts as collected.
  - **Invoice:** `GET /api/invoices/{id}/pdf?as=seller`.
- A 409 means another tab already dispatched or cancelled the line: show the message and reload.
- Add "Orders" to the seller menu.

### 7.2 Administrator orders

Task 03 adds the administrator order list and detail pages on 25 November 2026.
The list supports status, full order-number and needs-refund filters, with cursor pagination.
Applying filters resets pagination; Back to orders preserves the filters and cursor from the list.
Details show the original order totals and items, delivery address, parcels, payment records, event history and private invoice downloads.
Implementation and verification evidence is recorded in [task 03](../temp/frontend/step-3-remaining-screens/03-admin-orders.md).
Task 04 adds confirmed cancellation with a reason, recording an already-made Razorpay refund, parcel delivery overrides and invoice PDF regeneration.
Refund wording says explicitly that EcoKart does not move money, and rupee input is converted to exact integer paise.
Actions refresh the server view after success or failure so stale controls are removed.
Invoice regeneration shows request failures and the accepted queue state; its API does not report when that specific render job finishes or fails.
An available PDF may still be the previous version, so the UI does not announce a completed regeneration based on availability alone.
Verification evidence is recorded in [task 04](../temp/frontend/step-3-remaining-screens/04-admin-order-actions.md).

- `/admin/orders`: `GET /api/admin/orders` with filters `?status=`, `?needsRefund=true` (paid orders that were cancelled and still owe a refund), and `?orderNumber=EK-261018-000123` to find one order.
  Show a clear "needs refund" marker.
- `/admin/orders/[id]`: `GET /api/admin/orders/{id}` gives the lines, parcels, payments, the event history, and invoices.
  - **Cancel** before dispatch: `POST /api/admin/orders/{id}/cancel` with a required `reason`.
  - **Record a refund** for a paid, cancelled order: the administrator refunds in the Razorpay dashboard first, then records it with `POST /api/admin/orders/{id}/refund` and `{ "method": "gateway", "amountPaise", "razorpayRefundId": "rfnd_..." }`.
    Say clearly on screen that this records a refund already made; it does not move money.
  - **Mark a parcel delivered** for a seller who cannot (for example a suspended one): `POST /api/admin/shipments/{id}/delivered`.
  - **Make an invoice PDF again:** `POST /api/admin/invoices/{id}/render` (answers 202).
- Add "Orders" to the administrator menu.

### 7.3 Returns

Task 05 adds return requests to delivered lines on the buyer order detail page.
The form supports quantity, the existing reasons and optional photos uploaded directly to storage and checked by the worker before submission.
Other requires an explanation; request errors preserve the form, and photo polling stops when the form closes or unmounts.
Blank quantity asks the server to return everything still eligible.
Evidence is recorded in [task 05](../temp/frontend/step-3-remaining-screens/05-buyer-return-request.md).
Task 06 adds `/account/returns` and `/account/returns/[id]` with cursor pagination, status wording, decision notes, recorded refunds and protected photo links.
The account tabs and returned order lines link to tracking; details provide a refresh button and a link back to the originating list page.
Evidence is recorded in [task 06](../temp/frontend/step-3-remaining-screens/06-buyer-returns.md).
Task 07 adds the seller return list and read-only detail pages, status filters, cursor pagination, administrator notes and protected photos opened with `?as=seller`.
Seller routes always act in seller context, including dual-role accounts, and only show that business's returns.
Refund records are omitted by the seller contract; the detail uses the return status without claiming an omitted record means no refund.
Evidence is recorded in [task 07](../temp/frontend/step-3-remaining-screens/07-seller-returns.md).
Task 08 adds the administrator return list and detail pages with status filters, private photos, approval with an optional note and rejection with a required note.
Requested and approved lists use oldest-first service ordering; finished lists use newest-first ordering.
Confirmed decisions refresh the server view, including when another tab has already decided the return.
Approval does not issue or record a refund.
Evidence is recorded in [task 08](../temp/frontend/step-3-remaining-screens/08-admin-return-decisions.md).
Task 09 adds recording an already-made refund on approved returns, with exact money input, the server's maximum value, method-specific references and confirmation that no money is moved.
Cash-on-delivery returns use bank transfer; online returns offer Razorpay or bank transfer, matching the existing service.
The form explains that recording a smaller refund still completes the return, and refreshes the server result after saving or a conflict.
Evidence is recorded in [task 09](../temp/frontend/step-3-remaining-screens/09-admin-return-refunds.md).

Returns can be asked for only after delivery, within the return window the administrator set (setting `return_window_days`).

- **Buyer, from a delivered line on `/account/orders/[id]`:** a "Return" action opens a form with quantity (default: everything still returnable), reason (`damaged`, `defective`, `wrong_item`, `not_as_described`, `missing_parts`, `no_longer_needed`, `other`; `other` needs text), and optional photos.
  Photos use the upload steps from section 4: `POST /api/account/return-photos/uploads`, send to storage, `POST /api/account/return-photos` with the `uploadKey`, then check `GET /api/account/return-photos/{id}` until `ready`.
  Send with `POST /api/account/returns` and `{ "orderItemId", "quantity", "reasonCode", "reasonText", "photoIds" }`.
  The server refuses a line that is not returnable and says why; show that message.
- **Buyer, `/account/returns` and `/account/returns/[id]`:** `GET /api/account/returns` and `GET /api/account/returns/{id}`.
  Status is `requested`, `approved`, `rejected`, or `refunded`, with the administrator's note.
  Add "Returns" to the account tabs in `src/components/buyer/account-nav.tsx`.
- **Seller, `/seller/returns`:** `GET /api/seller/returns?status=...` and `GET /api/seller/returns/{id}`; read only.
  Photos open through `GET /api/return-photos/{id}/file?as=seller`.
- **Administrator, `/admin/returns` and `/admin/returns/[id]`:** list by status from `GET /api/admin/returns?status=requested` (oldest first).
  Approve with an optional note (`POST .../approve`), reject with a required note (`POST .../reject`).
  After approval, record the refund with `POST .../refund`: `{ "method": "gateway", "amountPaise", "razorpayRefundId" }` for online payments, or `{ "method": "bank_transfer", "amountPaise", "note": "<bank reference>" }` for cash on delivery.
  Never allow more than `maxRefundPaise` from the return.
  Recording a refund puts the stock back and takes the money back from the seller's balance automatically.

### 7.4 Seller earnings

Task 10 adds `/seller/earnings`, its seller menu entry, the signed current balance, paginated money history and masked bank summary.
Negative balances remain negative, and the wording explains whether the seller or EcoKart owes the amount.
Bank details are read-only for sellers and show only the last four account digits.
The refresh button reloads server totals.
Evidence is recorded in [task 10](../temp/frontend/step-3-remaining-screens/10-seller-earnings.md).
Task 11 adds statement requests and history to earnings and the separate seller invoice list.
Statement status updates while processing, displays failure reasons and stops polling after completion or unmount.
Ready CSV and PDF files use protected seller-context routes, with unavailable-file messages and no signed storage URL stored in the page.
Evidence is recorded in [task 11](../temp/frontend/step-3-remaining-screens/11-seller-documents.md).

- `/seller/earnings`:
  - The balance and the ledger from `GET /api/seller/ledger` (`balancePaise` plus a page of entries).
    Entry types: `sale`, `commission`, `refund_reversal`, `commission_reversal`, `payout`, `adjustment`.
    Positive amounts are owed to the seller; negative ones are taken back or paid out.
    A negative balance is real (the seller owes EcoKart); show it honestly.
  - The bank account from `GET /api/seller/bank-account`: holder, IFSC, and the last 4 digits only.
    Sellers cannot change it; an administrator enters it.
  - **Settlement statements:** ask for one with `POST /api/seller/settlement-statements` and `{ "from": "2026-10-01", "to": "2026-10-31" }` (Indian dates, both included, at most a year).
    It answers 202; check `GET /api/settlement-statements/{id}?as=seller` until `ready`, then download from `GET /api/settlement-statements/{id}/file?as=seller`.
    List them with `GET /api/seller/settlement-statements`.
- `/seller/invoices`: `GET /api/seller/invoices`, each with a download link to `/api/invoices/{id}/pdf?as=seller`.
- Add "Earnings" and "Invoices" to the seller menu.

### 7.5 Administrator payouts and seller money

Task 12 adds the balance list and seller-detail bank and ledger screens on `frontend/step-3-admin-seller-money`.
The bank form starts empty, confirms only the new account's last four digits and clears all entry fields after success.
It also clears the number after a failed save attempt.
The balance list uses the service's largest-first non-zero ordering and cursor pages; seller ledgers show the full balance alongside newest-first entries.
See [task 12](../temp/frontend/step-3-remaining-screens/12-admin-seller-money.md) for verification evidence.
Tasks 13 and 14 add payout and adjustment recording and administrator statement requests, history and private CSV downloads on `frontend/step-3-admin-payouts-statements`.
Payouts record completed external transfers and never initiate a payment.
Confirmations show the amount and masked bank account; rejected writes preserve useful values.
Uncertain write results require a reload and history check before another attempt from that form.
Statements use administrator access for status and file reads, while the shared components keep seller access as their default.
Statement and ledger cursors remain separate.
See [task 13](../temp/frontend/step-3-remaining-screens/13-admin-payout-recording.md) and [task 14](../temp/frontend/step-3-remaining-screens/14-admin-statements.md) for verification evidence.

- `/admin/payouts`: sellers with a balance from `GET /api/admin/seller-balances`, largest first, with their bank account's last 4 digits or "no bank account yet".
- On the seller detail page (`/admin/sellers/[id]`), add:
  - **Bank account:** `GET` and `PUT /api/admin/sellers/{id}/bank-account` with `{ "accountHolder", "accountNumber", "ifsc" }`.
    The form starts empty every time; never show or fill in the stored number.
  - **Ledger:** `GET /api/admin/sellers/{id}/ledger`.
  - **Record a payout:** the administrator pays the seller by bank transfer first, then records it with `POST /api/admin/sellers/{id}/payouts` and `{ "amountPaise", "reference": "<UTR from the bank>" }`.
    Ask for confirmation showing the amount and the bank account's last 4 digits.
  - **Adjustment:** `POST /api/admin/sellers/{id}/adjustments` with `{ "amountPaise": -1000, "reason": "..." }`, positive to pay more and negative to take back.
    The reason is required.
    Entries are never edited or deleted; a mistake is fixed with a new adjustment.
  - **Statements:** `GET` and `POST /api/admin/sellers/{id}/settlement-statements`, then the same status and file routes as the seller (without `?as=seller`).
- Add "Payouts" to the administrator menu.

### 7.6 Buyer account extras

Tasks 15 and 16 add display-name editing at `/account` and phone sign-in on `frontend/step-3-buyer-profile-phone-sign-in`.
The profile uses the existing buyer access rule and refreshes the header after a successful name save.
It keeps contact details read-only and hides placeholder email addresses.
An expired session preserves the draft name and links back through sign-in.
Phone sign-in uses the existing SMS configuration and is offered only while that channel is enabled.
Email sign-in and safe return URLs remain supported.
See [task 15](../temp/frontend/step-3-remaining-screens/15-buyer-name.md) and [task 16](../temp/frontend/step-3-remaining-screens/16-phone-sign-in.md) for verification evidence.

- **Name:** there is no EcoKart route for it; use Better Auth's `authClient.updateUser({ name })` from `src/lib/auth-client.ts`.
  Changing an email address or phone number needs a verified flow; agree it with the project lead first.
- **Phone sign-in:** the backend supports it (Better Auth's phone plugin; in development each code lands in Mailpit as an email to the number without its plus sign at `sms.mailpit.test`, for example `919812345678@sms.mailpit.test`).
  `src/lib/auth-client.ts` includes `phoneNumberClient()` (from `better-auth/client/plugins`), and `/sign-in` offers "Sign in with phone" using `authClient.phoneNumber.sendOtp` and `authClient.phoneNumber.verify` when SMS is enabled.
  Phone-only accounts get a placeholder email ending in `.invalid`; never show it.
- **Reviews:** on the product page, a signed-in buyer writes one review (`POST /api/products/{slug}/reviews` with `{ "rating": 1-5, "authorName", "title", "body" }`) and edits it later (`GET` and `PATCH .../reviews/mine`).
  The "Verified purchase" badge comes from the server; never decide it in the browser.
  Show "load more" for reviews with `GET /api/products/{slug}/reviews?cursor=`.

### 7.7 Administrator coupons

- `/admin/coupons`: list with `GET /api/admin/coupons`, create with `POST`, change with `PATCH /api/admin/coupons/{id}`.
- Fields: `code` (3 to 20 letters or digits, stored in capitals, cannot change later), `description`, `discountType` (`percent` or `fixed`), `discountValue` (basis points for percent, so 1000 is 10%; paise for fixed), `minOrderPaise`, `maxDiscountPaise` (percent only), `usageLimit`, `perUserLimit`, `startsAt`, `endsAt`, `isActive`.
- Let the administrator type rupees and percentages; convert to paise and basis points before sending.
- Switch a coupon off with `{ "isActive": false }`; coupons are never deleted.

### 7.8 Review moderation

Tasks 17 and 19 add buyer review creation/editing on product pages, published-review pagination and administrator moderation on `frontend/step-3-buyer-reviews-moderation`.
The buyer's own review is loaded privately, including hidden reviews, and editing a hidden review does not republish it.
Product rating summaries and verified-purchase badges use the server's values.
`/admin/reviews` filters published and hidden reviews, follows cursor pages, links to products and confirms hide/show decisions.
See [task 17](../temp/frontend/step-3-remaining-screens/17-buyer-reviews.md) and [task 19](../temp/frontend/step-3-remaining-screens/19-admin-reviews.md) for verification evidence.

- `/admin/reviews`: `GET /api/admin/reviews?status=published|hidden`, and hide or show one with `PATCH /api/admin/reviews/{id}` and `{ "status": "hidden" }`.
  Link each review to its product.

### 7.9 Policy pages and the footer

- Public `/policies/[slug]` for `terms`, `privacy`, `shipping`, `returns`, `refunds`, and `seller-agreement`, read through `readContentPage` in `src/lib/storefront.ts` (cached).
  Render the Markdown safely (raw HTML off) and show a not-found page for a draft.
- The storefront footer: links to those pages, and EcoKart's legal name, address, GSTIN, and grievance officer from `readCompanyDetails` (it fails with "not configured" until an administrator saves the company details in settings; show the links without the details in that case).
- `/admin/content` and `/admin/content/[slug]`: `GET /api/admin/content` lists every page, also unwritten ones; `PUT /api/admin/content/{slug}` saves `{ "title", "bodyMarkdown", "status": "draft" | "published" }`.
  Offer a preview rendered the same safe way.
- The real legal text comes from the client.
  `pnpm db:seed` publishes placeholder text so the links work locally; placeholder text is not ready for launch.

### 7.10 Background work tools for administrators

- `/admin/background-work`:
  - Queues with waiting, running, and failed counts: `GET /api/admin/queues`.
  - Failed jobs of one queue: `GET /api/admin/queues/{name}/failed-jobs`, retry one with `POST .../failed-jobs/{id}/retry`.
  - Emails that failed or are stuck: `GET /api/admin/emails?state=failed|stuck`, retry with `POST /api/admin/emails/{id}/retry`.
- Ask for confirmation before each retry and refresh afterwards.

### 7.11 AI features

Every AI screen must still work when AI is off or fails: the APIs fall back or say so, and the screen must show that calmly.
AI suggestions are only suggestions; nothing is saved or published until a person chooses it.

- **Smart search:** `GET /api/search/natural?q=a steel bottle under 500 rupees` answers products plus `match` (`meaning`, or `exact`/`similar` when it fell back to keywords) and `understood` (what the sentence was taken to mean, or null).
  Offer it on `/search`, for example as a toggle, and show what was understood.
- **Search by photo:** get a signed form from `POST /api/search/photo/uploads`, upload the photo, then `GET /api/search/photo?photo=<key>`.
- **Similar products:** `GET /api/products/{slug}/similar` (or `readSimilarProducts` in `src/lib/storefront.ts`) under the product page, loaded without blocking the page.
- **Shopping assistant:** a panel that sends `POST /api/assistant` with `{ "question", "history", "productIds" }` (`productIds` are the products the shopper is looking at, for example two to compare).
  The answer is an `AssistantAnswer`: plain-text `answer`, `declined` when it cannot answer from the products, product cards, and an optional `comparison` table.
  Show `answer` as plain text and the products as normal product cards.
- **Listing draft for sellers,** in the product editor once it has a ready photo: `POST /api/seller/listing-drafts` with `{ "productId" }` (202, or 200 with a recent draft), then check `GET /api/seller/listing-drafts/{id}` until `succeeded`.
  Show each suggested field next to the current value and let the seller pick fields; save the picked ones with the normal `PATCH /api/seller/products/{id}`.
  Never overwrite what the seller has typed but not saved.
- **Import mapping suggestions:** `GET /api/seller/imports/{id}` includes `suggestedMapping` (each column's suggested field, with `source` `name` or `ai`) and `suggestionPending` while the worker is still thinking.
  The import screen (`src/components/seller/import-manager.tsx`) already pre-fills the `name` suggestions but ignores the `ai` ones.
  Add the `ai` ones, marked as AI suggestions, show a note while `suggestionPending` is true, and keep the seller's confirmation before `PUT .../mapping`.
- **Administrator reports:** `/admin/ai` from `GET /api/admin/ai/usage?from=&to=` (calls, failures, cost per day and feature, today's use against the limit), and `/admin/search-gaps` from `GET /api/admin/search/gaps?days=30` (searches that found nothing, so the team knows what to stock).

### 7.12 Smaller items

- Natural-language search, photo search, and the assistant need a place in the header or search page; agree the layout with the project lead.
- The administrator overview (`/admin`) and seller overview (`/seller`) should link to the new pages with counts, for example returns waiting for a decision or orders to dispatch.
- The older task plan `12-release-and-evidence.md` lists historical release checks.
  Its mandatory Safari pass is superseded by the one-browser, three-size verification decision of 24 November 2026.

## 8. Payments with Razorpay

The whole payment backend is done and tested; checkout, the buyer's order page, and "Pay now" already use it.
Read design doc section 6.3 for the full flow.

**How it works.**

1. Checkout sends `POST /api/checkout` with `{ "addressId", "paymentMethod": "razorpay" | "cod", "expectedTotalPaise" }`.
   `expectedTotalPaise` is the total the buyer saw; if the price changed meanwhile, the server refuses with 409 and the screen shows the new total.
2. For online payment the answer includes `payment`: `keyId`, `razorpayOrderId`, `amountPaise`, and `prefill`.
   The browser opens Razorpay's own payment window with it (`src/lib/razorpay-checkout.ts` loads `https://checkout.razorpay.com/v1/checkout.js`).
   Card and UPI details are typed into Razorpay's window, never into EcoKart.
3. When the buyer pays, Razorpay hands the browser three values, which go to `POST /api/checkout/payment`.
   The server checks the signature and asks Razorpay before confirming.
   Razorpay's webhook confirms the same payment too; whichever comes first wins, and the other changes nothing.
4. If the buyer closes the window, the order waits as "awaiting payment" for `payment_timeout_minutes` (30 by default), then is cancelled and the stock goes back on sale.
   Until then, "Pay now" on the order page reopens Razorpay for the same order (`GET /api/account/orders/{id}/payment`).
5. Cash on delivery orders are confirmed at once and count as paid when the parcel is marked delivered.

**Turning it on locally.**
In the Razorpay dashboard, switch to Test Mode and create test API keys.
Put three values in `apps/web/.env` (all three or none; the app refuses to start with only some):

```text
RAZORPAY_KEY_ID=rzp_test_...
RAZORPAY_KEY_SECRET=...
RAZORPAY_WEBHOOK_SECRET=...
```

Leave `RAZORPAY_API_URL` blank; it is only for the fake Razorpay server that the automated tests use.
The webhook secret is any long secret you choose when you add a webhook in the Razorpay dashboard (Settings, then Webhooks) pointing at `https://<your-public-address>/api/webhooks/razorpay` with the events `payment.captured`, `order.paid`, and `payment.failed`.
Razorpay cannot reach `localhost`, so locally the webhook only works through a tunnel (for example cloudflared); without it the browser confirmation still works.
Pay with Razorpay's published test cards or test UPI ids.
Restart `pnpm dev` after changing `.env`.

**Rules.**

- Never put the key secret or webhook secret in browser code; only `keyId` reaches the browser, inside the checkout answer.
- Never confirm an order from the browser alone, and never add a second way to confirm payment.
- Refunds are made in the Razorpay dashboard and then recorded in EcoKart (sections 7.2 and 7.3).
- Live keys are for production only and live in the production secrets store, never in a file.

## 9. Order and line states

Orders and their lines have separate states, because one order can hold items from several sellers.
Show the server's values; never work them out yourself.

| Field | Values |
| --- | --- |
| Order `status` | `pending_payment`, `confirmed`, `cancelled`, `completed` |
| Order `progress` (for badges) | `awaiting_payment`, `confirmed`, `partly_dispatched`, `dispatched`, `delivered`, `cancelled` |
| Order `paymentState` | `awaiting_payment`, `paid`, `pay_on_delivery`, `refund_due`, `refunded`, `not_charged` |
| Line `status` | `confirmed`, `dispatched`, `delivered`, `cancelled`, `return_requested`, `returned` |
| Return `status` | `requested`, `approved`, `rejected`, `refunded` |
| Product `status` | `draft`, `pending_review`, `approved`, `rejected`, `archived` |
| Seller `status` | `pending`, `approved`, `suspended`, `rejected` |

The buyer screens' plain words for these are in `src/lib/order-display.ts`; reuse them.
`canCancel` on an order says whether the cancel button may show.

## 10. API reference

Every route below exists and is working.
Paths with `[id]` or `[slug]` take that value in the address.
"Who" says which account may call it; the server enforces it.
The exact request rules live in each route's handler under `apps/web/src/app/api/` and in the module's `types.ts` under `packages/core/src/modules/`.
Better Auth's own routes (sign-in codes, sign-out, session) are under `/api/auth/*`; use them through `authClient` in `src/lib/auth-client.ts`, never by hand.

### Public shop (no sign-in)

- `POST /api/assistant` (anyone).
  Asks the shopping assistant, for anyone: `{ "question": "...", "history": [{ "from": "shopper" or "assistant", "text": "..." }], "productIds": ["..."] }`.
  The answer names products as cards, never as text to show as HTML.
  Never cached; each question counts against the visitor's address.
- `GET /api/brands` (anyone).
  Active brands A to Z: `?q=bamboo&cursor=...&limit=20`.
- `GET /api/categories` (anyone).
  The visible category tree, for menus and the seller's category picker.
- `GET /api/categories/[slug]/products` (anyone).
  A category with its breadcrumbs and subcategories, and a page of the products in it and below it: `?brand=&minPricePaise=&maxPricePaise=&includeOutOfStock=&sort=&cursor=&limit=`.
- `GET /api/company` (anyone).
  EcoKart's legal name, address, GSTIN, support contacts, and grievance officer, for the storefront footer; 503 until an administrator saves them.
- `GET /api/content/[slug]` (anyone).
  A published policy page in Markdown, for anyone: terms, privacy, shipping, returns, refunds, or seller-agreement.
  404 while it is a draft.
- `GET /api/home` (anyone).
  The home page: new arrivals, then a row per top-level category.
- `GET /api/products/[slug]` (anyone).
  One product page, for anyone; 404 unless the product is on sale.
- `GET /api/products/[slug]/reviews` (anyone).
  The product's published reviews, newest first: `?cursor=&limit=`.
- `POST /api/products/[slug]/reviews` (signed-in buyer).
  A buyer's review of the product, once: `{ "rating": 5, "authorName": "Priya S.", "title": "...", "body": "..." }`.
- `GET /api/products/[slug]/reviews/mine` (signed-in buyer).
  The buyer's own review of the product, also when it is hidden; or 404.
- `PATCH /api/products/[slug]/reviews/mine` (signed-in buyer).
  Changes any of the buyer's rating, name, title, and text.
- `GET /api/products/[slug]/similar` (anyone).
  Up to eight products like this one, in its category and in stock, nearest in meaning first; 404 unless the product is on sale.
  Cached like the product page.
- `GET /api/search` (anyone).
  Keyword search, never cached, because each search is logged and limited: `?q=&category=&brand=&minPricePaise=&maxPricePaise=&includeOutOfStock=&sort=&cursor=&limit=`.
- `GET /api/search/natural` (anyone).
  Search by a sentence, such as "a steel bottle under 500 rupees": `?q=&category=&brand=&minPricePaise=&maxPricePaise=&includeOutOfStock=&cursor=&limit=`.
  Products come nearest in meaning first, or from a keyword search when AI cannot help; `understood` says what the sentence was taken to mean.
  Never cached, because each search is logged and limited.
- `GET /api/search/photo` (anyone).
  Products that look like an uploaded photo, nearest first: `?photo=&category=&brand=&minPricePaise=&maxPricePaise=&includeOutOfStock=&cursor=&limit=`, where `photo` is the key from POST /api/search/photo/uploads.
  Never cached, because each search is logged and limited.
- `POST /api/search/photo/uploads` (anyone).
  A signed form for uploading a photo to search with, straight to object storage: `{ "contentType": "image/jpeg", "size": 1800000 }`.
  Counts as a search against the visitor's address.

### Cart and checkout

- `GET /api/cart` (guest or buyer).
  The visitor's cart, priced fresh; empty for a new visitor.
- `DELETE /api/cart/coupon` (guest or buyer).
  Takes the coupon off the cart.
- `PUT /api/cart/coupon` (guest or buyer).
  Uses a coupon on the cart: `{ "code": "DIWALI25" }`.
- `POST /api/cart/items` (guest or buyer).
  Adds an item, or more of one already in the cart.
- `DELETE /api/cart/items/[variantId]` (guest or buyer).
  Takes an item out of the cart.
- `PATCH /api/cart/items/[variantId]` (guest or buyer).
  Sets how many of an item the cart holds: `{ "quantity": 3 }`.
- `GET /api/checkout` (signed-in buyer).
  The ways the buyer can pay right now.
- `POST /api/checkout` (signed-in buyer).
  Places an order from the buyer's cart (design doc 6.3): `{ "addressId", "paymentMethod": "razorpay" or "cod", "expectedTotalPaise" }`.
  For online payment the answer carries what the browser opens Razorpay's checkout with.
- `POST /api/checkout/payment` (signed-in buyer).
  The browser coming back from Razorpay's checkout (design doc 6.3 step 6): `{ "razorpayOrderId", "razorpayPaymentId", "razorpaySignature" }`, as Razorpay hands them to the page.

### Buyer account

- `GET /api/account/addresses` (signed-in buyer).
  The buyer's saved addresses, the default first.
- `POST /api/account/addresses` (signed-in buyer).
  Saves a new address; the buyer's first one becomes the default.
- `DELETE /api/account/addresses/[id]` (signed-in buyer).
  Deletes an address; the newest other one becomes the default if needed.
- `GET /api/account/addresses/[id]` (signed-in buyer).
  One of the buyer's saved addresses.
- `PATCH /api/account/addresses/[id]` (signed-in buyer).
  Changes an address, or makes it the default with `isDefault: true`.
- `GET /api/account/orders` (signed-in buyer).
  The buyer's orders, newest first: `?cursor=...&limit=20`.
- `GET /api/account/orders/[id]` (signed-in buyer).
  One of the buyer's orders, with its parcels and invoices.
- `POST /api/account/orders/[id]/cancel` (signed-in buyer).
  The buyer cancels their order before anything in it is dispatched: `{ "reason"?: "Ordered the wrong size" }`.
- `GET /api/account/orders/[id]/payment` (signed-in buyer).
  What the browser opens Razorpay's checkout with again, for the buyer's order still waiting for its online payment; 409 once it is paid, cancelled, or expired.
  The answer has the same shape as checkout's `payment`, and the browser confirms it at /api/checkout/payment.
- `POST /api/account/return-photos` (signed-in buyer).
  Adds an uploaded return photo: `{ "uploadKey": "uploads/returns/..." }`.
  Answers 202, because the worker checks the photo afterwards; follow it with GET /api/account/return-photos/{id}.
- `GET /api/account/return-photos/[id]` (signed-in buyer).
  One of the buyer's return photos: processing, ready, or failed with why.
- `POST /api/account/return-photos/uploads` (signed-in buyer).
  A signed form for uploading one return photo straight to object storage: `{ "contentType": "image/jpeg", "size": 2400000 }`.
- `GET /api/account/returns` (signed-in buyer).
  The buyer's returns, newest first: `?cursor=...&limit=20`.
- `POST /api/account/returns` (signed-in buyer).
  Asks to return a delivered line: `{ "orderItemId", "quantity"?, "reasonCode", "reasonText"?, "photoIds"? }`.
- `GET /api/account/returns/[id]` (signed-in buyer).
  One of the buyer's returns.
- `GET /api/account/seller-application` (any signed-in account).
  The account's application to sell, with its status, or the seller business it became: `pending`, `rejected` with `rejectionReason`, `approved`, or `suspended`.
  404 before applying.
- `PATCH /api/account/seller-application` (signed-in buyer).
  Changes any of those details while the application is open.
- `POST /api/account/seller-application` (signed-in buyer).
  Applies to sell with the business details, or sends a rejected application again: `{ "displayName", "legalName", "gstin", "pan", "line1", "city", "stateCode", "pincode", "supportEmail", "supportPhone" }` and optionally `"invoicePrefix"`.
  The buyer keeps shopping meanwhile.
- `GET /api/me` (any signed-in account).
  The signed-in account, for the storefront header and the two portals.
  `role` is how this request acts, the buyer for an account that also sells; `roles` is everything the account may be, so the header can offer the seller portal to an approved applicant.
  401 when signed out; 403 for a seller account that is not set up yet.

### Shared by several roles

- `GET /api/invoices` (any signed-in account, `?as=seller` from the seller portal).
  The invoices of one order the caller may see: `?orderId=...`.
  The buyer and administrators get every seller's invoice, a seller only their own, with `&as=seller` from the seller portal (areaOf).
- `GET /api/invoices/[id]/pdf` (any signed-in account, `?as=seller` from the seller portal).
  Sends the browser to a five-minute signed link to the invoice PDF, so a plain link downloads it.
  409 while the worker is still making the PDF.
  `?as=seller` from the seller portal (areaOf).
- `GET /api/return-photos/[id]/file` (any signed-in account, `?as=seller` from the seller portal).
  Sends the browser to a five-minute signed link to a checked return photo, for the buyer who took it, the seller of the returned item, and administrators.
  409 while the worker is still checking it.
  `?as=seller` from the seller portal (areaOf).
- `GET /api/settlement-statements/[id]` (any signed-in account, `?as=seller` from the seller portal).
  One settlement statement, for its seller and administrators, to follow the worker until its status is `ready` or `failed`.
  Combined accounts select their seller area with `?as=seller`.
- `GET /api/settlement-statements/[id]/file` (any signed-in account, `?as=seller` from the seller portal).
  Sends the browser to a five-minute signed link to the statement's CSV, for its seller and administrators.
  409 while the worker is making it.
  Combined accounts select their seller area with `?as=seller`.

### Seller portal

- `GET /api/seller/bank-account` (seller).
  The bank account the seller's payouts go to, with only the last 4 digits of the account number; `null` until an administrator enters it.
- `GET /api/seller/documents` (seller).
  The documents administrators asked this seller for, newest first: `?show=open` (the default) or `?show=all`, with `cursor` and `limit`.
- `GET /api/seller/documents/[id]` (seller).
  One of the seller's document requests with every file sent for it.
- `POST /api/seller/documents/[id]/files` (seller).
  Adds an uploaded file: `{ "uploadKey": "uploads/seller-documents/..." }`.
  Answers 202, because the worker checks the file afterwards.
- `POST /api/seller/documents/[id]/uploads` (seller).
  A signed form for uploading one file straight to object storage: `{ "contentType": "application/pdf", "size": 250000 }`.
  PDF, JPEG, or PNG, at most 10 MB.
- `GET /api/seller/imports` (seller).
  The seller's imports, newest first: `?cursor=...`.
- `POST /api/seller/imports` (seller).
  Starts an import from an uploaded file: `{ "uploadKey": "uploads/...", "fileName": "products.xlsx" }`.
  Answers 202, because the worker reads the file afterwards.
- `GET /api/seller/imports/[id]` (seller).
  One import: its status, counts, column headings, and first rows.
- `GET /api/seller/imports/[id]/error-report` (seller).
  Sends the browser to a five-minute signed link to the CSV of rows that could not be imported, so a plain link downloads it.
  409 until the import has finished, or when every row was imported.
- `PUT /api/seller/imports/[id]/mapping` (seller).
  Says which column fills which field and starts the import: `{ "columnMapping": { "Product Name": "title", "Price (Rs)": "price" } }`.
  Answers 202, because the worker makes the drafts afterwards.
- `POST /api/seller/imports/uploads` (seller).
  A signed form for uploading a catalogue file straight to object storage: `{ "fileName": "products.xlsx", "size": 240000 }`.
- `GET /api/seller/invoices` (seller).
  The seller's own invoices, newest first: `?cursor=...&limit=20`.
- `GET /api/seller/ledger` (seller).
  The seller's own ledger, newest first, with what EcoKart owes them now: `?cursor=...&limit=20`.
- `POST /api/seller/listing-drafts` (seller).
  Asks for listing details drawn from a product's photos: `{ "productId": "..." }`.
  Answers 202 while the worker writes the draft, and 200 with the draft when the same photos were drafted recently.
- `GET /api/seller/listing-drafts/[id]` (seller).
  One of the seller's listing drafts.
  Once `status` is `succeeded`, the seller copies what they want from `suggestion` into the product with PATCH /api/seller/products/{id}.
- `GET /api/seller/orders` (seller).
  The seller's orders in one tab, with only their own lines: `?tab=to_dispatch|dispatched|delivered|cancelled&cursor=...&limit=20`.
- `GET /api/seller/orders/[id]` (seller).
  One order with the seller's own lines and the delivery address.
- `POST /api/seller/orders/[id]/shipments` (seller).
  Dispatches some of the seller's lines in one parcel: `{ "lineIds": [...], "courierName": "Delhivery", "trackingNumber": "...", "trackingUrl"?: "https://..." }`.
- `GET /api/seller/products` (seller).
  The seller's own products, newest first: `?status=draft&cursor=...`.
- `POST /api/seller/products` (seller).
  Creates a draft listing with its variants.
- `DELETE /api/seller/products/[id]` (seller).
  Deletes a draft or rejected product.
- `GET /api/seller/products/[id]` (seller).
  One of the seller's products with its variants and photos.
- `PATCH /api/seller/products/[id]` (seller).
  Changes listing details of a draft or rejected product.
- `POST /api/seller/products/[id]/archive` (seller).
  Takes an approved listing off sale; it stays for past orders.
- `POST /api/seller/products/[id]/images` (seller).
  Adds an uploaded photo: `{ "uploadKey": "uploads/..." }`.
  Answers 202, because the worker checks the photo and makes its sizes afterwards.
- `DELETE /api/seller/products/[id]/images/[imageId]` (seller).
  Removes a photo from the product.
- `PATCH /api/seller/products/[id]/images/[imageId]` (seller).
  Changes a photo's alt text or the variant it shows.
- `PUT /api/seller/products/[id]/images/order` (seller).
  Puts the photos in order: `{ "imageIds": [...] }`, main photo first.
- `POST /api/seller/products/[id]/images/uploads` (seller).
  A signed form for uploading one photo straight to object storage: `{ "contentType": "image/jpeg", "size": 2400000 }`.
- `POST /api/seller/products/[id]/move-to-draft` (seller).
  Moves a listing back to draft so it can change: one waiting for review (the review is withdrawn), one on sale (it leaves the storefront until it is approved again), or one archived.
- `POST /api/seller/products/[id]/submit` (seller).
  Submits a draft or rejected listing for review; the worker screens it straight away.
  A listing that is not ready answers 400 with what to fix.
- `POST /api/seller/products/[id]/variants` (seller).
  Adds a variant to a draft or rejected product.
- `DELETE /api/seller/products/[id]/variants/[variantId]` (seller).
  Deletes a variant that no order or cart refers to.
- `PATCH /api/seller/products/[id]/variants/[variantId]` (seller).
  Changes a variant: price, MRP, stock, and active at any time.
- `DELETE /api/seller/products/[id]/video` (seller).
  Removes the product's video.
- `POST /api/seller/products/[id]/video` (seller).
  Adds the uploaded video: `{ "uploadKey": "uploads/..." }`.
  Answers 202, because the worker checks and converts the video afterwards.
- `POST /api/seller/products/[id]/video/uploads` (seller).
  A signed form for uploading the product's video straight to object storage: `{ "contentType": "video/mp4", "size": 24000000 }`.
- `GET /api/seller/profile` (seller).
  The signed-in seller's own business details.
- `PATCH /api/seller/profile` (seller).
  The seller changes their display name and support contacts.
- `GET /api/seller/returns` (seller).
  The returns of the seller's lines, newest first: `?status=requested|approved|rejected|refunded&cursor=...&limit=20`.
- `GET /api/seller/returns/[id]` (seller).
  One return of the seller's lines.
- `GET /api/seller/settlement-statements` (seller).
  The seller's settlement statements, newest first: `?cursor=...&limit=20`.
- `POST /api/seller/settlement-statements` (seller).
  Asks for a statement of the seller's ledger: `{ "from": "2026-10-01", "to": "2026-10-31" }`, India dates, both included.
  Answers 202, because the worker makes the file; follow it with GET /api/settlement-statements/{id}?as=seller.
- `POST /api/seller/shipments/[id]/delivered` (seller).
  Marks one of the seller's parcels delivered.

### Administrator portal

- `GET /api/admin/ai/usage` (administrator).
  AI calls, failures, tokens, and cost per India day and feature, with today's calls against the platform limit: `?from=2026-10-01&to=2026-10-11`.
- `GET /api/admin/brands` (administrator).
  Every brand A to Z, active or not: `?q=bamboo&cursor=...&limit=20`.
- `POST /api/admin/brands` (administrator).
  Creates a brand.
- `DELETE /api/admin/brands/[id]` (administrator).
  Deletes a brand that no product uses.
- `PATCH /api/admin/brands/[id]` (administrator).
  Changes a brand's name, slug, or whether it is active.
- `GET /api/admin/categories` (administrator).
  The whole category tree, including inactive categories.
- `POST /api/admin/categories` (administrator).
  Creates a category.
- `DELETE /api/admin/categories/[id]` (administrator).
  Deletes a category with no subcategories and no products.
- `PATCH /api/admin/categories/[id]` (administrator).
  Changes a category; a new `parentId` moves it with its subcategories.
- `GET /api/admin/content` (administrator).
  Every policy page, also those nobody has written yet.
- `GET /api/admin/content/[slug]` (administrator).
  One policy page as administrators see it.
- `PUT /api/admin/content/[slug]` (administrator).
  Saves a page: `{ "title": "Returns policy", "bodyMarkdown": "...", "status": "published" }`.
- `GET /api/admin/coupons` (administrator).
  Every coupon, newest first: `?cursor=...&limit=20`.
- `POST /api/admin/coupons` (administrator).
  Creates a coupon.
- `GET /api/admin/coupons/[id]` (administrator).
  One coupon.
- `PATCH /api/admin/coupons/[id]` (administrator).
  Changes a coupon; `{ "isActive": false }` switches it off.
- `GET /api/admin/emails` (administrator).
  Emails that failed or are stuck in the queue, newest first: `?state=failed|stuck&cursor=...&limit=20`.
  Without `state`, both.
- `POST /api/admin/emails/[id]/retry` (administrator).
  Puts a failed or stuck email back in the queue with fresh attempts.
- `POST /api/admin/invoices/[id]/render` (administrator).
  Has the invoice's PDF made again, for example after the template changed.
  Answers 202, because the worker makes it afterwards.
- `GET /api/admin/moderation` (administrator).
  Listings waiting for review, highest risk first, then oldest first: `?risk=high&cursor=...&limit=20`.
- `GET /api/admin/orders` (administrator).
  Every order, newest first: `?status=...`, `?needsRefund=true` for paid orders that were cancelled and still need their refund, or `?orderNumber=EK-261018-000123` for one order.
- `GET /api/admin/orders/[id]` (administrator).
  Everything about one order: lines, parcels, payments, events, invoices.
- `POST /api/admin/orders/[id]/cancel` (administrator).
  Cancels an order before dispatch on the buyer's behalf: `{ "reason": "The seller cannot supply it" }`.
- `POST /api/admin/orders/[id]/refund` (administrator).
  Records the refund of a paid order that was cancelled: the whole payment, `{ "method": "gateway", "amountPaise", "razorpayRefundId" }`.
- `GET /api/admin/products/[id]` (administrator).
  One product with its seller and its recent reviews.
- `POST /api/admin/products/[id]/approve` (administrator).
  Approves a listing waiting for review: `{}` for the category's GST rate, or `{ "gstRateBps": 500 }` to give another.
  The worker then embeds it for search.
- `POST /api/admin/products/[id]/reject` (administrator).
  Rejects a listing waiting for review: `{ "reason": "..." }`.
- `POST /api/admin/products/[id]/take-down` (administrator).
  Takes a listing that is on sale off the storefront: `{ "reason": "..." }`, which the seller sees.
- `GET /api/admin/queues` (administrator).
  Every background job queue with how many jobs wait, run, and failed.
  The counts can trail by about a minute.
- `GET /api/admin/queues/[name]/failed-jobs` (administrator).
  The queue's failed jobs, most recent failure first: `?cursor=...&limit=20`.
- `POST /api/admin/queues/[name]/failed-jobs/[id]/retry` (administrator).
  Gives a failed job one more attempt.
- `GET /api/admin/returns` (administrator).
  Returns in one status, `requested` by default: those waiting for a decision or a refund come oldest first.
  `?status=...&cursor=...&limit=20`.
- `GET /api/admin/returns/[id]` (administrator).
  One return, with the most its refund may be.
- `POST /api/admin/returns/[id]/approve` (administrator).
  Accepts a return: `{ "note"?: "..." }`, shown to the buyer and seller.
- `POST /api/admin/returns/[id]/refund` (administrator).
  Records the refund made for an approved return: `{ "method": "gateway", "amountPaise", "razorpayRefundId" }` or `{ "method": "bank_transfer", "amountPaise", "note": "<bank reference>" }`.
- `POST /api/admin/returns/[id]/reject` (administrator).
  Turns a return down, saying why: `{ "note": "..." }`.
- `GET /api/admin/reviews` (administrator).
  Reviews newest first: `?status=published|hidden&cursor=&limit=`.
- `PATCH /api/admin/reviews/[id]` (administrator).
  Hides a review or shows it again: `{ "status": "hidden" }`.
- `GET /api/admin/search/gaps` (administrator).
  The catalogue gap report: searches that found nothing, `?days=30`.
- `GET /api/admin/seller-balances` (administrator).
  Sellers whose balance is not zero, largest first, with the bank account a payout goes to: `?cursor=...&limit=20`.
- `GET /api/admin/seller-documents` (administrator).
  Seller documents waiting for review across every seller, oldest upload first: `?cursor=...&limit=20`.
- `GET /api/admin/seller-documents/[id]` (administrator).
  One document request with every file sent for it.
- `POST /api/admin/seller-documents/[id]/accept` (administrator).
  Accepts the file waiting for review.
- `POST /api/admin/seller-documents/[id]/cancel` (administrator).
  Withdraws a request that is no longer needed: `{ "reason": "..." }`, which the seller sees.
- `GET /api/admin/seller-documents/[id]/files/[fileId]` (administrator).
  Sends the browser to a five-minute signed link to one checked file, so a plain link downloads it.
  409 while the worker is still checking it.
- `POST /api/admin/seller-documents/[id]/reject` (administrator).
  Rejects the file waiting for review: `{ "reason": "..." }`, which the seller sees.
  The request goes back to the seller for a new upload.
- `GET /api/admin/sellers` (administrator).
  Sellers newest first: `?status=pending&cursor=...&limit=20`.
- `POST /api/admin/sellers` (administrator).
  Creates a seller business and its owner's sign-in account.
- `GET /api/admin/sellers/[id]` (administrator).
  One seller with its owner's account.
- `PATCH /api/admin/sellers/[id]` (administrator).
  Changes business details.
- `POST /api/admin/sellers/[id]/adjustments` (administrator).
  Corrects the seller's balance: `{ "amountPaise": -1000, "reason": "..." }`, positive to pay them more and negative to take money back.
  Answers 201 with the ledger entry and the seller's balance after it.
- `POST /api/admin/sellers/[id]/approve` (administrator).
  Approves a pending seller or seller application.
  The owner's account gets the seller role, keeping the buyer role of an applicant, and is emailed.
- `GET /api/admin/sellers/[id]/bank-account` (administrator).
  The seller's bank account for payouts, with only the last 4 digits of the account number; `null` before one is entered.
- `PUT /api/admin/sellers/[id]/bank-account` (administrator).
  Enters or replaces the seller's bank account: `{ "accountHolder": "...", "accountNumber": "...", "ifsc": "HDFC0001234" }`.
- `GET /api/admin/sellers/[id]/documents` (administrator).
  The seller's document requests with their history, newest first: `?show=open&cursor=...&limit=20`.
  Without `show`, every request.
- `POST /api/admin/sellers/[id]/documents` (administrator).
  Asks the seller for documents: `{ "documents": [{ "type": "gst_certificate", "note": "..." }] }`.
  Types: gst_certificate, pan_card, bank_proof, business_registration, address_proof, other.
- `GET /api/admin/sellers/[id]/ledger` (administrator).
  The seller's ledger, newest first, with their balance: `?cursor=...&limit=20`.
- `POST /api/admin/sellers/[id]/payouts` (administrator).
  Records a bank transfer made to the seller: `{ "amountPaise": 100000, "reference": "UTR..." }`.
  Answers 201 with the ledger entry and the seller's balance after it.
- `POST /api/admin/sellers/[id]/reinstate` (administrator).
  Reinstates a suspended seller.
- `POST /api/admin/sellers/[id]/reject` (administrator).
  Rejects a seller application waiting for review: `{ "reason": "..." }`.
  The applicant is emailed the reason and may apply again.
- `GET /api/admin/sellers/[id]/settlement-statements` (administrator).
  The seller's settlement statements, newest first: `?cursor=...&limit=20`.
- `POST /api/admin/sellers/[id]/settlement-statements` (administrator).
  Asks for a statement of the seller's ledger: `{ "from": "2026-10-01", "to": "2026-10-31" }`.
  Answers 202, because the worker makes the file; follow it with GET /api/settlement-statements/{id}.
- `POST /api/admin/sellers/[id]/suspend` (administrator).
  `{ "reason": "..." }`.
  An owner who only sells is also signed out everywhere; one who also buys keeps shopping.
- `GET /api/admin/settings` (administrator).
  Every platform setting with its value and where it comes from.
- `PUT /api/admin/settings/[key]` (administrator).
  Saves one platform setting: `{ "value": ... }`.
- `POST /api/admin/shipments/[id]/delivered` (administrator).
  Marks a parcel delivered for its seller, for example a suspended one.

### Called by outside services

- `POST /api/webhooks/razorpay` (anyone).
  Razorpay's webhook.
  Called by Razorpay only, never by a page.
  Verifies the signature first, and a replay answers 200 and changes nothing.

## 11. Where the data shapes are

Each answer's exact fields are TypeScript types in `packages/core`.
In client components, import them as types only, for example `import type { CartView } from '@ecokart/core'`, so no backend code reaches the browser.
In JSON answers, dates arrive as text such as `2026-11-19T05:55:00.000Z`; `formatIndianDate` accepts that text.

| Topic | Types | File |
| --- | --- | --- |
| Cart and coupons | `CartView`, `CartLine`, `CartCoupon`, `CouponView` | [`cart/types.ts`](../packages/core/src/modules/cart/types.ts) |
| Checkout | `PlacedOrder` | [`checkout/service.ts`](../packages/core/src/modules/checkout/service.ts) |
| Payment confirmation | `PaymentResult` | [`payments/service.ts`](../packages/core/src/modules/payments/service.ts) |
| Orders and parcels | `BuyerOrderView`, `BuyerOrderSummary`, `SellerOrderView`, `SellerOrderSummary`, `AdminOrderView`, `AdminOrderSummary`, `OrderLineView`, `ShipmentView`, `OrderEventView`, `PaymentView` | [`orders/types.ts`](../packages/core/src/modules/orders/types.ts) |
| Invoices | `InvoiceSummary` | [`invoices/types.ts`](../packages/core/src/modules/invoices/types.ts) |
| Addresses | `AddressView` | [`addresses/types.ts`](../packages/core/src/modules/addresses/types.ts) |
| Returns | `ReturnView`, `ReturnPhotoView`, `RETURN_REASONS` | [`returns/types.ts`](../packages/core/src/modules/returns/types.ts) |
| Seller money | `SellerLedger`, `LedgerEntryView`, `SellerBalance`, `BankAccountView`, `SettlementStatementView` | [`ledger/types.ts`](../packages/core/src/modules/ledger/types.ts) |
| Shop pages | `ProductCard`, `PublicProduct`, `CategoryPage`, `HomeSection` | [`catalogue/storefront-types.ts`](../packages/core/src/modules/catalogue/storefront-types.ts) |
| Seller products | `ProductView`, `VariantView`, `ImageView`, `VideoView`, `ListingSuggestion` | [`catalogue/types.ts`](../packages/core/src/modules/catalogue/types.ts) |
| Listing drafts | `ListingDraftView` | [`catalogue/drafts.ts`](../packages/core/src/modules/catalogue/drafts.ts) |
| Imports | `ImportView`, `ColumnSuggestion`, `IMPORT_FIELDS` | [`imports/types.ts`](../packages/core/src/modules/imports/types.ts) |
| Search | `SearchResult`, `SearchGap` | [`search/types.ts`](../packages/core/src/modules/search/types.ts) |
| Smart search | `NaturalSearchResult`, `UnderstoodQuery` | [`search/natural.ts`](../packages/core/src/modules/search/natural.ts) |
| Shopping assistant | `AssistantAnswer`, `ComparisonPoint` | [`assistant/types.ts`](../packages/core/src/modules/assistant/types.ts) |
| Reviews | `PublicReview`, `OwnReview`, `AdminReview` | [`reviews/types.ts`](../packages/core/src/modules/reviews/types.ts) |
| Policy pages | `PublicContentPage`, `ContentPageView`, `CONTENT_SLUGS` | [`content/types.ts`](../packages/core/src/modules/content/types.ts) |
| Sellers and documents | `SellerView`, `DocumentRequestView`, `DOCUMENT_TYPES` | [`sellers/types.ts`](../packages/core/src/modules/sellers/types.ts) |
| Platform settings | every setting with its rules | [`settings/definitions.ts`](../packages/core/src/modules/settings/definitions.ts) |

The buyer screens built on 19 November are good examples of reading these: `src/components/buyer/cart-manager.tsx`, `checkout-manager.tsx`, and `src/app/(storefront)/account/orders/[id]/page.tsx`.

## 12. Open decisions and missing inputs

These are not yours to decide; build around them and raise them with the project lead.

- **Policy text and company details.**
  The client must supply the approved text of the six policy pages and EcoKart's legal details; administrators enter them in the content editor and settings.
- **Real email and SMS.**
  Only Mailpit is connected, so sign-in codes reach nobody outside a developer's computer yet.
  This is backend and hosting work, but it blocks any test with real people.
- **Seller payouts.**
  Two decisions are open: whether part of a seller's balance waits until the return window has passed, and how an administrator sees a seller's full account number to make the transfer.
  Until they are decided, payout screens show the last 4 digits only and record transfers made outside EcoKart.
- **GST that depends on price** (for example clothing at 5% up to ₹2,500 a piece and 18% above) is not decided; the category screens show one rate per category.
- **Razorpay production account and webhook** come from the client before launch; test keys are enough for building.
- **AI keys** (OpenRouter) are needed only to see the AI screens with real answers; with AI off, the screens must still work.

## 13. Getting help

- How a flow should behave: [`docs/system-design.md`](system-design.md), section 6, then ask the project lead.
- How a route behaves exactly: its handler in `apps/web/src/app/api/` and the service it calls in `packages/core/src/modules/`.
- What was planned for a screen and how it will be accepted: the task files in `temp/frontend/step-2-marketplace-completion/`.
- A bug in an API: reproduce it through the real API first, write down the steps, and send them to the project lead; do not patch around it in the screen.
