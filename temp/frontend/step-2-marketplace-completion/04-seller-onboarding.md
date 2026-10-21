# 04: Seller applications, tax details and verification documents

| Field | Value |
| --- | --- |
| Status | complete |
| Implemented | Yes |
| Verified on | 21 October 2026, Asia/Kolkata |
| Depends on | 02 |
| Blocks | Full seller onboarding journey |

## Read and reuse

Read design sections 5.4, 6.1 and 8, the integrated seller application types/service, document services/jobs and existing profile/admin seller components.
Existing newer APIs include `/api/account/seller-application`, admin seller rejection, seller document lists/detail/upload/register and administrator document request/review/download actions.
Use their actual methods and DTOs after task 02.
Do not replace administrator-created seller onboarding.

## Backend work

Integrate existing application/document contracts and fix only defects demonstrated by task 03 verification.
Keep the confirmed administrator-requested workflow and inclusive 10 MB limit, with existing business-field permissions.
Preserve tax identifier cross-checks, one owned business per account, permissions, audit entries and approval prerequisites.
Keep applicant document access narrower than approved seller access.
Do not permit setting commission, roles, verification status or owner identifiers from applicant input.

## Frontend work in order

1. Add proposed `/account/seller-application` with first application, editable pending details, review status, rejection reason and supported correction/resubmission flow.
2. Expose PAN/GSTIN and other allowed business fields using the current application schema, with plain optional/required labels and state validation.
3. Add proposed `/seller/documents` or an applicant-safe account document screen, using the existing request lists and upload flow.
4. Show upload actions only for document requests and states permitted by the existing service, with PDF/JPEG/PNG guidance and the inclusive 10 MB limit.
5. Extend `/admin/sellers/[id]` with application details, document requests, approval blockers and rejection reasons.
6. Add proposed `/admin/seller-documents` queue and detail/review UI with signed private downloads, accept, reject and cancel confirmations.
7. On approval, refresh session/account capabilities and expose the seller portal without forcing a duplicate account.

Upload browser-to-storage, then register the upload key, then poll the request/file state with a bounded retry strategy.
Show processing, received, failed, rejected, accepted and cancelled states using current DTOs.
Do not show a permanent URL to a private file or place PAN/document contents in public markup, logs or screenshots.
Handle expired signed forms by requesting a new form instead of retrying stale fields indefinitely.
Keep field input after a recoverable 400/409 and explain approval blocks from server results.

## Automated acceptance

| ID | Journey | Expected result |
| --- | --- | --- |
| S01 | Buyer applies with valid details and optional tax identifiers | Pending application persists after refresh; no seller catalogue privilege yet |
| S02 | Duplicate application or invalid PAN/GSTIN/state | Useful validation/conflict; original details preserved |
| S03 | Administrator requests document; applicant uploads valid PDF and image | Real storage/worker processing reaches reviewable state |
| S04 | Oversized/unsupported/forged upload | Client guidance plus server refusal on browser bypass |
| S05 | Administrator rejects document, seller replaces, administrator accepts | Reasons and history shown; only valid current state enables approval |
| S06 | Administrator request remains open, then is accepted or cancelled | Approval blocker follows the existing service; seller cannot create or accept a request; upload limit stays 10 MB |
| S07 | Approval, rejection and suspension for combined account | Capabilities/navigation refresh; buying permissions preserved as designed |
| S08 | Different seller opens private file or document URL | No data or signed download returned |

The related journeys share `e2e/seller-onboarding.spec.ts`, with real OTP sessions, separate browser contexts for each account and isolated resources.
Extend seller route/domain tests only for uncovered contract cases.
Run lint, typecheck, relevant tests and proposed `pnpm test:e2e -- --grep 'S0'` after verifying the launcher forwards arguments.
Use stable case IDs in test titles.

## Manual remainder and evidence

After automated browser/a11y checks, confirm the UI clearly identifies administrator-requested documents and the existing 10 MB limit.
Perform one real Safari upload on Apple hardware at release; record file type/size and status without uploading personal identity documents.
See [the shared implementation evidence](evidence/2026-10-20-onboarding.md) for implemented paths, API contracts, automated case mapping, actual results and exact remaining manual steps.
The account application, seller document screen, administrator request/rejection controls and document queue/detail pages are implemented.
Existing administrator-created seller onboarding remains available.
Forms preserve recoverable input, refresh authoritative state on conflicts, and accept interaction only after client handlers are ready.
Downloads use protected relative routes that obtain a fresh signed link; private storage URLs are not persisted in the UI.
