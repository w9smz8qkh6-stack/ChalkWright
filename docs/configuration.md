# Configuration

## Current boundary

Chalkwright currently exposes strict, capability-specific runtime schemas.
They are designed to reject ambiguity and accidental authority; they are not
yet the planned guided setup experience for a general installer.

The fixture-backed local demo needs only the safe defaults copied from
`.env.example`. It binds to loopback, uses synthetic data, and receives no
provider or Calendar capability:

```sh
npm ci
cp .env.example .env
npm run build
npm start
```

## Configuration classes

Keep these classes separate:

1. **Public defaults** — loopback host/port, finite timeouts, request limits,
   and synthetic fixture switches. Safe placeholders belong in `.env.example`.
2. **Site policy** — timezone, room/screen identities, mappings, target names,
   and schedule policy. Current production compositions load validated,
   owner-only external JSON or environment files.
3. **Protected references** — filesystem paths that point to OAuth grants,
   browser session state, operator tokens, or other protected material. Source
   control may contain an empty placeholder or documented path shape, never
   the protected value.
4. **Runtime state** — SQLite databases, backups, journals, leases, browser
   profiles, logs, and evidence. These always remain outside the repository.
5. **Optional site media** — a locally owned or licensed MP4 outside the
   repository, referenced by normalized absolute path, byte length, and
   SHA-256. The public distribution uses its poster fallback when this is
   absent.

An empty provider reference grants no provider capability. Do not replace a
reference field with an inline credential, token, cookie, or OAuth payload.

An optional production-server media reference has this shape:

```json
{
  "dismissalMedia": {
    "path": "/absolute/site-owned/path/dismissal.mp4",
    "byteLength": 1234567,
    "sha256": "64-lowercase-hex-characters"
  }
}
```

The file is never copied into Git. Startup fails closed when a configured file
is missing, linked, malformed, or does not match its size and digest. Omitting
the entire field is supported and leaves the application healthy with the
repository-owned poster fallback.

## Supported public-preview workflow

The supported public-preview workflow is presently the fixture-backed demo and
offline test suite. Provider enrollment, production systemd activation,
Tailnet routing, Calendar writing, and migration/cutover commands remain
maintainer-qualified workflows rather than a general installation interface.
Their existence in source does not make them safe to run against another site.

See `.env.example` for the complete non-secret placeholder inventory and
`docs/operations.md` for the current operational boundaries.

## Planned installer-facing format

The intended self-hosted setup layer will use one versioned, human-authored,
non-secret configuration for:

- site timezone and academic calendar;
- rooms, screens, display labels, and browser URL;
- PowerSchool room and schedule mapping;
- Google Classroom course mapping;
- the separately owned Calendar target;
- display timing and optional attendance links; and
- backup, retention, and notification policy.

A setup command will validate that file, collect or reference protected values
through separate enrollment steps, and generate least-authority runtime files
and inert service templates. It must support validation and preview without
provider access or service changes. This guided layer is future roadmap work;
the repository does not claim it exists today.

## Safety rules

- Never commit `.env`, credentials, OAuth JSON, browser state, provider
  responses, student data, databases, backups, logs, or private URLs.
- Keep PowerSchool and Google Classroom read-only.
- Use a distinct owned Calendar for parallel evaluation.
- Run `npm run check:portable` before proposing a configuration-contract
  change.
- Treat every service install, activation, route change, provider request, and
  provider mutation as a separately authorized effect.
