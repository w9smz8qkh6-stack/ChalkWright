# ADR-0011: Google Classroom client, credential model, and scopes

- **Status:** Accepted
- **Date:** 2026-08-09

## Context

Classroom Hub needs published Google Classroom coursework as optional,
meeting-date-relative enrichment. The provider read must stay outside the TV
request path and must not create a general Google command surface. Calendar
reconciliation is a later, separately authorized writer and cannot share this
capability merely for convenience.

The Classroom API can list published coursework for configured course IDs
without listing courses, rosters, students, submissions, or grades. Explicit
course-to-class mapping avoids discovery and roster scopes. Google does not
offer a teacher grant limited only to the `courseWork.list` response: the
narrowest applicable teacher read scope is documented as permitting access to
student coursework and grades, so the protected token has broader read
authority than the one-method application wrapper exercises.

## Decision

Use an operator-provisioned installed-application user OAuth grant behind the
official, exact-version-pinned `@googleapis/classroom` 14.0.0 client. Classroom
Hub receives only a protected reference outside the repository and SQLite. It
does not implement the consent flow, retrieve credentials from 1Password, or
store OAuth material in application state.

The grant must contain exactly:

`https://www.googleapis.com/auth/classroom.student-submissions.students.readonly`

The application adapter exposes only `courses.courseWork.list`, fixed to
configured numeric course IDs and `PUBLISHED` coursework. Google documents the
`students.readonly` variant for teachers and domain administrators. Google's
OAuth server maps the method documentation's equivalent
`classroom.coursework.students.readonly` spelling to the exact canonical scope
above; the live consent gate confirmed that mapping. The earlier `me.readonly`
choice was likewise mapped to a student-only scope and was inappropriate for
this teacher account. The selected grant's documented authority includes
student coursework and grades. The adapter does not call student-submission
endpoints or request submission or grade fields. It
uses a fixed field mask, bounded pagination/items/time/concurrency, and no
automatic retries. It does not call `courses.list`, so
`classroom.courses.readonly` is not granted. No roster, Drive, Gmail, Calendar,
or other Google scope or method is part of this decision. The broader read
authority inherent in the selected Classroom scope is contained by the
owner-only reference, exact-shape validation, and one-method wrapper; it is not
misrepresented as narrower token authority.

Course mappings are explicit one-to-one configuration. The credential
reference must be a normalized absolute file outside the repository, owned by
the running user, regular, single-link, non-symlink, and inaccessible to group
or other users. Its JSON shape contains only the installed-app client ID,
client secret, refresh token, and exact sole scope; unknown fields fail closed.
The live token exchange proved that this Google client requires its generated
secret even though installed applications cannot keep such a value
confidential. The one-time Cloud Console intermediate is deleted after the
owner-only reference is written. Provider responses are normalized
immediately, and only bounded provider-neutral enrichment enters the local
cache.

Calendar authorization remains a separate future ADR/gate and must not reuse
or widen this Classroom grant without a superseding decision.

## Alternatives considered

- A service account with domain-wide delegation was rejected for this
  checkpoint because it grants materially broader administrative authority and
  requires organization-policy decisions not needed for configured-course
  coursework reads.
- One credential with combined Classroom and Calendar scopes was rejected
  because a read adapter would then hold writer authority.
- A general Google CLI/command runner was rejected because it exposes a wider
  operation and argument surface than the one generated read method.
- `classroom.courses.readonly` plus course discovery was rejected because
  mappings are already an explicit application contract.

## Consequences

The narrow grant sharply limits blast radius and makes a static method/scope
audit meaningful. An operator must provision and later repair the OAuth grant
outside Classroom Hub, and configured numeric course IDs must be maintained.
Revocation, consent-policy changes, and account lifecycle can stop enrichment;
the application preserves last-known-good normalized cache data and reports a
sanitized repair-required or failed result.

The original acceptance authorized the offline M-08 implementation model. The
user later separately authorized the dedicated client, canonical teacher-read
scope, consent, protected reference, and bounded live read gate. That later
authorization did not include scheduler activation, Calendar access, or any
provider mutation.

## Qualification outcome

The protected reference passed the required metadata and exact-shape checks.
The one-shot live audit exercised only `courses.courseWork.list` across eight
legacy-derived mappings: seven observations succeeded and one unavailable
mapping failed in isolation. No provider data was persisted, mutation counts
remained zero, and no Calendar capability was constructed. Temporary client
download and provisioning/live-run scripts were permanently removed.

## Reversibility

The provider is behind a one-method transport and provider-neutral observation
port. A future credential model can replace the official-client factory without
changing canonical coursework or cache contracts. Removing the credential
reference disables refresh while preserving prior valid normalized cache data.

## Verification implications

- Verify locked library behavior against its generated TypeScript declaration
  and official Classroom API documentation.
- Audit the repository for exactly one Classroom scope and one generated API
  read method, with no request body or write method.
- Test exact protected-reference ownership, permissions, symlink/hard-link,
  shape, and scope rejection without logging values.
- Prove bounded pagination, timeout, mapping isolation, partial failure,
  backoff, stale-cache semantics, and zero external mutation counts using only
  synthetic fixtures.
- Keep the asynchronous refresh job wrapper unregistered until an operational
  milestone explicitly activates it. Display code must read only the local
  normalized cache.
- Any later live run must retain only sanitized method/scope/outcome evidence,
  confirm zero Classroom mutations, and leave Calendar unavailable.
