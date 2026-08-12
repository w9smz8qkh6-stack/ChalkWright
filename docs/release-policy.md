# Release and version policy

## Current maturity

Chalkwright is pre-release software. The source contains a complete
fixture-backed product slice and substantial migration-qualified integration
work, but general installation and production deployment are not yet supported.

## Versioning

The project uses Semantic Versioning:

- `0.x` identifies public-preview development where APIs and configuration may
  change between minor versions;
- pre-release identifiers such as `-preview.1` may identify portfolio or
  evaluator snapshots; and
- `1.0.0` requires the documented self-hosted installation/configuration path,
  stable public contracts, supported upgrade/backup behavior, and an explicit
  readiness decision.

`package.json` remains `private: true` because Chalkwright is an application,
not a package intended for the npm registry. GitHub source releases do not
change that safeguard.

## Release contents

A public release must include:

- a detectable approved open-source license;
- a concise changelog and known-limitations section;
- a clean source snapshot and authoritative lockfile;
- successful portable CI and the repository's complete applicable offline
  quality gate;
- privacy, secret, oversized-file, and redistribution-provenance checks;
- source/build/configuration fingerprints where operational approval depends on
  exact bytes; and
- no credentials, provider data, runtime state, generated build output, or
  host-specific activation material.

Git tags, GitHub releases, generated archives, container images, npm packages,
and deployment activation are separate effects. No one effect authorizes
another.

## Support

Until `1.0.0`, only the latest `main` snapshot or explicitly named preview is
supported. Security reports follow [SECURITY.md](../SECURITY.md). Production
deployment remains governed by the migration and operations gates rather than
the existence of a GitHub release.
