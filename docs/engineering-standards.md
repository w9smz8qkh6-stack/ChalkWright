# Engineering standards

## Purpose

These standards define the repository's proportional build and documentation
contract. They apply to implementation when it is explicitly authorized; they
do not authorize migration work, live inspection, service changes, or external
writes.

## Self-documentation and architectural history

- Update relevant user, operator, API, data-contract, environment, and design
  documentation in the same change as the behavior it describes.
- Maintain [`CHANGELOG.md`](../CHANGELOG.md) with an `Unreleased` section.
  Record user-visible behavior, contracts, migrations, operations, security,
  consequential dependency/runtime changes, deprecations, and breaking changes.
  Omit formatting-only changes and behavior-neutral internal refactors.
- Use ADRs for consequential decisions whose alternatives and trade-offs should
  survive the implementation. Supersede an accepted ADR with a new record rather
  than rewriting history.
- Keep database migration records with the schema change and record operational
  migrations in the migration evidence/runbook. A changelog entry is a summary,
  not the only migration record.
- When commits are authorized, make them meaningful review units and record the
  reason for consequential decisions in documentation or the commit message.
- Treat local links and the generated tooling index as build inputs. The
  `npm run docs:check` command must pass before handoff.

## Code comments and interfaces

Prefer explicit types, clear names, small cohesive modules, and readable control
flow. Comments should explain information the code alone cannot safely convey:

- intent and invariants;
- ownership and side-effect boundaries;
- failure, retry, and idempotency behavior;
- security, privacy, and compatibility constraints; and
- the reason for a surprising algorithm or implementation choice.

Document public interfaces and complex domain contracts. Update their comments
when an invariant or unusual constraint changes. Do not narrate obvious lines,
keep dead code in comments, or preserve a comment after behavior has diverged.

## Versions and dependencies

- `package.json` defines supported Node.js/npm ranges and declared dependency
  ranges. `package-lock.json` defines the exact dependency graph and is
  authoritative for reproducible `npm ci` installation.
- [`tooling.md`](tooling.md) records detected host tools and locked project tools.
  Refresh it with `npm run docs:sync` after intentional version changes.
- Minimize dependencies. A material addition must solve a concrete repository
  problem, be placed in the narrowest dependency class, include relevant tests
  and canonical documentation, and be summarized in the changelog when it
  changes runtime, security, operations, or developer workflow.
- Review upgrades deliberately. Inspect the lockfile diff, relevant release and
  security notes, compatibility, licenses where applicable, and the full quality
  gate before accepting them.

No separate linter is currently installed. Strict TypeScript catches type and
unsafe-flow mistakes in the small codebase, while Prettier supplies deterministic
syntax formatting. Add a linter only when a concrete defect class, boundary rule,
or growing code surface justifies its configuration and maintenance cost.

## Architecture and configuration

- Keep domain logic independent of transports and persistence. Put external
  integrations behind typed interfaces that expose only approved effects.
- Validate configuration before application work begins. Errors must identify
  the setting and safe resolution without printing secrets.
- Use explicit application ownership and scope for state and effects. Preview,
  tests, and shadow execution must not receive mutation capabilities.
- Keep generated output, credentials, OAuth data, profiles, runtime state, logs,
  captures, databases, and sensitive school data outside Git.

## Database migrations

When SQLite implementation is authorized:

- evolve schemas only through numbered, reviewable migrations;
- perform a validated backup before production migration;
- use transactions and integrity checks;
- make data transformations idempotent or explicitly guarded;
- provide a practical rollback or restore path and state when reversal is not
  safe; and
- test empty-to-current plus supported version-to-version paths with synthetic
  data.

Do not call destructive down-migrations “reversible” when restoration from a
validated backup is the actual rollback mechanism.

## Tests and fixtures

Add the smallest test layer that proves the risk:

- unit tests for pure rules, edge cases, and invariants;
- contract tests for adapters, routes, schemas, and side-effect boundaries;
- integration tests for component wiring and explicitly authorized read-only
  providers;
- regression tests for confirmed failures; and
- smoke tests for the compiled production entry point and later deployment
  surface.

Golden fixtures must be synthetic or safely and irreversibly redacted. Record
their provenance and purpose without retaining private URLs, live identifiers,
credentials, raw student records, or sensitive response bodies.

## Services and jobs

Services and scheduled jobs must have bounded inputs and execution time, clean
shutdown, observable outcomes, safe retry, and idempotent or explicitly
deduplicated effects. Readiness must distinguish a running process from one that
can safely serve current classroom behavior. A failed upstream read must not
erase last-known-good display state or permit partial Calendar mutation.

## Quality gate

The normal CI-compatible, offline gate is:

```sh
npm ci
npm run check
```

`npm run check` verifies generated documentation, local links, changelog
structure, fixture safety, formatting, strict TypeScript, tests, the production
build, and the compiled startup smoke check. `npm run docs:check-links` is a
separate networked check for canonical external documentation URLs.

## Definition of done

A change is done only when all applicable items are complete:

1. Code and contracts implement the authorized scope without widening effects.
2. Focused tests and regression coverage pass in proportion to risk.
3. `npm run check` passes from a reproducibly installed dependency graph.
4. Relevant documentation and public-interface comments match behavior.
5. `CHANGELOG.md` records consequential impact under `Unreleased`.
6. Applicable ADRs, database migrations, migration evidence, and rollback notes
   are added or updated.
7. Dependency/runtime changes are justified, locked, documented, and reviewed.
8. Generated/runtime/sensitive artifacts remain outside Git.
9. The final review checks side effects, failure paths, privacy, compatibility,
   and removal of unnecessary complexity.
