# Implementation and verification evidence template

Copy these sections into a task when execution starts.
Keep one sentence per line and record observed results rather than intended outcomes.
Do not mark a future test passed or copy another commit's results without identifying that historical boundary.

## Task state

| Field | Value |
| --- | --- |
| Task ID | Fill in |
| Status | planned / in_progress / blocked / implemented_pending_verification / complete |
| Implemented | No until acceptance and required checks pass |
| Dependencies satisfied | IDs and reviewed commits |
| Branch/base/candidate | Fill in exact commit hashes |
| Verified on | Date and timezone |
| Decisions | Decision IDs, owner confirmation and updated design path |

## Implementation evidence

| Requirement/case | Changed file or commit | Behaviour delivered | Remaining work |
| --- | --- | --- | --- |
| Fill in | Fill in | Concrete user-visible or server effect | None or explicit item |

## Automated evidence

| Case IDs | Exact command | Environment and commit | Exit code and observed result | Proof artifact |
| --- | --- | --- | --- | --- |
| Fill in | Runnable command | Test DB/bucket names without credentials; engine/provider mode | Actual file/test counts; failures/skips | CI URL or repository-relative redacted log/report |

If testing ran, this table is mandatory.
For browser results include browser engine/version, OS, viewport and actual service/worker versus mocked boundary.
For provider tests distinguish real HTTP stand-in, browser-only interception, sandbox provider and live provider.
For a financial assertion include the test that checks persisted stock, payment, invoice or ledger effects.
Do not commit cookies, OTPs, signed download URLs, real identity documents, personal addresses or full account numbers.
Store sensitive/large traces in controlled CI artifacts and commit only a redacted summary/link where appropriate.

## Manual evidence or exact pending steps

| Check | Role and route | Browser/platform/viewport | Steps and observed result | Status/owner |
| --- | --- | --- | --- | --- |
| Fill in only if needed | Fill in | Actual Safari is distinct from Playwright WebKit | Exact reproduction; no vague works statement | Pending or passed with date |

## Deviations and handover

List unmet criteria, unexpected failures, explicit scope decisions, migrations/configuration needed and impact on dependent tasks.
Name the next task and the exact prerequisite it can now rely on.
If blocked, state the specific decision or external input; do not block unrelated work.
