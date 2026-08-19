# Architecture decision records

Decision records distinguish accepted product/architecture direction from
implementation questions that still require evidence and approval. A proposed
record is not authorization to implement its leading option.

## Status meanings

- **Accepted:** governing direction unless superseded by a later ADR.
- **Proposed:** decision is open; listed options and spike/verification work are
  planning inputs only.
- **Superseded:** retained for history and linked to its replacement.

## Index

| ADR                                                              | Status     | Decision                                                     |
| ---------------------------------------------------------------- | ---------- | ------------------------------------------------------------ |
| [ADR-0001](0001-self-contained-host-native-runtime.md)           | Accepted   | Self-contained host-native runtime without OpenClaw          |
| [ADR-0002](0002-canonical-plan-and-sqlite-state.md)              | Accepted   | Canonical day plan and SQLite application state              |
| [ADR-0003](0003-bounded-external-system-effects.md)              | Accepted   | Read-only sources and bounded Calendar effects               |
| [ADR-0004](0004-separate-sensitive-and-runtime-state.md)         | Accepted   | Separate sensitive material and runtime state                |
| [ADR-0005](0005-systemd-and-tailnet-deployment.md)               | Accepted   | Repository-owned systemd and Tailnet-only deployment         |
| [ADR-0006](0006-parity-first-migration-and-single-writer.md)     | Accepted   | Parity-first migration, shadowing, rollback, and one writer  |
| [ADR-0007](0007-first-class-screens-and-rooms.md)                | Accepted   | First-class screens/rooms; current target amended to C509    |
| [ADR-0008](0008-server-controlled-carousel-holds.md)             | Accepted   | Server-controlled, screen-scoped carousel holds              |
| [ADR-0009](0009-initial-ui-delivery-strategy.md)                 | Accepted   | Small server-rendered HTML/CSS/TypeScript UI                 |
| [ADR-0010](0010-direct-powerschool-auth-adapter.md)              | Superseded | Original persistent-profile PowerSchool adapter decision     |
| [ADR-0011](0011-google-client-and-scopes.md)                     | Accepted   | Narrow installed-app Classroom coursework reads              |
| [ADR-0012](0012-alert-delivery-transport.md)                     | Accepted   | Alert delivery transport and operator ownership              |
| [ADR-0013](0013-state-retention-and-recovery.md)                 | Accepted   | State retention, backups, and recovery objectives            |
| [ADR-0014](0014-filtered-powerschool-session-state.md)           | Accepted   | Filtered session state with separate manual repair           |
| [ADR-0015](0015-aggregate-attendance-continuity.md)              | Accepted   | Aggregate-only attendance continuity and transient matrix    |
| [ADR-0016](0016-calendar-read-identity-and-ownership.md)         | Accepted   | Separate read-only Calendar audit and strong ownership       |
| [ADR-0017](0017-calendar-writer-qualification.md)                | Accepted   | Isolated non-production Calendar writer qualification        |
| [ADR-0018](0018-bounded-production-calendar-trial.md)            | Accepted   | Exact one-day production Calendar writer trial               |
| [ADR-0019](0019-bounded-cutover-rehearsal.md)                    | Accepted   | Bounded cutover and rollback rehearsal                       |
| [ADR-0020](0020-just-in-time-powerschool-repair.md)              | Accepted   | Isolated just-in-time PowerSchool session repair             |
| [ADR-0021](0021-persistent-powerschool-compatibility-lane.md)    | Accepted   | Separate persistent PowerSchool read/auth compatibility lane |
| [ADR-0022](0022-parallel-production-canary.md)                   | Accepted   | Isolated parallel production canary before final handoff     |
| [ADR-0023](0023-chalkwright-public-identity.md)                  | Accepted   | Chalkwright public identity and compatibility migration      |
| [ADR-0024](0024-application-owned-powerschool-authentication.md) | Accepted   | Application-owned PowerSchool authentication lifecycle       |
| [ADR-0025](0025-permanent-production-delivery.md)                | Accepted   | One permanent production delivery lane                       |

## Record policy

Each record states context, decision or proposal, alternatives, consequences,
reversibility, and verification implications. Amend an accepted decision with a
new superseding ADR when its trade-off materially changes; do not silently edit
history to make a later implementation appear pre-approved.
