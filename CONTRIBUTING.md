# Contributing to Chalkwright

## Start safely

Use Node.js 24.15.0 or newer and npm 10 or newer from the repository root:

```sh
npm ci
cp .env.example .env
npm run check:portable
```

The local `.env` is ignored. Keep only non-secret examples in `.env.example`.
Read the [architecture principles](docs/architecture-principles.md),
[engineering standards](docs/engineering-standards.md),
[security policy](SECURITY.md), and [code of conduct](CODE_OF_CONDUCT.md) before
consequential changes. `AGENTS.md` and `.codex/` configure optional maintainer
automation; contributors do not need Codex or OpenClaw to build or test the
application.

Chalkwright is currently pre-release. Please open an issue before proposing a
new provider capability, external mutation, deployment topology, persistence
surface, or migration milestone. A pull request does not authorize live
provider, routing, service, or production activity.

## Change discipline

- Preserve the capability boundaries between domain behavior, application
  orchestration, ports, infrastructure, and entry points.
- Keep PowerSchool and Google Classroom read-only. Calendar effects remain
  isolated behind their dedicated writer port.
- Use synthetic or safely redacted fixtures. Never add credentials, OAuth
  material, browser profiles, student data, raw provider captures, runtime
  databases, backups, logs, caches, or generated build output.
- Add dependencies only for concrete project value. Update the lockfile,
  tooling index, documentation, tests, and changelog when a material runtime or
  dependency choice changes.
- Update documentation, `CHANGELOG.md`, parity evidence, ADRs, and migration
  review records in the same change as the behavior or contract they describe.
- Keep commits scoped and meaningful. Do not install/start services, mutate
  routing, access live systems, or push unless the applicable task explicitly
  authorizes it.

## Pull requests

- Start from a current branch and keep one coherent concern per pull request.
- Explain the user or maintainer problem, behavioral impact, safety/effect
  boundary, and verification evidence.
- Use synthetic fixtures and injected capabilities for integrations. Never ask
  reviewers to reproduce a change against a live school system.
- Update public documentation and `CHANGELOG.md` with consequential behavior,
  contract, dependency, security, or operational changes.
- Expect review of capability reachability, privacy, failure behavior,
  idempotency, rollback, and evidence—not only the happy path.

## Verify before handoff

Run the portable contributor gate:

```sh
npm run check:portable
git diff --check
```

For a portable fresh-clone or CI environment whose host tool versions differ
from the maintainer's generated `docs/tooling.md`, use `npm run check:portable`.
The maintainer-only `npm run check` additionally proves that the generated
tooling index matches the canonical deployment host.

`npm run check:portable` verifies local documentation links, changelog
structure, fixture safety, inert operations artifacts, formatting, strict
TypeScript, tests, the production build, startup smoke behavior, and the
temporary SQLite operations rehearsal. Add focused unit, contract, integration,
regression, and browser evidence in proportion to the risk. “Done” includes
code, tests, docs, changelog, and applicable ADR/migration evidence.
