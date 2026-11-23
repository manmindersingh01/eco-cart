# Manual preparation and later provider checks

## Before any implementation session

- Have Docker Desktop running, pnpm 12 available, and ffmpeg plus ffprobe on PATH.
  Let pnpm obtain the Node version defined by the repository.
- Create apps/web/.env, apps/worker/.env and packages/core/.env from their corresponding .env.example files only if missing.
  Preserve existing values and never commit secrets or paste them into task evidence.
- Ensure the web and worker MESSAGE_ENCRYPTION_KEY values match.
  Database passwords in packages/core/.env must match the appropriate web and worker DATABASE_URL values.
- Run pnpm install, pnpm db:up, pnpm db:migrate and pnpm db:seed in that order when preparing the local environment.
  These are execution prerequisites, not commands run by this documentation pass.
- Create an administrator if needed with pnpm admin:create --email <email> --name <name>.
  Run pnpm dev and read local sign-in codes in Mailpit at http://localhost:8025.
- Use the local seeded sellers and a buyer account with suitable products/orders for each journey.
  Keep fixture creation out of production.
- Install required Playwright browsers when needed with pnpm --filter @ecokart/web exec playwright install chromium firefox webkit.
  Use Chrome at large, medium and mobile sizes for focused UI checks, as agreed on 24 November 2026.
  Real Safari/iPhone checks are optional and do not block task completion.

## What can proceed without keys

All frontend implementation can proceed with local services and supported stand-ins.
Leave AI_ENABLED=false until real AI testing is needed.
Blank Razorpay credentials leave cash on delivery enabled.
Existing automated payment tests use startFakeRazorpay; use the isolated demo and existing tests for local payment evidence.
Do not point automated tests at a real payment account.
Do not invent successful AI responses as evidence of provider readiness.
AI success-path testing may use controlled test fixtures, while disabled and error behaviour must also be exercised.

## Razorpay: your later manual test setup

The variables already exist in apps/web/.env.example.
Supply values in apps/web/.env for your later provider test:

| Variable | Meaning |
| --- | --- |
| RAZORPAY_KEY_ID | Test-mode account key ID |
| RAZORPAY_KEY_SECRET | Secret paired with that key |
| RAZORPAY_WEBHOOK_SECRET | Separate secret matching the configured webhook |
| RAZORPAY_API_URL | Stand-in URL only for fake-provider runs; blank for a real provider test |

Set all three credentials together, never partially.
Do not add NEXT_PUBLIC secrets or put secret values in frontend code.
Only the public key ID returned by checkout belongs in the browser.

AGENTS.md requires fake Razorpay for local runs, whereas handover section 8 describes real test-mode keys locally.
Keep implementation and automated local runs on the fake provider.
Your later manual provider test is separate, as requested; explicitly settle its environment before running it rather than silently changing the repository rule.
Use test mode, not live keys.

For the later webhook test, prepare a reachable HTTPS address ending in /api/webhooks/razorpay and configure the handover's payment.captured, order.paid and payment.failed events with the same webhook secret.
A provider cannot call localhost directly; a local manual webhook test needs an approved tunnel or a reachable test deployment.
Restart the app after environment changes.
Verify successful payment, closing checkout and Pay now, failed payment, expiry, and browser/webhook duplicate confirmation.
Verify refunds are made externally and only recorded in EcoKart.
Record test references without keys or personal payment data.
Do not mark these provider checks passed before they are actually run.

## AI: your later manual test setup

Apply the AI settings to both apps/web/.env and apps/worker/.env.
Use the configured model names from the checked-in examples, and confirm availability with your provider account before the live test.
Do not change the embedding dimension or model casually; a model change can require rebuilding catalogue embeddings.

| Variable | Action |
| --- | --- |
| AI_ENABLED | Set true for real provider testing; false for ordinary disabled-mode checks |
| AI_BASE_URL | Keep the configured OpenRouter gateway unless a separate decision changes it |
| AI_API_KEY | Supply the appropriate account key privately |
| AI_CHAT_MODEL, AI_VISION_MODEL | Retain the configured model names initially |
| AI_EMBED_MODEL | Retain the configured multimodal embedding model initially |
| AI_EMBED_DIMENSIONS | Keep 1024 to match the schema |
| AI_EMBED_BASE_URL, AI_EMBED_API_KEY | Leave blank unless using a separately configured embedding provider; set together |

Ensure the provider account has access and credit, platform AI limits are configured, and the worker is running.
Restart web and worker after changes.
Use approved products with processed photos and completed embeddings for meaningful search tests.
Verify natural search and keyword fallback, photo search, similar products, assistant citations/declines, seller drafts, import suggestions and usage reporting.
Also test disabled, rate-limited, exhausted-budget and unavailable-provider states.
Do not put the AI key in the browser or call providers directly from components.

## Before external users or release

- Supply approved company/legal details and all six policy texts; seeded placeholder text is not launch content.
- Arrange working email/SMS delivery; Mailpit only serves local testing.
- Resolve payout access/holdback decisions and the price-dependent GST question with the project lead.
- Supply production infrastructure and provider credentials through the production secrets mechanism.
  This frontend task series does not deploy infrastructure.
- Review the remaining checks in task 31 and record who will run deferred provider checks.
