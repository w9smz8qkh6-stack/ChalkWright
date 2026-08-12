# Security policy

## Supported versions

Chalkwright is currently a pre-release project. Security fixes are applied to
the latest code on `main`; no older release line is supported yet.

## Reporting a vulnerability

Do not open a public issue for a suspected vulnerability, exposed credential,
private provider value, student-data disclosure, or authorization-boundary
failure. Use GitHub's private vulnerability reporting or a private repository
security advisory instead.

Include only the minimum information needed to reproduce the problem. Never
attach real credentials, OAuth tokens, browser profiles, student records,
provider responses, private URLs, database files, or screenshots containing
sensitive information. Synthetic reproduction material is preferred.

The maintainer will acknowledge a report when practical, assess affected
versions and operational boundaries, and coordinate a fix and disclosure. No
response-time guarantee is offered during the pre-release period.

## Security boundary

PowerSchool and Google Classroom are read-only integrations. Google Calendar
effects are restricted to explicitly owned events and exact approved targets.
Credentials, OAuth grants, browser profiles, protected references, and runtime
state must remain outside Git. See the
[architecture principles](docs/architecture-principles.md) and
[contribution guide](CONTRIBUTING.md) for the complete development boundary.
