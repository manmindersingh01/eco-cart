# Provider checks before launch

The project lead runs these checks in a test environment and keeps provider credentials in the environment's secret configuration.
Both checklists are awaiting provider access and execution.
Record the date, commit, provider mode, expected and observed result, and a redacted reference for each check.
Keep signatures, keys, payment details and private customer data out of evidence.

## Razorpay test mode

- [ ] Configure the test keys and webhook secret using [handover section 8](../../../docs/frontend-handover.md#8-payments-with-razorpay). Enable online payment in settings and confirm cash on delivery is still offered.
- [ ] Point the provider's test webhook at the reachable HTTPS payment webhook. Confirm delivery of the configured payment events.
- [ ] Buy a test product through the hosted checkout. Match the paid amount in paise to the order and check the buyer order, seller lines, stock change and invoice.
- [ ] Confirm the browser return and provider notification resolve to one payment. Redeliver the test notification and check that the order, stock and invoice stay consistent.
- [ ] Exercise a failed or abandoned payment and the supported retry or expiry path. Check the order status and stock after expiry.
- [ ] Refund an eligible paid test order in the provider dashboard, record its reference in EcoKart, and reconcile the amount and ledger entries.

## OpenRouter and catalogue embeddings

- [ ] Configure web and worker using [manual preparation](00-manual-preparation.md). Confirm provider credit, model access, platform limits and the configured 1024-dimensional embedding model.
- [ ] Process approved, in-stock products with photos. Wait for text and image embeddings before testing search and recommendations.
- [ ] Search by description and by photo. Open returned products, check similar products, and exercise keyword fallback when AI is unavailable.
- [ ] Ask the assistant a question with a known catalogue answer, compare two products and ask for a fact absent from the catalogue. Check citations, facts and the declined answer.
- [ ] Request a seller listing draft and import mapping suggestion. Apply selected suggestions and confirm existing manual edits survive.
- [ ] Check the administrator usage report for calls, failures, quota and provider-reported cost. Exercise the configured limit and unavailable-provider states on test data.
