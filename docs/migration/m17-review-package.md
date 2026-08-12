# M-17 review package: isolated parallel production canary

## Status

The M-17 architecture amendment is accepted; M-17 implementation and all live
actions remain **not begun and unauthorized**. No service, timer, Tailnet
mapping, Calendar, protected reference, provider, alert, or Fully Kiosk setting
was read or changed for this amendment.

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

## Remaining offline work

Before any live authorization, M-17 still needs:

1. an immutable canary manifest containing only digests or safe public values;
2. exact candidate service/timer/configuration/state artifacts that cannot
   collide with the legacy or final-production lane;
3. a distinct Tailnet-target proposal with a value-free legacy-route deny
   fingerprint;
4. a secondary-Calendar proposal with exact target/deny fingerprints and a
   read-only semantic preflight;
5. staggered cadence and finite provider-budget tests;
6. report-only alert wiring and duplicate-notification refusal;
7. cross-calendar, cross-state, cross-route, cross-unit, and double-writer
   adversarial tests;
8. normalized legacy-versus-candidate comparison evidence;
9. a candidate-only stop/removal runbook that never changes legacy state; and
10. the full offline gate plus independent review.

## Live gates

Each of the following remains separately authorized:

- protected-reference inspection or provisioning;
- creation or selection of the secondary Calendar;
- Calendar or other provider preflight/activity;
- installation or activation of candidate services/timers;
- creation of the separate Tailnet mapping;
- changing Fully Kiosk, even temporarily;
- running the canary and approving its observation interval; and
- the final route/scheduler/writer/alert handoff.

The exact active-school-day observation duration and final candidate-Calendar
disposition remain user decisions. Until the final-handoff gate, the legacy
application remains authoritative and M-18 cannot begin.
