# M-17 review package: isolated parallel production canary

## Status

The M-17 parallel canary is active but unpromoted in the isolated
`codex/m17-parallel-canary` review lane. The legacy application remains
authoritative, the candidate uses its separate Tailnet route and `Auto Lesson
2`, and final handoff remains unauthorized.

The subsequently authorized first live-preflight stage completed on 2026-08-12:

- protected provisioning created eight isolated canary files and reported zero
  provider requests, unit starts, or route changes;
- the independently audited release
  `sha256:8dd31c682f71af124ca20ef5836d47328fb1baddc7d17089a9bebc2fba0cff3a`
  installed sixteen inert units and started none; and
- the privilege-dropped, release-bound state copier retained eleven validated
  PowerSchool cookies, zero origin storage, zero browser profiles, zero Google
  origins, and made zero provider requests.

No browser or sign-in was used in that first stage. Activation, routing, and
Fully Kiosk changes remained separately gated.

The first plan preflight then proved that the cookie-only copy was insufficient:
PowerSchool redirected the fresh browser context to authentication. A bounded
read-only characterization of installed OpenClaw 2026.6.11 found one local
storage entry on the exact active PowerSchool-origin tab. The recovery bridge
therefore now admits only the exact JSON cookie envelope plus one fixed browser
evaluation that returns the document origin and bounded local storage
atomically. Both the returned origin and response URL must equal the configured
PowerSchool origin before the existing ADR-0014 filter runs. It still rejects
session storage, foreign origins, profiles, and Google state.

The authorized 2026-08-13 live-preflight continuation then established the
bounded renewal sequence without another login: the legacy app's own
session-HTTP read also returned repair-required, while its existing persistent
browser performed a passive three-period read and silently renewed the session.
The strict bridge immediately re-exported eleven PowerSchool cookies and one
exact-origin storage record. The fresh canary plan preflight then succeeded and
stored a verified three-meeting plan. The isolated active-Classroom preflight
also succeeded. The `Auto Lesson 2` read-only Calendar preflight observed zero
events, proposed exactly three create intents, and attempted and completed zero
mutations.

A ten-minute provider-inaccessible loopback reader then supplied only normalized
candidate semantics and stopped cleanly. The initial evidence builder used only
the legacy section-code field and correctly reported three label differences;
the established UI semantic is the legacy course-name-plus-section-code
composite, which exactly matches Chalkwright's normalized label. The corrected
ID-free comparison matched all three dates, intervals, summaries, readiness,
display state, ownership qualification, and plan verification with zero
differences. The immutable evidence fingerprint is
`sha256:77071f2349eaf2a95ba25bdf1ee7236caa1251210cfdb666de01a49a70ba69af`.
The comparison's candidate Calendar semantics are the three planned
reconciliation intents derived from the verified plan; they are not a claim
that those events already exist in Google Calendar. The separate read-only
provider preflight observed zero existing events in `Auto Lesson 2` and made
zero mutations.
This is preactivation evidence only; no candidate service, timer, route, Calendar
mutation, Fully Kiosk change, M-17 activation, or promotion followed.

The first protected activation manifest was subsequently bound with fingerprint
`sha256:2fda6668afbd28b2b3ee843e5ed42438cab30dacfdb496eb4c37e8ab74e925b2`.
Independent review then found that its seven-day observation window began before
candidate activation. That manifest is therefore rejected for activation and
must be superseded through the protected, recoverable bind procedure immediately
before a separately authorized activation. No service, timer, route, provider
mutation, or kiosk change occurred under it, and its inactive elapsed time does
not count as canary coverage. Supersession and activation are serialized
operator actions; no activation, manifest operation, or candidate-route command
may run concurrently with the bounded precondition checks and atomic archive.

