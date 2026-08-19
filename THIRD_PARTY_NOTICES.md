# Third-party notices

Chalkwright does not vendor dependency source or `node_modules`. Runtime and
development dependencies are installed from the exact `package-lock.json`
graph and retain their own copyright and license notices.

## Direct dependencies

| Dependency              | Locked version | Declared license |
| ----------------------- | -------------: | ---------------- |
| `@googleapis/calendar`  |         16.0.0 | Apache-2.0       |
| `@googleapis/classroom` |         14.0.0 | Apache-2.0       |
| `playwright-core`       |         1.62.0 | Apache-2.0       |
| `tldts`                 |          7.4.9 | MIT              |
| `typescript`            |          5.9.3 | Apache-2.0       |
| `prettier`              |          3.9.6 | MIT              |
| `@types/node`           |        24.13.3 | MIT              |

The complete locked graph currently declares 10 Apache-2.0, 4 BlueOak-1.0.0,
1 BSD, 2 BSD-3-Clause, 9 ISC, and 70 MIT package entries, with no missing
license declarations. Re-run the inventory whenever the lockfile changes.

## Media

The synthetic screenshot and repository-authored SVG/CSS/JavaScript assets are
project material. No playable dismissal video is distributed. A deployment may
reference a separately stored, locally owned or licensed MP4 through the
digest-bound protected configuration described in `docs/configuration.md`.
The Apache-2.0 project license grants no rights to that external media.
