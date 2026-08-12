# Public-preview publication gate

## Purpose

Chalkwright should be credible as a portfolio and open-source engineering
project before the complete operational migration roadmap is finished. A
public preview may be incomplete, but it must be honest, reproducible,
privacy-safe, legally distributable, and understandable without access to the
maintainer's host or legacy runtime.

This gate does not authorize M-17, provider activity, deployment, repository
visibility changes, commits, pushes, tags, releases, or package publication.

## Required public baseline

Before changing the GitHub repository from private to public:

1. **Legal:** add an explicit user-selected open-source license; verify that
   every bundled image, video, font, fixture, and copied source is owned by the
   project or has compatible redistribution terms; record third-party notices.
2. **Privacy:** remove or generalize personal home paths, account names, school-
   specific deployment references, private evidence locations, protected-file
   names, and machine-specific commands from the public snapshot. Scan the
   complete reachable Git history, not only the working tree.
3. **Scope:** publish product code, synthetic fixtures, architectural records,
   safe examples, and reproducible tests. Keep private migration operations,
   credentials, runtime evidence, browser profiles, databases, backups, logs,
   and host-specific activation artifacts outside the public history.
4. **Presentation:** provide a concise product-facing README with current
   maturity, screenshots or synthetic visuals, architecture, safety model,
   fixture-backed quick start, roadmap, and contribution links. Clearly label
   live-provider setup and production deployment as pre-release work.
5. **Community:** include contribution and security policies, a code of
   conduct, issue templates, release/version policy, and repository metadata.
6. **Reproducibility:** `npm ci` and `npm run check` pass from a fresh clone on
   a documented supported environment. GitHub CI uses immutable action
   references, read-only permissions, and no repository/provider secrets.
7. **History:** create a reviewable public-preview commit series or an approved
   curated root snapshot. Do not make the private migration history public by
   accident. The final tree and every reachable object pass secret, privacy,
   artifact, and oversized-file checks.
8. **Release:** use a SemVer pre-release or `0.x` tag, generated release notes,
   and an explicit limitations section. Do not claim production readiness,
   general installability, or completion of M-17/M-18.

## Current disposition

The offline engineering and publication-tree gates pass, and the project has
substantial tested functionality and architectural evidence. The exact public
root is accepted only after the curated-history procedure and GitHub CI pass;
the private migration archive must remain private.

The public README, community files, release policy, portable CI workflow, and
working-tree privacy/path audit are prepared. A reproducible synthetic display
screenshot and value-free provenance manifest are included. The local portable
gate passes. Those completed checks do not resolve media redistribution, Git
history, or external CI.

Apache-2.0 was selected for the project on 2026-08-12. Its explicit contributor
patent grant and permissive redistribution terms fit the intended public
collaboration model. The canonical license text is checked in as `LICENSE` and
the SPDX identifier is recorded in `package.json`.

The public identity is Chalkwright. Redistributable source contains no playable
dismissal video. Private deployments may use a separately stored, digest-pinned
site-owned or licensed MP4; absent media falls back to the repository-owned
poster without failing application readiness. Existing `classroom-hub`
runtime identifiers remain compatibility contracts pending a versioned rename.

A read-only `npm audit` against npm CLI 11.12.1 and the locked dependency tree
reported zero known vulnerabilities across 94 dependencies on 2026-08-12.
Weekly Dependabot checks are prepared for npm and immutable GitHub Actions
references. Vulnerability data is time-sensitive and must be refreshed before
the final public snapshot.

The current private history audit reports four findings: historical personal
paths in two files, one private evidence location, and one non-noreply author
email identity. The recommended resolution is the separately reviewed clean
root described in [the public history plan](publication-history-plan.md), not an
in-place destructive rewrite.

Repository visibility, source pushes, tags, releases, and deployment remain
separate effects. Publishing this clean-root source snapshot does not authorize
an M-17 canary, production deployment, package publication, tag, or release.

Run `npm run publication:check` for a value-free working-tree audit and
`npm run publication:history:check` for every blob and author identity reachable
from local Git refs. A rejection emits only stable codes, paths, and counts.
The working-tree gate deliberately fails while a license is absent, media
provenance is unresolved, or personal/protected paths remain in the candidate
tree. The history gate must be run again from the exact final public clone.