That rejected manifest was archived successfully with zero provider, service,
or route changes, and a fresh exact seven-day manifest was bound with
fingerprint
`sha256:e84fdcc9a9ba7155d5b6382a3f191eae4f3f94f490228af418db52280e332a65`.
The first activation attempt then passed manifest, plan, Classroom, integrity,
backup, server-health, and readiness gates but failed closed before Calendar
mutation with `calendar-write-input-invalid`. Rollback stopped the candidate
server and left all five timers and the candidate route inactive; the retained
evidence reported zero attempted and completed external mutations. Offline
diagnosis found that real deterministic Calendar intent IDs compose the plan,
scope, and meeting identities and can safely exceed the writer and SQLite
journal's generic 128-character bound. The corrected contract permits only
safe IDs of at most 512 characters in approvals, intents, and durable steps;
provider event IDs remain fixed SHA-256-derived values. Forward migration 6
rebuilds only the journal-step table, preserves existing rows, and rejects any
ID beyond the new finite bound. A realistic composed-ID execution regression
and a version-5-to-6 preservation regression now cover the defect.

Those correction gates subsequently completed. The final reviewed archive and
installed release are
`sha256:9986bbad0d320eea5dfe0b5fe705441a1927815f185767a6d24c9781789a8362`.
The failed manifest `sha256:e84fdcc...e332a65` was recoverably archived, the
release advanced only from its recorded predecessor while every candidate unit
was inactive, and new provider-inaccessible comparison evidence bound manifest
`sha256:3ef42b8d902a61b9add8afd6f15812f2076810050f9d275371d165922b2230bb`.
An initial retry reached the verifier moments before the bound start and failed
with zero effects; a fixed value-free diagnostic then verified every binding
after the window opened.

The authorized activation at 2026-08-13 12:23 Asia/Ho_Chi_Minh passed plan,
Classroom, SQLite integrity, verified backup, server health/readiness, and
manifest gates. It created exactly three owned events in `Auto Lesson 2`,
started all five isolated timers, and retained report-only alerts. The immediate
second Calendar reconciliation observed three events and attempted/completed
zero mutations. The separately retained private Tailnet candidate route proxies
only to loopback port 4319 and returns healthy/ready responses; its hostname is
intentionally excluded from public source. The legacy 9443 route inventory
remained unchanged. After the reviewed presentation fixes were
installed and rebound, the active observation window reset to exactly
2026-08-13 12:50 through 2026-08-20 12:50 Asia/Ho_Chi_Minh.
That active manifest has fingerprint
`sha256:69ccff3c358f0edd3cbd7a09f9e4d3ec8ccfac20eb2fe12a56f052903da99f7f`;
it is approved only for recoverable supersession before the reviewed
future-preview correction and must not be reused afterward.

The first physical end-of-day observation correctly selected `day_complete`
but exposed the previously deferred next-class-day acquisition gap: only the
current date had been imported, so the next-plan query had no future snapshot.
The offline correction extends the same read-only PowerSchool refresh with a
hard seven-date lookahead. It stores provider-verified empty days, excludes
them from class-day selection, stops at the first verified non-empty plan, and
fails closed on authentication, malformed, or ambiguous future responses.
Synthetic coverage proves that an empty intervening day selects the later
verified class day. At that checkpoint, live qualification still required a
reviewed release and a physical `day_complete` result.

That correction was subsequently installed as release
`sha256:a1061444548f4f47d0d632e83425f1e5df24cd34e27631ecfa4ed751b52b5fdf`
and rebound under manifest
`sha256:41cc8a7ea7e73ba514862bdf72faaaa287ec19f28e6f603a4ae7dfbc475435d9`.
After one fresh passive navigation renewed the existing legacy browser session,
the strict filtered-state bridge and candidate activation succeeded without a
new login. Local health and readiness were clean, the rendered state contained
`day_complete`, Friday, August 14, and the next real class-day schedule, and
the user accepted the physical Fully Kiosk result. This closes the physical
end-of-day-preview defect; the broader observation and final-handoff gates
remain open.

