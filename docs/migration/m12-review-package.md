# M-12 review package: behavior comparison

- **Status:** promoted on 2026-08-10 after explicit user approval of the
  comparison result and corrected visual
- **Authorization:** explicit user authorization on 2026-08-10 to continue to
  M-12 with read-only plan, display, and operations comparison
- **Remaining gate:** none within M-12; at M-12 promotion M-13 was separately
  gated and unstarted, and it was subsequently promoted on 2026-08-10
- **Production boundary:** no Calendar capability, provider write, TV routing,
  kiosk change, cutover, or M-13 work

## Roadmap fit

M-12 follows the promoted M-11 isolated shadow and is the final Stage C
checkpoint. It compares the replacement with the existing Classroom Screen
reference before any Calendar or production-route work. It gates M-13; it does
not authorize or begin M-13.

The usable offline display gate was completed at M-05. On 2026-08-10 the user
explicitly accepted both the corrected M-12 visual and the comparison result,
promoting M-12. The replacement MVP is not complete: M-13 was subsequently
promoted, while M-14 through M-18 remain for a separately scoped writer
qualification and trial, production-readiness/rollback, cutover, stabilization,
and legacy retirement. The exact production TV URL, active route mapping,
production viewport, broader room rollout, Calendar decisions, brief delivery,
and cutover ownership remain deferred rather than completed.

## Governing reference

The repository product vision, migration plan, parity inventory, accepted
ADRs, and M-05 through M-11 packages govern this checkpoint. The user identified
the current legacy OpenClaw Classroom Screen plugin as the reliable behavioral
reference. Its repository guidance was read before its current documentation,
source, tests, and non-private assets were inspected. Runtime JSON, protected
configuration, credentials, backups, student data, and provider state were not
opened.

The unchanged legacy repository passed its offline `npm run verify` gate with
93/93 tests. That is reference evidence, not proof that the replacement
matches it.

On 2026-08-10, the user approved that unchanged legacy implementation together
with its documentation and passing test suite as the alternative behavioral
reference where the live legacy service has no current C509/date data. This
does not turn missing live values into matches: the comparator still reports
any observed candidate drift, while surfaces that cannot be compared live stay
identified as unavailable rather than equal.

## Offline comparison implementation

`src/application/comparison/m12-parity.ts` compares only finite normalized
facts. Inputs cover canonical/effective plan shape, all eight display states,
timing and content surfaces, attendance and media presentation, route families,
readiness/last-known-good behavior, provider outcomes, job order, cadence,
brief/alert semantics, and external-mutation counts. It accepts no provider,
credential, browser, command, Calendar writer, generic network, source value,
or private URL capability.

The exact required manifest contains one each of:

- normal;
- changed schedule;
- inter-class gap;
- no class;
- future/next-class day;
- stale Classroom cache; and
- provider authentication failure.

The manifest validator cross-checks each label against finite facts from the
trusted reference side; seven copies of a normal case relabeled as the other
scenarios are rejected. Candidate facts remain free to differ on every field so
drift is reported rather than rejected. The validator also rejects missing or
duplicate scenarios, extra fields, unknown/unsorted route families, hostile
accessors, malformed counts, and forged evidence.
Differences contain only stable codes, surface names, behavior IDs,
disposition, and severity. Neither input value is returned.
Evidence projects into the existing strict `comparison-evidence` SQLite kind
and contains only date/screen scope, the comparison instant, exact equality,
codes, and fixed generic diagnostics. Accepted replacements remain differences,
so they set exact `equal` to false while the in-memory suite can still be
behaviorally equivalent when no unexplained difference exists.

## Explicitly accepted differences

Only these directional, exact replacements are automatically accepted:

1. legacy client-local carousel pause becomes the accepted screen-scoped,
   reload-persistent server hold from ADR-0008 and `DISP-005`/`DISP-006`;
2. the reduced legacy 06:20 weekday refresh becomes the user-approved M-11
   07:20 Asia/Ho_Chi_Minh Sunday-through-Friday shadow cadence; and
3. the replacement route set adds the already verified persistent-hold and
   M-09 attendance inspection/redirect families while preserving every legacy
   family.

The inverse, a partial route extension, a weakened header, an overflow, a plan
count/state change, a readiness difference, or any nonzero candidate external
mutation is unexplained and fails the comparison.

## Offline verification

The focused M-12 run currently passes ten tests. It proves:

- exact seven-scenario completeness;
- 21 accepted differences, three in each synthetic case, and zero unexplained
  differences;
- frozen behavior-ID attribution for material plan, display, route, and
  operations drift;
- explicit attribution for preview, override, attendance, provider lifecycle,
  persistence, diagnostics, service/rollback, operator-security, network, and
  dependency-independence drift;
- unconditional failure for any candidate provider mutation count;
- directional/exact accepted-difference policy;
- strict hostile-input rejection with sanitized errors;
- rejection of a forged result; and
- atomic SQLite round-trip of redacted comparison evidence.

