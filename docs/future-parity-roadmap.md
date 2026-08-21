# Future parity roadmap

This roadmap records the remaining parity work after the M-17 parallel canary
and permanent-production handoff. Work resumed on August 21, 2026. The
standalone Chalkwright service now serves the existing classroom display path;
its permanent timers and owned-Calendar follower are active, while the
historical shadow service remains available only as a rollback reference.

The priority order is user-directed: vocabulary first, on-disk lesson-reference
slide enhancement second, and attendance-admin parity later.

## 1. Vocabulary parity slice

Implementation status: complete and live in standalone production. Protected
read-only Drive configuration binds the current academic year and five class
sources outside the repository. The display reads only the imported local
catalog and keeps working when Drive is unavailable.

Goal: make the migrated app's word-of-the-day and vocabulary cards feel as
useful as the legacy app while remaining explainable and bounded.

Scope:

- inventory the current vocabulary sources, including class-specific terms,
  subject terms, CodeHS or course signals, and vocabulary history;
- select one vocabulary item per meeting, avoid repeats until the pool is
  exhausted, and preserve repeat behavior explicitly when exhaustion occurs;
- keep bilingual, definition, and pronunciation-ready fields where available;
- add teacher-configurable vocabulary pools by course, unit, or lesson; and
- expose safe diagnostics explaining the selection without printing private
  lesson source text.

The implemented source is every direct-child CSV at each teacher-controlled,
bounded exact course path. English and teacher-supplied Vietnamese, Korean, and
Simplified Chinese columns are imported together; no LLM translation call is
part of the feature. Web Design, Robotics, Computer Fundamentals, and Digital
Media Production are live-bound. Existing meeting selections retain their word
identity while teacher corrections refresh display capitalization and content.

Acceptance:

- the display reliably shows relevant vocabulary during in-class content;
- repeated words are intentional and explainable; and
- missing vocabulary degrades gracefully without fabricated filler.

## 2. On-disk lesson-reference slide enhancement

Goal: augment in-class cards from teacher-owned lesson references without
mutating those references or inventing schedule truth.

Scope:

- define a safe on-disk lesson-reference folder structure;
- index only approved local lesson, unit, textbook, and support materials;
- map references to course, unit, date, and current objective;
- generate or enrich objective, bellringer, reminder, vocabulary-support,
  textbook/reference, and "today you'll need" cards; and
- retain source attribution that is inspectable by the teacher.

Acceptance:

- a known class/day can produce useful enriched cards from local references;
- card text remains bounded for the classroom display; and
- missing references fall back to Classroom/static content without blocking the
  screen.

## 3. Google Classroom assignment polish

Goal: make Classroom-derived cards concise and visually balanced.

Scope:

- compact long assignment directions;
- improve due-date badges and "open Classroom for full directions" wording;
- avoid duplicating static objectives when Classroom already supplies equivalent
  content; and
- preserve the read-only Classroom boundary.

Acceptance:

- assignment cards are scannable on the TV; and
- long descriptions do not dominate the carousel.

## 4. Preview and schedule confidence

Implementation status: working in production. Current-day acquisition,
unavailable-day distinction, bounded future lookahead, and physical
next-class-day preview have passed. A natural Sunday acquisition of the next
school week remains stabilization evidence rather than an implementation gap.

Goal: keep Sunday lookahead, morning verification, and end-of-day preview
boring and trustworthy.

Scope:

- verify Sunday acquisition of the following class week;
- verify morning schedule checks against the live PowerSchool bell page;
- distinguish "no classes found" from "not loaded yet"; and
- retain day-complete next-class-day preview behavior.

Acceptance:

- the screen shows the next real class day after classes end; and
- unavailable days are skipped only under the documented bounded lookahead
  policy.

## 5. Operational stabilization and handoff evidence

Implementation status: permanent handoff completed; stabilization remains.
The production service serves the existing classroom URL, all permanent timers
are active, Calendar reconciliation converges, and the historical shadow stays
available without serving the display. One successful full classroom day is
recorded. Alert activation, a fresh restore/restart drill, a natural
post-repair credential-free PowerSchool refresh, and the approved observation
interval remain open before M-18 retirement.

The August 21 OpenClaw dependency scan found no reference in any active
Chalkwright unit, production entrypoint, systemd dependency, package dependency,
or protected production configuration. Dormant historical M-15 writer-exclusion
and M-16 alert-provisioning modules, denial/safety guards, and their tests still
name OpenClaw and are compiled into release archives even though no production
unit can invoke them. Independent user-scoped OpenClaw services, including a
legacy PowerSchool Chrome profile, also remain active on the host but are not a
Chalkwright dependency. M-18 must classify and remove the dormant repository
modules from Chalkwright; it must not remove unrelated OpenClaw workloads merely
because they share the host.

The active native repair runs in Bren's systemd user manager and is working:
its last three recorded runs returned `authenticated` with exit code zero and
no OpenClaw involvement. The failed `browser-launch-closed` record belongs to
the obsolete system-manager lane and is not current repair evidence. The
credential-free production plan refresh that followed the latest successful
repair still returned `repair-required`, so the remaining stabilization gap is
routine state handoff/reuse, not native authentication repair. The display
retained its last-known-good plan and ran successfully.

Goal: prove the migrated app can run without babysitting before final handoff.

Scope:

- observe scheduled refresh, backup, integrity, restart, and recovery behavior;
- keep alerts report-only until their permanent ownership and destination are
  explicitly approved;
- run Fully Kiosk smoke checks in representative states; and
- retain redacted route, timer, writer, and recovery evidence for M-18.

Acceptance:

- the migrated display runs through real school-day cycles with bounded,
  recoverable failures; and
- final handoff has explicit rollback criteria.

## 6. Attendance-admin parity, deferred

Goal: keep the student-facing QR/check-in display stable now, while deferring
deeper teacher/admin attendance surfaces.

Deferred scope:

- attendance inspection routes;
- teacher attendance matrix; and
- any external Sheet/report continuity that the user still wants.

Acceptance later:

- QR behavior remains stable in the display; and
- admin/reporting work is treated as a separate parity slice rather than a
  blocker for display parity.