The next offline visual-parity correction ports the established legacy
during-class bell badge without changing domain or provider behavior. It uses
the current meeting's verified official end, displays ceiling-rounded minutes
only in `in_class_content`, refreshes from the browser clock without replacing
the scene DOM, clears at state/meeting transitions, and retains the legacy SVG,
glass treatment, minute-change shimmer, reduced-motion behavior, and accessible
minutes-until-bell label. This correction remains undeployed pending its own
reviewed inert release and live visual qualification.

[ADR-0022](../decisions/0022-parallel-production-canary.md) replaces M-17's
immediate handoff sequence with a parallel-canary activation gate followed by a
separately approved final-handoff gate. It does not renumber, split, promote,
or begin a later milestone.

## Accepted topology

| Boundary  | Legacy authority                         | Classroom Hub canary                                                                     |
| --------- | ---------------------------------------- | ---------------------------------------------------------------------------------------- |
| Display   | Existing private `/classroom-screen` URL | Separate exact Tailnet-only URL and loopback candidate port                              |
| Calendar  | Existing Calendar                        | Manually created secondary owned Calendar; exact target plus primary/legacy deny binding |
| State     | Existing legacy state                    | Separate SQLite, backup, lease, journal, marker, and configuration roots                 |
| Processes | Existing OpenClaw jobs/services          | Distinct repository-owned service and timer names                                        |
| Refresh   | Existing cadence                         | Bounded read-only provider acquisition at an approved staggered cadence                  |
| Alerts    | Existing alert behavior                  | Report-only; the direct Telegram adapter remains unwired                                 |
| TV        | Existing URL remains normal              | Bounded reversible Fully Kiosk evaluation windows only                                   |

The Google account may be the same because the Calendar targets are disjoint.
The credential is still broader than one calendar, so the application contract
must enforce the exact candidate target and deny the primary and legacy
targets. The application will not request authority to create or administer
calendars.

## Offline implementation evidence

The review lane now contains:

1. a value-free canary manifest fixing port `4319`, distinct configuration,
   state and release roots, `Auto Lesson 2`, report-only alerts, staggered
   `07:25` plan and `07:28` Calendar cadence, and candidate-only stop order;
2. sixteen inert `.in` service/timer artifacts with no `[Install]` section,
   including a mechanically read-only Calendar preflight separate from sync
   and provider-inaccessible integrity/verified-backup jobs;
3. an exact protected provisioner deriving the secondary Calendar identity and
   legacy deny hash from the already-qualified M-14 reference without printing
   either value;
4. a validator that rejects `primary`, the legacy Calendar, target/deny
   overlap, extra fields, unsafe references, and non-canary state;
5. an exact one-day Calendar reconciler using existing ownership audit,
   projection, durable lease, journal, idempotency, etag, and
   `sendUpdates=none` contracts;
6. a provider-free copier that transfers only validated filtered PowerSchool
   state into the distinct canary directory and never copies a browser profile;
7. digest-bound release build, inert install, exact activation, and a
   candidate-only stop script that quiesces every timer and in-flight oneshot;
8. a provider-neutral semantic comparator whose input cannot represent provider
   IDs and whose retained evidence binds date, time, summary, ownership,
   readiness, display state, and plan verification; and
9. a protected immutable activation-manifest binder/verifier that binds the
   release, Calendar/deny hashes, proposed Tailnet target, legacy-route
   fingerprint, exact stop command, comparison evidence, and observation
   window before activation. Synthetic tests cover target isolation,
   convergence, malformed evidence, protected config, state filtering,
   systemd drift, and provisioning drift.

The static repository manifest deliberately leaves the exact Tailnet target,
legacy-route deny fingerprint, release, comparison, and observation window as
live bindings. Before activation, explicit preactivation mode exports one
create-once protected comparison record so the activation manifest
must bind all of them and pass the compiled verifier. Continued normalized
legacy-versus-candidate comparison evidence is then collected repeatedly in
SQLite during the observation interval without recreating or replacing the
immutable preactivation export.
The separate provider-inaccessible observation service supplies that repeatable
contained invocation; it cannot recreate the preactivation export.

