# ADR-0001: Self-contained host-native runtime

- **Status:** Accepted
- **Date:** 2026-08-08

## Context

The legacy classroom workflow depends on OpenClaw plugins, schedules, browser
runtime, state paths, and operational ownership. The target is a repository-
owned Node.js/TypeScript application running directly on the Linux host.

## Decision

Classroom Hub will own its application runtime, integrations, persistence,
scheduling definitions, routes, tests, and operating documentation. Its steady
state will have no required OpenClaw runtime, gateway, scheduler, plugin,
database, browser service, or directory dependency. OpenClaw may later consume
a stable Classroom Hub API as a client.

## Alternatives considered

- Keep the current OpenClaw plugins and only replace the display server.
- Package Classroom Hub as another OpenClaw plugin.
- Containerize the application and its browser runtime immediately.

These retain the dependency boundary or add an unproven deployment layer. A
transitional read adapter is acceptable only while its removal is planned and
measured.

## Consequences

The repository must provide missing capabilities explicitly, including direct
authentication adapters, jobs, persistence, and diagnostics. The boundary
reduces coupling and makes ownership testable, but increases initial migration
work. Host-native does not mean host-global: state and profiles remain scoped.

## Reversibility

High before cutover because adapters are ports and legacy remains authoritative.
After legacy removal, reversal requires the retained rollback/backup policy.

## Verification implications

Use dependency scans over imports, paths, process commands, units, timers, and
runtime configuration. Cutover is incomplete while any required edge points to
OpenClaw.
