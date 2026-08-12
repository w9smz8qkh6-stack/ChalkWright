# B407 Classroom Display MVP

## Outcome

The B407 Classroom Display MVP is the immediate M-05 deliverable: a complete,
offline, fixture-backed product slice that serves the B407 classroom display
and local operator views from loopback using temporary SQLite state and
repository-owned assets.

It is deliberately distinct from the later minimum viable replacement. This
MVP demonstrates the presentation and HTTP boundary without providers,
credentials, private school data, installed services, Tailnet routing,
production databases, Calendar execution, or the legacy runtime.

## Implemented local baseline

The implementation uses the accepted server-rendered TypeScript plus HTML/CSS
strategy and a bounded strictly checked TypeScript browser controller, with no
UI framework, client bundler, or added package dependency. A dedicated DOM
TypeScript configuration emits the uncommitted runtime asset under `dist/`;
focused executable protocol tests exercise that exact output. Repository-local
Chrome 150 evidence now covers the complete DOM/visual gate; screenshots remain
outside Git for one user review and do not imply human approval. A
capability-injected Node.js HTTP transport serves deterministic B407 fixture
plans through disposable SQLite state. Operator authority is an optional local
bearer value; its absence leaves the server read-only.

M-05 originally qualified the exact local galloping-horse MP4 referenced by the
latest legacy Classroom Screen source. ADR-0023 later removed playable video
from the distributable repository: a deployment may now reference a separately
stored, site-owned or licensed MP4 by exact path, length, and SHA-256, while an
absent video uses the repository-owned poster fallback. The application never
fetches or regenerates media.

## Included behavior

- Display, target, day-plan, preview, override, hold, QR, media, asset,
  manifest, health, and readiness routes.
- All eight frozen display states and exact meeting timing boundaries.
- Objectives, coursework, vocabulary, attendance links, and a readable QR code
  derived only from synthetic fixture contracts.
- Automatic carousel behavior, local controls, and durable screen/meeting/plan-
  scoped holds in a temporary SQLite database.
- Mutation-free previews plus bounded, locally authorized synthetic overrides.
- Local/offline HTML, CSS, TypeScript/JavaScript, media, icons, and manifest.
- Polling with timeout, bounded backoff, recovery, and last-known-good display
  retention.
- Loopback-only startup, readiness, health, and graceful shutdown.

## Evidence required for closure

- Route, method, header, authorization, input, traversal, and error-envelope
  tests.
- Media `200`, `206`, and `416` range behavior.
- Exact timing-boundary and all-state presentation tests.
- Preview non-mutation, override precedence, hold lifecycle/reload/isolation,
  polling/backoff/recovery, and offline-asset tests.
- Accessibility checks for semantic structure, labels, keyboard/focus,
  contrast, reduced motion, and reflow.
- Browser inspection of every representative state at `1920x1080` and operator
  views at a laptop viewport, including console, overflow, asset, network, QR,
  and visual-hierarchy checks.
- A versioned M-05 review package and screenshot/evidence index prepared for one
  user visual review. Agent inspection is not human approval.

The captured evidence is recorded under the task visualization directory
outside Git. It includes all eight display states at 1920x1080, the operator
views at 1366x768, effective 200% reflow, reduced motion, keyboard focus,
authorized override/hold interactions, and network/console/asset diagnostics.

## Explicitly later

Provider adapters, live or legacy data, authentication repair, Calendar
execution, operational job scheduling, alert delivery, service installation,
Tailnet routing, deployment, production backup operation, shadow execution,
cutover, and M-06+ work remain outside this MVP.

The later minimum viable replacement remains governed by the
[product vision](product-vision.md), [migration strategy](migration-strategy.md),
[migration plan](migration-plan.md), and
[legacy parity inventory](legacy-parity-inventory.md). Passing this offline
checkpoint does not satisfy their live, shadow, operational, or cutover gates.
