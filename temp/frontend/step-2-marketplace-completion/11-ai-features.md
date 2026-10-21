# 11: AI listing assistance, search, assistant and reporting

| Field | Value |
| --- | --- |
| Status | Planned |
| Implemented | No |
| Depends on | 05, 06, 10 |
| Blocks | AI scope only; core shopping can release under an explicit scope decision |

## Read and integrate

Read design sections 3.2, 6.2, 6.7, 6.8, 6.9 and 8, AI client/service/queries, catalogue draft/screening services, import mapping, search meaning/photo/embedding services and assistant types.
The current checkout already has AI foundation, listing-draft APIs and usage reporting.
Newer backend includes natural/photo search, similar products, import mapping suggestions and `/api/assistant`.
These APIs are not proof of frontend completion or live provider readiness.
Use configured gateway/models through core; do not add provider SDK calls in React.

## Frontend delivery order

1. Add seller listing suggestion action to an editable product with ready photos.
2. Poll queued/running/ready/failed draft status; show a field-by-field preview and apply only explicitly selected fields through normal product edits.
3. Add suggested import mappings in the task 05 mapping screen with explicit confirmation before starting import.
4. Add optional natural-language search and photo upload/search to task 06 with clear fallback to keyword search.
5. Show similar products through the existing public endpoint when available, without blocking main product rendering.
6. Add a shopping assistant panel with plain-text answer, cited product cards, bounded history and comparison presentation from the typed DTO.
7. Add proposed `/admin/ai` usage/limits and `/admin/search-gaps` with current supported filters, aggregation and cursor contracts.

Display disabled, rate-limited, exhausted-budget, provider-unavailable and malformed-result states without breaking manual listing or keyword shopping.
Keep AI suggestions as drafts; never auto-publish, auto-change price/stock/GST or overwrite unsaved seller work.
Preserve unsaved form changes while a suggestion is being prepared.
For photo search, use existing signed upload and GET `/api/search/photo?photo=...` flow after checking the integrated handler.
Do not proxy original uploads through Next.js or expose private keys in browser code.
Render assistant answers as text and server-validated cards; never inject model HTML.
Respect the assistant's declined state and never present unsupported claims as product facts.
Reflect actual service execution mode; worker-backed drafts/imports use polling, while existing direct search/assistant handlers should not be replaced with an invented job API.

## Backend work

Integrate existing AI features; add code only for a proven contract gap or defect.
Preserve request logs, cache/input hashes, daily limits, request ownership and deterministic-first screening.
Use `startFakeAiServer` or the actual exported equivalent in `packages/core/src/testing/ai.ts` after checking its name and supported scenarios.
Do not spend production credits to obtain automated evidence.
Retain service tests for prompt/response validation, limits, cache and embedding visibility; browser tests validate how users recover.

## Automated acceptance

| ID | Scenario | Required result |
| --- | --- | --- |
| AI01 | Ready-photo suggestion accepted partially and dismissed | Only selected fields saved; original remains unchanged until save |
| AI02 | Failed/invalid JSON/provider timeout and disabled AI | Useful recovery; manual listing remains usable |
| AI03 | Suggested import mapping missing/ambiguous required columns | Seller confirms/corrects; import not silently started |
| AI04 | Natural/photo/similar search for private or unpublished catalogue | Only publicly eligible products; owned upload policy enforced |
| AI05 | Daily budget exhaustion and address rate limit | Correct retry/configuration message; no unbounded repeated requests |
| AI06 | Assistant answer, comparison, refusal and prompt-like product data | Plain text/cited products only; no script or invented product rendered |
| AI07 | Usage and gap reports as admin versus seller | Correct access and supported totals; no private prompts leaked |

Add proposed `e2e/ai-listing.spec.ts`, `ai-search.spec.ts`, `assistant.spec.ts` and reporting checks.
Start the real app/worker against a deterministic HTTP AI stand-in with logged scenario IDs.
Record the stand-in boundary explicitly; these tests do not establish real OpenRouter/model quality.
Run relevant AI/search/import/catalogue/assistant route and worker tests, lint/typecheck and browser suites.
Completion evidence is pending.
