# 10: Reviews, policy content and background-work operations

| Field | Value |
| --- | --- |
| Status | Planned |
| Implemented | No |
| Depends on | 08; 09 for refund support |
| Blocks | Complete support and content experience |

## Contracts to reuse

Read design sections 5.10, 5.13, 7 and 8, review/content services/types, admin background-work services and route handlers.
Existing review endpoints include public product reviews, own review and admin lists/status mutation.
Content endpoints support a fixed slug list: terms, privacy, shipping, returns, refunds and seller-agreement.
Newer backend supplies admin failed email and queue-job inspection/retry APIs.
Do not invent arbitrary content slugs or arbitrary queue names beyond those services permit.

## Frontend work

Add paginated published reviews to product detail with rating, author label and verified-purchase state supplied by the service.
Allow buyer creation/edit of their own review and show hidden state only where the own-review contract permits it.
Add proposed `/admin/reviews` with published/hidden filters, linked product and confirmation for moderation changes.
Do not infer verified purchase just because a user is signed in; upstream uses delivered order evidence.

Add proposed `/admin/content` and a fixed-slug editor with Markdown source, safe preview, draft/published status and save feedback.
Add proposed `/policies/[slug]` and real footer links plus public company details through existing cached wrappers.
Choose a compatible maintained Markdown renderer during implementation; declare it in the catalog if a dependency is needed.
Disable raw HTML and unsafe URL schemes, then test script-like input and link handling.
Client-approved legal text is an input still required; do not invent legally approved copy or count placeholder policies as launch-ready.

Add proposed `/admin/background-work` with queue summaries, failed-job lists and email failures from the existing admin APIs.
Expose only fields safe for administrators; redact tokens, payload secrets and private document links.
Retry only supported jobs/emails with confirmation and refresh; explain when a retry is refused or already running.
Do not implement job replay by manually recreating business transactions in the frontend.

## Backend work

Reuse review rating refresh, content publishing/invalidation and existing retry safeguards.
Verify every admin mutation is audited and repeated retry actions do not cause duplicated business effects.
Fix any unsafe response-field exposure at the service/API boundary before rendering it.

## Automated acceptance

| ID | Scenario | Required result |
| --- | --- | --- |
| C10 | Own review create/edit, duplicate and other user's mutation | One owned review; rating aggregates match published records |
| C11 | Hide/show review with warmed public cache | Visibility and rating refresh; own-review state remains coherent |
| C12 | Draft/publish/update/unpublish allowed policy slug | Public state and cache match; invalid slug refused |
| C13 | Markdown contains scripts, HTML, unsafe links and valid formatting | No executable content; safe accessible rendering |
| C14 | Non-admin opens background-work URLs or retry endpoint | Access refused before private data renders |
| C15 | Failed job/email retry, double-click, stale state and worker completion | One permitted retry; clear current state and audit trail |

Add proposed `e2e/reviews-content.spec.ts` and `background-work.spec.ts`.
Run existing review/content/admin route tests, targeted worker tests, lint/typecheck and browser suites.
Manual checks are limited to approval of legal/business wording and a short assistive-technology release pass.
Completion evidence is pending.
