# Future parity roadmap

This roadmap records the next parity work after the M-17 parallel-canary push.
Implementation is intentionally paused until the user resumes the roadmap after
the August 20, 2026 credit reset. In the meantime, small display fixes requested
during live classroom use may still be handled separately.

The priority order is user-directed: vocabulary first, on-disk lesson-reference
slide enhancement second, and attendance-admin parity later.

## 1. Vocabulary parity slice

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

Goal: prove the migrated app can run without babysitting before final handoff.

Scope:

- observe scheduled refresh, backup, integrity, restart, and recovery behavior;
- keep candidate alerts report-only until final handoff;
- run Fully Kiosk smoke checks in representative states; and
- prepare the final route, timer, writer, and alert handoff decision.

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
