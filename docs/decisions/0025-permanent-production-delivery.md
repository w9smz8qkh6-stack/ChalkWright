# ADR-0025: Permanent production delivery lane

- Status: Accepted
- Date: 2026-08-19

## Context

At acceptance, the historical shadow service displayed Chalkwright while the
M-17 canary retained deployment artifacts but no protected runtime
configuration. That split made it unclear which release received fixes and
prevented ordinary repository changes from reaching the display predictably.

## Decision

Use this repository and its protected GitHub `main` branch as the one canonical
source of Chalkwright releases. Establish one permanent, host-native production
lane with a display server, read-only PowerSchool and Google Classroom refreshes,
bounded synchronization to the exact application-owned Calendar, integrity and
backup jobs, and a dedicated manual authentication-repair operation.

Every completed commit merged to `main` is eligible for immediate deployment.
The deployer must build an immutable release, switch it atomically, verify local
health and readiness plus a non-mutating Calendar ownership preflight, and
restore the previous release automatically on failure. Credentials, Calendar
identity, routes, state, and other protected configuration remain outside Git
and are never printed by deployment output. A release must never sign in,
repair authentication, create/share Calendars, or alter its Calendar target.

## Consequences

- Small complete fixes can reach the display quickly without manual systemd
  operations.
- Calendar synchronization is a first-class production capability, but its
  exact target and authority are fixed protected configuration rather than
  repository data.
- The shadow and M-17 lanes remain rollback references only until the permanent
  lane has completed live readiness, refresh, Calendar convergence, and restore
  verification.

## Deployment status

Implemented on August 21, 2026. The permanent lane now follows protected
GitHub `main`, serves the existing classroom URL and mount, and runs the active
production timer set. Live readiness, read-only provider refresh, local glossary
projection, and owned-Calendar convergence have passed. The shadow service
remains available but is not the serving path. Stabilization, a fresh restore
drill, and explicit legacy retirement remain later evidence rather than
prerequisites for ordinary permanent deployments.

## Verification

Offline tests cover release construction, configuration validation, atomic
selection, rollback, and refusal of missing or mismatched Calendar ownership.
The first live promotion separately proves health, readiness, source freshness,
owned-Calendar convergence, backup, and restoration without inspecting or
printing protected values.