An architecture test proves that the comparator imports only finite contracts,
runtime validation, identities, and the existing safe-state record type. It
cannot construct provider, Calendar, credential, browser, command, or network
capability.

The rule table now attributes every fixed non-`CAL-*` behavior ID in the parity
inventory, including preview, override, attendance, provider-session/read,
Classroom-pipeline, persistence, service/rollback, health-diagnostic,
operator-security, network, and dependency-removal surfaces. `E-M12` is cited
on representative affected inventory rows. A zero-difference synthetic suite
proves the comparator and manifest; it does not assert that live state has
already satisfied those rules.

Open `U-*` decisions are not silently converted into behavior facts. `U-003`
and `U-015` have explicit cadence/brief fields. The remaining room/route,
viewport, operator identity, alert transport, fallback, broader legacy scope,
attendance ownership, and stabilization decisions (`U-001`, `U-002`, `U-004`,
`U-008` through `U-014`, except the accepted retention policy in `U-013`)
retain their inventory gates. `U-005` and the Calendar half of `U-007` remain
for M-13/M-14; the accepted PowerSchool adapter decision in `U-006` and
Classroom half of `U-007` retain their existing ADR evidence.

The closing `npm run check` passed 473/473 tests, 100 local documentation
links, fixture safety, 310 repository-safety candidates, systemd/cadence
verification, formatting, strict application and browser-client types,
production build, smoke, and the 6/6 offline rehearsal. `git diff --check` is
clean. A final independent delta review found no material blocker after the
scenario and complete non-Calendar attribution regressions were added.

## Visual evidence

M-05 recorded a complete synthetic Chrome 150 set outside Git for all
eight states at the provisional 1920×1080 TV viewport, the operator view at
1366×768, effective 200% reflow, keyboard focus, reduced motion, local assets,
media, QR, and overflow. That evidence remains useful prior evidence and was
not copied into this repository.

M-12 reinspection confirmed that both systems define the same eight named
states: `no_classes`, `morning_overview`, `idle`, `pre_checkin`,
`in_class_content`, `dismissal_warning`, `post_end`, and `day_complete`.
Check-in is therefore included as `pre_checkin`; there is no ninth named state.
The apparent extra state is a visual/context variant: the legacy `post_end`
state covers the class-ended transition and the next-class gap.

Comparison with the authoritative legacy `src/timing.js`, `src/render.js`,
`assets/runtime.css`, and state-machine/render tests found material
presentation gaps that the M-05 replacement-only screenshots could not reveal:

1. legacy `idle` and `post_end` render the full-screen horse-backed “Coming Up”
   scene with separate countdowns to check-in opening and class start;
2. legacy `day_complete` renders the next available class day's date, class
   count, and schedule rows with `Tomorrow`, `Next Week`, or `Next Class Day`
   context; and
3. legacy `pre_checkin` renders QR/link/code plus roster, present, tardy,
   absent, and response counts.

Morning overview, the in-class carousel, dismissal warning, no-classes, basic
state timing, focus, reduced motion, local resources, QR behavior, overflow,
and operator views retain their M-05 evidence.

The replacement now ports the reference decisions through its existing typed
presentation boundary rather than introducing a second renderer:

- `idle` and `post_end` share the mirrored two-layer local horse-media scene,
  dark broadcast overlay, navy/blue palette, large course-only title, time
  window, hidden redundant header class, and separate glass-footer countdowns;
- `pre_checkin` receives the configured legacy attendance class code and all five aggregate
  attendance counts, and renders the reference blue full-screen composition,
  bounded local QR, complete safe link, rounded code card, and five-column
  summary; and
- `day_complete` receives the complete selected next-class-day plan and renders
  its contextual label, formatted date, class count, and up to six schedule
  rows using the reference spacing, type scale, colors, and time/course/block
  grid.

The first visual pass used the earlier 63,887-byte synthetic WebM stand-in.
User review correctly identified that it was not the high-quality media from
the latest legacy deployment. The governing legacy source names the local
`galloping-horse.mp4`; the clean integration now contains those exact
4,591,479 bytes with pinned SHA-256
`eac0b161a6f176eef4bc413207862337eb66bad193cca95640cc44b877b6267e`.
The bounded server exposes it as `video/mp4` on the existing allowlisted media
routes and rejects a path, size, signature, or digest mismatch.

The port deliberately preserves replacement safety/accessibility contracts:
typed values, escaped markup, bounded HTTP and local QR targets, descriptive QR
alternative text, keyboard focus, reduced-motion handling, and repository-owned
offline media. It does not copy runtime state, private values, or unsafe legacy
HTML interpolation.

This is not fixture-only wiring. The isolated shadow controller now reads the
earliest valid future effective plan and validated aggregate attendance
continuity from its existing local SQLite database. Its optional bounded
`attendanceClassCode` comes from the course mapping configuration, matching the
legacy quick-link contract rather than being inferred from a PowerSchool
section code. A disposable-SQLite HTTP integration test proves that a stored
future plan reaches `day_complete` and that class code plus counts reach
`pre_checkin` even when its link/QR is absent. Missing or corrupt attendance
data degrades only attendance-dependent elements and never creates provider
access from a display request.

