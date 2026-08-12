# ADR-0012: Alert delivery transport

- **Status:** Accepted
- **Date:** 2026-08-08

## Context

Legacy operations distinguish issue reporting from optional notification and
support new/repeat/recovery semantics. The steady-state delivery channel,
recipient ownership, escalation policy, and credential model are unresolved.

## Decision

Keep alert decision logic transport-neutral. Preserve the established behavior
as the leading production choice: a direct Telegram adapter consumes only
redacted alert decisions, evaluates every 30 minutes, sends new, six-hour
repeat, and recovery notifications, and owns delivery independently of the
scheduler. The bot credential and destination must be separate owner-only
protected references outside Git, SQLite, environment files, arguments, logs,
and evidence; this record intentionally does not retain their values.

A no-send/report-only transport remains mandatory for development, shadowing,
preflight, and degraded delivery. Failed delivery must retain the prior
successful checkpoint and retry without marking the notification sent. The
same restart-safe decision fingerprint prevents duplicates after restart.

The user accepted this transport policy on 2026-08-10. At acceptance, the
protected destination and bot credential remained deliberately uninspected and
required separately authorized value-free setup before any live delivery;
acceptance itself authorized no external transport, credential use, message, or
live setup. A later exact M-16 authorization provisioned the two values without
disclosure and delivered one fixed non-operational qualification message. That
one-shot result does not authorize routine wiring or delivery.

## Offline implementation disposition

The direct adapter is offline-qualified but deliberately unwired. One
owner-only exact-shape reference names two distinct owner-only external value
files; construction fails before either value is read if that reference is
linked, permissive, repository-contained, augmented, or coupled. The fixed
adapter can call only `POST https://api.telegram.org/bot…/sendMessage`, emits
plain text containing only the decision kind, issue counts, and evaluated
instant, protects message forwarding, permits no redirect or automatic retry,
caps the response at 16 KiB, and maps provider/auth/rate-limit/timeout/abort
outcomes to finite codes. Request and response buffers are overwritten after
the attempt.

Synthetic tests use temporary values and an injected executor; no network
request, protected production value, destination, message, service, or timer
was used. The production job, server, and every systemd artifact are statically
proved unable to import this authority. The exact runtime contract is Node
24.15.0's stable `node:https` request API; the provider contract is Telegram's
official `sendMessage` Bot API.

- [Node 24.15.0 HTTPS API](https://nodejs.org/download/release/v24.15.0/docs/api/https.html)
- [Telegram Bot API `sendMessage`](https://core.telegram.org/bots/api#sendmessage)

## Alternatives

- Preserve the legacy Telegram channel through a direct provider adapter.
- Email delivery.
- A generic webhook to an approved receiver.
- Local journal/report only for MVP.

## Consequences to compare

External delivery adds credentials, network failure, recipient privacy, rate
limits, and operational ownership. Local-only reporting reduces complexity but
may not provide timely recovery awareness.

## Reversibility

High because transport consumes redacted alert decisions. State fingerprints
and recovery semantics remain stable across transports.

## Verification implications

Fake-transport tests must cover new, unchanged, exact six-hour repeat,
recovery, send failure, checkpoint failure, concurrency, and no-send modes
before selection. A live transport requires separately authorized
non-sensitive delivery tests, protected-reference review, redaction review,
rate-limit handling, and canonical documentation for its locked client/API
version.