The final offline gate passed documentation, fixture and repository safety,
operational verification, formatting, strict server/client types, all 742
tests, production build, startup smoke, six-job rehearsal, M-16 cutover
rehearsal, dependency audit, publication safety, and `git diff --check` with
zero provider, service, route, or kiosk effects. A separate primary-agent
security review also tightened the systemd verifier to reject broadened or
duplicate hardening assignments and found no remaining material issue. The
separately authorized independent review then verified the complete source and
final archive against baseline `0cb49d6e765673a960692879af55dc96bd24ba35`
and issued a clean disposition for the live-preflight/proposal gate. It did not
approve activation, routing, provider activity, kiosk changes, promotion, or
final handoff.

The later legacy-bell and minute-only clock parity correction passed the same
complete offline gate with 744/744 tests. Chrome 150 rendered the synthetic in-class scene at
3840x2160, 1920x1080, 1366x768, 768x1024, and 390x844 without overflow or
console/page errors; the 1920x1080 inspection showed the visible upper-right
date before the minute-only clock and the bell badge vertically centered with
that clock. The badge displayed `60`, labelled `60 minutes until bell`, in a
101.5x48-pixel bounded region; the redundant lower-left `Dismissal begins`
countdown is absent. Non-class states hide the badge, reduced-motion mode
suppresses the shimmer, and repeated unchanged target polls update the
countdown without replacing the scene DOM. The inert candidate archive is
`/tmp/chalkwright-m17-canary-runtime.tar.gz`; its exact digest and size are
recorded outside the archive after packaging. It has not been installed or
activated.

## Remaining live gates

Provisioning, installation, filtered-state recovery, provider preflights,
semantic comparison, corrected activation, first reconciliation/readback, and
the separate Tailnet route are complete. The remaining gates are:

- physical Fully Kiosk evaluation during bounded windows, with the legacy URL
  retained as the immediate fallback;
- repeated provider-inaccessible semantic comparison and active-school-day
  behavior through the bound interval;
- observed scheduled refresh, Calendar convergence, backup/integrity, restart,
  and recovery behavior;
- user acceptance of the canary and a final `Auto Lesson 2` disposition; and
- a separately approved final route/scheduler/writer/alert handoff.

The legacy application remains authoritative. M-17 is active but unpromoted,
the final handoff is unauthorized, and M-18 cannot begin.

## Tomorrow-morning readiness sequence

After the full offline gate passes, the shortest reversible sequence is:

1. authorize protected provisioning;
2. build the runtime archive, record its SHA-256, approve that exact digest,
   and install the release plus inert units;
3. copy only the existing filtered PowerSchool state into the candidate root
   through the fixed privilege-dropping launcher bound to that installed
   release;
4. initialize the isolated canary SQLite database once through the
   release-bound, privilege-dropped, provider-free initializer;
5. authorize one read-only plan/Classroom preflight and one read-only semantic
   Calendar preflight against `Auto Lesson 2`; construct and retain the exact
   ID-free semantic comparison evidence;
6. inventory the proposed Tailnet target and legacy route without changing
   either, choose the bounded observation window, and bind the protected
   activation manifest to those values, the reviewed release, Calendar deny
   hashes, comparison evidence, and packaged stop command;
7. authorize candidate activation; require local integrity and a verified
   backup before readiness and the bounded Calendar reconciliation;
8. bind the approved candidate-only Tailnet URL to loopback port `4319` while
   recording a deny fingerprint for the legacy route; and
9. verify health/readiness/display/Calendar results before a temporary Fully
   Kiosk window. On any failure, run the candidate-only stop sequence; do not
   touch the legacy application.
