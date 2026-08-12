# ADR-0016: Calendar read identity and ownership classification

- **Status:** Accepted
- **Date:** 2026-08-10
- **Decision scope:** M-13 read-only audit and dry-run ownership evidence

## Context

M-13 must compare desired Calendar events with existing events without giving the
application a writer. The legacy integration used Calendar as a projection and
recognized some events through semantic fields, but title or description alone
cannot safely establish ownership. Classroom Hub's accepted architecture also
requires Calendar and Classroom credentials to remain separate.

Google documents `calendar.events.owned.readonly` as the narrow read scope for
events owned by the authenticated user. That provider meaning is not equivalent
to application ownership: an event may be user-owned but unrelated to Classroom
Hub. Strong application markers and an explicit adoption decision are still
required before any later mutation can be eligible.

## Decision

M-13 is designed for a separate operator-provisioned installed-application user
OAuth grant behind exact `@googleapis/calendar` 16.0.0. The protected reference
is outside the repository and SQLite and declares exactly one intended scope:

`https://www.googleapis.com/auth/calendar.events.owned.readonly`

The application exposes only bounded `events.list` for one exact configured
calendar and finite time window. It requests timed non-cancelled events and the
minimum semantic and private-property fields needed by the ownership audit.
Automatic retries and provider response persistence are absent.

The reference's scope field is policy metadata, not proof of the refresh
token's actual provider grant. Before the direct adapter is live-qualified, the
consent result or access-token metadata must independently prove that the token
has exactly the intended read scope. Until then, exact provider authority is an
open live gate. The one-method wrapper contains application behavior even if a
misprovisioned token is broader, but it does not make broader token authority
least-privilege.

Classroom Hub owns an event only when all three private properties match:

- `classroomHubOwner=classroom-hub`;
- `classroomHubScope=<configured scope ID>`; and
- `classroomHubOwnershipMarker=classroom-hub-v1`.

Desired projection semantics are fixed by the named
`powerschool-block-label-and-normalized-description-v1` policy: the normalized
plan block label is the summary and the description is exactly `Imported from
PowerSchool Bell Schedule.`. Projection labels must be bounded, trimmed,
single-line NFC text. The audit window must be the exact local calendar day of
the verified plan in the plan's own timezone; caller-selected summary,
description, or timezone inputs are not admitted.

An unmarked exact semantic match is a legacy-adoption candidate, not an owned
event. The historical description variant is also adoptable only when the
summary, interval, and timezone match exactly and the description has the
narrow `Imported from PowerSchool Bell Schedule (<bounded label>).` form. An
approved historical variant remains a proposed description-replacement intent,
not a no-op. Adoption requires an explicit manifest entry binding the exact
provider event reference, SHA-256 fingerprint of the compared semantic fields,
scope ID, and ownership marker. Partial markers, recurring instances, stale
approvals, malformed provider entries, unsupported all-day entries, or
overlapping ambiguous events block the whole dry-run intent set. Unrelated
events remain untouched. Evidence contains only counts, stable blocker codes,
and hashes.

The M-13 planner and lease rehearsal emit inert values only. No Calendar writer,
request body, command runner, operational registration, or provider mutation
capability exists. M-14's writer identity, exact owned-write scope,
non-production calendar, and credential remain a separate decision and gate.
This ADR does not authorize or design production Calendar writes.

## Alternatives considered

- Reuse the Classroom grant: rejected because it would combine unrelated
  authority and contradict ADR-0011.
- Reuse a general Google command wrapper as the production adapter: rejected
  because it exposes a broader command surface than one generated read method.
- Treat exact title/description matches as owned: rejected because semantic
  collision could authorize mutation of an unrelated event.
- Accept caller-provided projection text or a partial read window: rejected
  because it could make observed Calendar text circularly define adoption or
  omit obsolete events from the audit.
- Request a Calendar writer scope during M-13: rejected because a read-only
  audit does not need it and the roadmap separately gates M-14.
- Treat every user-owned event as application-owned: rejected because Google
  account ownership is not Classroom Hub ownership.

## Consequences

M-13 can prove the read, classification, no-op, ambiguity, and dry-run contracts
without constructing any write method. Existing unmarked events may require a small
explicit adoption manifest before the audit can be clean. Revocation or scope
drift produces a sanitized repair-required or authorization failure and zero
eligible intents.

The separate grant may require one consent action if no exact read-only grant
already exists. Existing protected credentials are not inspected or copied to
avoid that action. A legacy read-only wrapper may be used only as separately
authorized observation evidence; it does not become the application adapter or
prove the direct grant.

## Reversibility

Removing the Calendar reference disables the audit without affecting plans,
display, Classroom enrichment, or provider state. The adapter is behind one
transport method, so a later credential mechanism can replace its factory
without changing the ownership model.

## Verification implications

- Verify the exact dependency and intended scope against Google's official
  Calendar documentation and generated client types; separately verify the
  actual provider grant before direct live qualification.
- Prove that only `events.list` is reachable and that request bodies, mutation
  methods, notifications, commands, and operational registration are absent.
- Reject unsafe references, scope drift, unknown credential fields, symlinks,
  hard links, broad windows, pagination loops, excess items, and hostile
  provider shapes.
- Prove verified ownership, exact no-op, explicit adoption, unrelated-event
  isolation, ambiguity quarantine, authentication failure, and pure lease
  conflict behavior with synthetic tests.
- Retain only redacted count/fingerprint evidence from any authorized live
  audit and require explicit dispositions before M-13 promotion.
