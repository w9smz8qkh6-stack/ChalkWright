# Public history plan

## Decision boundary

This document prepares, but does not authorize, a repository rename, new
repository creation, history rewrite, commit, push, visibility change, tag, or
release.

## Current evidence

The candidate working tree passes its privacy/path checks except for the two
explicit legal gates recorded in `publication-readiness.md`. The repository-
owned reachable-history audit currently rejects the private repository for four
value-free findings:

- two historical files contain a maintainer home path;
- one historical file names a private evidence location; and
- reachable commit metadata contains one non-noreply author email identity.

The audit did not classify a reachable blob as recognized secret material,
private-key material, a runtime artifact, or an oversized object. This is
evidence from the repository's bounded scanner, not a guarantee that arbitrary
historical content is safe.

## Recommended strategy

Retain the current repository as a private migration archive and publish a new
repository from one curated root snapshot:

1. Resolve the license and both bundled-media rights gates in the isolated
   working tree.
2. Re-run the full portable, publication-tree, dependency, and whitespace
   checks.
3. Materialize a separate temporary snapshot containing only tracked public
   source, tests, safe fixtures/assets, documentation, and community files.
4. Initialize new Git history with a GitHub noreply author identity and one
   signed or otherwise attributable `0.1.0` public-preview baseline commit.
5. Re-run the complete checks from a fresh clone of that exact root commit,
   including the reachable-history audit.
6. Preserve the existing private repository under a distinct archive name and
   create the public `classroom-hub` repository from the verified clean root.
7. Push only after the user reviews the exact tree digest, destination, commit
   metadata, and visibility effect.
8. Validate GitHub CI before considering a tag or GitHub release. A source push
   does not itself authorize either.

The current private repository already has a suitable description, uses
`main`, has issues enabled, and has its wiki disabled. The proposed public
topics are `typescript`, `nodejs`, `education`, `classroom`, `kiosk`, `sqlite`,
`self-hosted`, `powerschool`, `google-classroom`, and `google-calendar`. A
homepage can remain empty until a stable public demo or documentation site
exists.

The baseline commit may legitimately be large: the repository's milestone
history is preserved in ADRs, review packages, the parity inventory, and the
changelog. Artificially splitting a clean root into non-building commits would
make the public history less trustworthy, not more reviewable.

## Rejected alternatives

- **Make the existing repository public unchanged:** fails the recorded
  privacy/history gate.
- **Force-rewrite the existing remote in place:** destructive, difficult to
  prove complete across every ref, and risks retaining or exposing historical
  objects through branches, pull requests, forks, or caches.
- **Publish only generated build output:** loses the source, tests, architecture,
  and reproducibility evidence that make the project credible.
- **Copy the current directory without an allowlist:** risks including ignored,
  untracked, runtime, or protected material.

## Required final evidence

Before a public push, retain a sanitized record of:

- the exact snapshot tree hash and commit hash;
- the selected license and media disposition;
- passing `npm ci`, `npm run check:portable`, `npm run publication:check`,
  `npm run publication:history:check`, `npm run dependencies:audit`, and
  `git diff --check` results from a fresh clone;
- zero unexpected symlinks, oversized objects, runtime artifacts, recognized
  secret material, personal paths, and private author identities;
- the destination owner/repository and initial visibility; and
- the resulting GitHub Actions run URL and conclusion.