After a stale `dist/` capture was detected and rejected, the production bundle
was rebuilt and a fresh disposable Chrome 150.0.7871.114 profile captured the
four corrected states at 1920×1080 against an ephemeral loopback fixture. It
also captured `pre_checkin` and `day_complete` at a 960×540 CSS viewport,
representing effective 200% TV reflow, plus a reduced-motion Coming Up case. A
pre-navigation route guard plus host-resolver denial kept requests loopback-
only. The final record shows no horizontal overflow, unexpected requests, or
console errors; the 200% layouts remain complete through vertical reflow,
keyboard focus exposes a visible skip link, reduced motion has no active
animations, both exact 1280×720 horse-media layers reached
ready state 4 with the reviewed 8-second duration; check-in rendered the
328-pixel local QR and all five totals; and day-complete rendered two separated
schedule rows without the stale prior-class header. The evidence manifest binds
the approved baseline commit, SHA-256 digests for every touched presentation/
wiring source, the built server/client modules, and every PNG. The disposable
browser profile, fixture SQLite state, and server were removed afterward.

Evidence remains outside Git in the private M-12 evidence directory; its
host-specific location is intentionally not published. `browser-evidence.json`
indexes the seven PNGs. Agent inspection found no
clipping, overlap, hierarchy, or fidelity defect in the final set. On
2026-08-10 the user explicitly confirmed that the corrected exact-horse-media
capture was the expected visual, closing the human visual-fidelity gate.

## Sanitized live comparison

The user authorized a read-only comparison against the legacy application and
isolated shadow. One bounded probe used only their loopback read endpoints and
reduced every response in memory. Its output contained statuses, counts,
booleans, and stable codes only; it did not print or store display identities,
titles, section codes, course IDs, times, links, student data, provider bodies,
protected state, or private URLs.

Both display-discovery and health endpoints returned 200. The shadow exposed
the expected current room and its Tuesday day plan returned 200 with three
meetings. The legacy service exposed two displays, but neither represented the
current room or covered the authorized Tuesday. There was therefore no
like-for-like legacy plan from which to compare meeting counts or timing. This
is recorded as `legacy-reference-date-unavailable`; downstream count/timing
comparisons are not treated as differences when one side is absent.

The legacy readiness endpoint returned 200 while shadow readiness returned 503
on the no-class Monday. The user then clarified the governing source semantic:
when the authenticated schedule page for a date contains no entries, that day
has no classes. The historical shadow result lacked a stored plan because the
collector had rejected every zero-period page as `not-found`.

The integration now makes that distinction at the narrowest source boundary.
Only a successfully authenticated bell response that has already passed the
exact bell marker and expected-school checks may opt into empty-day
normalization. The capture must also contain one recognizable AET day container
for the exact requested date with no period element, embedded period payload,
or time-range entry. It then produces a fresh, verified `no-classes`
observation, derives a canonical plan with zero meetings, and stores the
corresponding effective plan. Missing markers, missing or wrong dates, expired
sessions, changed or malformed period markup, parser/authentication failures,
and ordinary `not-found` results remain failures and cannot be silently
converted into no-class days.

The new offline evidence includes direct normalizer checks, an exact-date
real-Chrome synthetic routine read with a pre-seeded filtered PowerSchool state
and zero identity-origin requests, and a shadow source-handler check that stores
both empty canonical and effective plans with zero external mutations. This
resolves the identified contract defect offline; live readiness has not been
re-probed, so the earlier 503 remains historical evidence rather than a claimed
current result. No comparison row was persisted because the live case was
incomplete.

A subsequent authorized refresh attempt failed before acquisition with the
sanitized result `shadow-powerschool-session-state-rejected`. It did not reach
the no-class parser or Classroom and made no provider mutation. The user
explicitly declined another operator sign-in. M-12 therefore treats the prior
successful credential-free Tuesday read as its live PowerSchool acquisition
evidence and the 473-test exact empty-day path as the no-class correction
evidence. Filtered-session longevity and live no-class readiness confirmation
are deferred operational evidence, not a reason to repeat authentication or a
claim that the live result has been observed.

Any future repair-authentication design is a separate, explicitly authorized
checkpoint. It must begin by characterizing the already working legacy repair
implementation and adapting only the necessary read-only lifecycle behavior;
M-12 does not add a 1Password integration, credential automation, or another
authentication path.

## Stop condition

The legacy visual/content gaps and matching synthetic browser evidence are
resolved. The user accepted the corrected visual and then explicitly approved
the M-12 comparison result and promotion on 2026-08-10. M-12 is promoted.

The approved alternative reference, prior successful Tuesday acquisition, and
offline no-class evidence satisfy the PowerSchool/reference portion of this
checkpoint without another login. Session longevity and a live empty-day
readiness observation remain explicitly deferred rather than completed.

At this checkpoint M-13, Calendar reads/writes, production routing, and kiosk
changes remained outside the package. M-13 was subsequently promoted; Calendar
writes, production routing, and kiosk changes remain gated.
