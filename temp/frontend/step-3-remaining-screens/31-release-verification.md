# 31: Local release verification and provider handover

Status: planned.
Depends on: 01-30.

## Read first

Read [the shared completion rules](README.md#completion-rules), root AGENTS.md and [handover section 6 and 12](../../../docs/frontend-handover.md).
Read the matching flow in docs/system-design.md and the existing route handler, service and types before changing a screen.
Verify payloads against the code instead of copying an old plan.

## One-session scope

Run the existing full checks and complete real buyer/seller/admin journeys locally. Collect browser evidence and a separate checklist for the user's later Razorpay and AI provider tests.

## Acceptance

Record exact commands, exit codes and failures; payment, stock and permission regressions block completion; deferred provider checks remain explicitly unverified.
Also meet the shared loading, error, permission, accessibility and browser checks.
Do not add backend behaviour to fill a missing contract; stop and report it.

## Manual prerequisites

Use [the preparation checklist](00-manual-preparation.md).
Provider credentials are not required to implement this task with local services and stand-ins.
For AI tasks, real provider success remains unverified until credentials and catalogue embeddings are ready.

## Evidence to record

Record the commit, changed routes, commands and exit codes, observed acceptance results, browser sizes, and any deferred checks.
Use planned, in_progress, implemented_pending_verification, blocked or complete honestly.
Do not mark complete while required checks are missing.
