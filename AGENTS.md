# Repository guidance

## Scope

Keep this repository a host-native Node.js/TypeScript application. Preserve the
modular split between configuration, application orchestration, entry points,
and tests. Migration documentation is governed by `docs/README.md` and the
parity inventory. Do not implement migration work or perform migration
operations until the user explicitly requests and authorizes the applicable
scope.

## Security boundaries

- Never commit secrets, OAuth tokens or client data, browser profiles, student
  data, runtime state, logs, caches, coverage, compiled output, or generated
  artifacts.
- Treat PowerSchool and Google Classroom as read-only systems. Do not add code,
  scripts, commands, or documentation that writes, updates, deletes, submits,
  acknowledges, or otherwise mutates data in either system.
- Do not inspect or modify live services, scheduled jobs, external data, or
  files outside this repository while working on this project unless the user
  explicitly expands the scope.
- Keep systemd files as repository templates. Never install, enable, start, or
  restart units without explicit authorization.

## Development workflow

- Use `npm ci` for reproducible dependency installation.
- Treat `package-lock.json` as the authoritative dependency graph. Review and
  justify material dependency additions or upgrades; do not add tools merely to
  satisfy a generic checklist.
- Run `npm run check` before handing off changes. It is the offline unified gate
  for documentation, fixture safety, formatting, strict types, tests, production
  build, and startup smoke verification.
- Add tests under `test/` with a path corresponding to the module under `src/`.
- Keep integrations behind typed interfaces and add unit, contract, integration,
  regression, or golden-fixture coverage in proportion to the risk. Fixtures
  must be synthetic or safely redacted.
- Keep environment-specific values out of source control. Document only safe,
  non-secret placeholders in `.env.example`.
- Do not commit unless the user explicitly asks.

## Self-documentation and comments

- Follow `docs/engineering-standards.md` and its definition of done.
- Maintain `CHANGELOG.md` with an `Unreleased` section. Record consequential
  user behavior, contracts, migrations, operations, security, dependencies,
  deprecations, and breaking changes; omit trivial formatting and internal
  refactors without behavioral impact.
- Update relevant documentation in the same change as code or contracts. Use
  ADRs and migration records for durable consequential history, and meaningful
  commits when commits are authorized.
- Prefer clear names, cohesive modules, explicit types, and readable control
  flow over commentary. Comments document intent, invariants, ownership,
  effects, failures, security/privacy, compatibility, and non-obvious reasons;
  never retain dead commented-out code or comments that drift from behavior.
- Document public interfaces and complex domain behavior. Update comments when
  an important invariant or unusual constraint changes.

## Environment and documentation

- Read `.codex/environment.md` when a task depends on the working environment,
  host assumptions, bootstrap commands, external boundaries, or tool versions.
- Use `docs/tooling.md` as the project index of detected and locked tool
  versions and canonical documentation. Prefer version-matched documentation
  and installed local help over model recall when behavior may vary by version.
- Consult the canonical documentation whenever it is helpful, and always before
  relying on version-sensitive behavior, configuration schemas, MCP contracts,
  API contracts, framework behavior, security behavior, or compatibility.
- For OpenAI APIs, MCP, plugins, ChatGPT, or Codex, use the configured
  `openaiDeveloperDocs` MCP server and official OpenAI documentation. Check the
  recorded Codex version and installed `codex --help` when CLI behavior matters.
- Run `npm run docs:check` before handing off documentation, environment, or
  tooling changes; it verifies the generated tooling index, changelog structure,
  and local documentation links.
  Run `npm run docs:sync` after intentional package, runtime, host-tool, Codex,
  MCP, or canonical-link changes, and review the generated diff. When network
  access is authorized, run `npm run docs:check-links` after changing canonical
  links; do not make the normal offline quality gate depend on network access.
