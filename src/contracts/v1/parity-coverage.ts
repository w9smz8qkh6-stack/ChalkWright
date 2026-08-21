export type CoverageKind =
  | 'synthetic-fixture'
  | 'contract-test'
  | 'static-invariant'
  | 'visual-case'
  | 'later-verification';

export interface ParityCoverageEntry {
  readonly parityId: string;
  readonly kind: CoverageKind;
  readonly references: readonly string[];
  readonly laterGate: string;
  readonly note: string;
}

function entry(
  parityId: string,
  kind: CoverageKind,
  references: readonly string[],
  laterGate: string,
  note: string,
): ParityCoverageEntry {
  return { parityId, kind, references, laterGate, note };
}

const fixture = (
  id: string,
  references: readonly string[],
  laterGate: string,
  note: string,
) => entry(id, 'synthetic-fixture', references, laterGate, note);

const contractTest = (
  id: string,
  reference: string | readonly string[],
  laterGate: string,
  note: string,
) =>
  entry(
    id,
    'contract-test',
    typeof reference === 'string' ? [reference] : reference,
    laterGate,
    note,
  );

const invariant = (
  id: string,
  reference: string,
  laterGate: string,
  note: string,
) => entry(id, 'static-invariant', [reference], laterGate, note);

const visual = (
  id: string,
  references: readonly string[],
  laterGate: string,
  note: string,
) => entry(id, 'visual-case', references, laterGate, note);

const later = (id: string, laterGate: string, note: string) =>
  entry(id, 'later-verification', [], laterGate, note);

/**
 * One primary M-01 accounting entry for every parity behavior and unknown.
 * Primary coverage freezes evidence; later gates still own behavioral proof.
 */
export const parityCoverage: readonly ParityCoverageEntry[] = [
  contractTest(
    'PS-001',
    [
      'test/architecture/m07a-boundaries.test.ts',
      'test/infrastructure/powerschool/browser-read.test.ts',
      'test/infrastructure/powerschool/synthetic-integration.test.ts',
      'test/application/integration/read-only-gate.test.ts',
      'docs/migration/m07b-review-package.md',
    ],
    'M-11 shadow evidence',
    'M-07A structurally confines acquisition to bounded passive reads, M-07C completed credential-free exact reads, and the protected M-10 comparison composed only read-source capabilities with fixed zero-mutation evidence.',
  ),
  contractTest(
    'PS-002',
    [
      'test/infrastructure/powerschool/browser-read.test.ts',
      'test/infrastructure/process/quiescent-child.test.ts',
      'test/architecture/m07a-boundaries.test.ts',
      'docs/migration/m07b-review-package.md',
    ],
    'M-07A temporary-profile qualification, historical M-07B evidence, then M-18 managed-profile path removal',
    'M-07A validates disposable profile isolation. M-07B historical evidence records the one bounded protected-profile characterization; M-18 removes that obsolete executable path and retains only disposable-profile browser reads.',
  ),
  contractTest(
    'PS-003',
    [
      'test/infrastructure/powerschool/auth.test.ts',
      'test/infrastructure/powerschool/synthetic-integration.test.ts',
      'docs/migration/m07b-review-package.md',
    ],
    'M-07A cached/live synthetic tests, then M-07B characterization',
    'Cached status remains network-free by default. M-07B observed a sanitized authentication-required status classification through the explicit live probe and stopped.',
  ),
  contractTest(
    'PS-004',
    ['test/infrastructure/powerschool/repair.test.ts'],
    'M-07A synthetic consent/repair tests, then separately authorized M-07B repair characterization',
    'Repair is a separate consent-bearing capability that passive acquisition cannot receive.',
  ),
  contractTest(
    'PS-005',
    [
      'test/infrastructure/powerschool/repair.test.ts',
      'test/infrastructure/powerschool/synthetic-integration.test.ts',
      'docs/migration/m07b-review-package.md',
    ],
    'M-07A synthetic SSO/blocker tests, then M-07B characterization if explicitly authorized',
    'Synthetic SSO/manual blockers, timeout, and repair success remain explicit and redacted; real prompts are uncharacterized.',
  ),
  contractTest(
    'PS-006',
    [
      'test/infrastructure/powerschool/passive-http.test.ts',
      'test/infrastructure/powerschool/browser-read.test.ts',
      'test/infrastructure/powerschool/synthetic-integration.test.ts',
    ],
    'M-07A synthetic transport matrix, then M-07B observed transport audit',
    'The adapter prefers bounded same-origin HTTP. M-07B selected session-http for the exact status surface and stopped on the authentication redirect; live browser fallback remains unexercised.',
  ),
  contractTest(
    'PS-007',
    [
      'test/fixtures/m03-legacy-golden.ts',
      'test/application/normalization/bell-schedule.test.ts',
    ],
    'M-07A sanitized adapter replay, then M-07B bounded layout characterization',
    'M-03 and M-07A implement and test synthetic AET normalization shapes. M-07B stopped at authentication, so authenticated tenant layout remains uncharacterized.',
  ),
  contractTest(
    'PS-008',
    [
      'test/infrastructure/sqlite/repository.test.ts',
      'test/infrastructure/sqlite/continuity-import.test.ts',
      'test/infrastructure/powerschool/adapter.test.ts',
      'test/infrastructure/powerschool/synthetic-integration.test.ts',
    ],
    'M-07A adapter latest-observation tests, then M-07B characterization',
    'M-04 persists validated plan/provenance payloads and skips corrupt current rows for valid history. M-07B retained only sanitized external evidence because authentication blocked schedule acquisition.',
  ),
  contractTest(
    'PS-009',
    [
      'test/infrastructure/powerschool/auth.test.ts',
      'docs/migration/m07b-review-package.md',
    ],
    'M-07A injected-clock cooloff tests, then M-07B characterization',
    'Injected-clock tests cover cooloff boundaries synthetically. The single M-07B authentication failure produced a sanitized 30-minute cooloff and no retry.',
  ),
  later(
    'PS-010',
    'User scope decision and separate authorization before product exposure',
    'Student search remains preserved pending product-scope approval.',
  ),
  later(
    'PS-011',
    'User scope decision and separate authorization before product exposure',
    'Scoresheet reads remain preserved pending product-scope approval.',
  ),

  contractTest(
    'CAL-001',
    ['test/architecture/boundaries.test.ts', 'test/ports/contracts.test.ts'],
    'M-03 canonical plan tests',
    'M-02 architecture and type tests keep the canonical plan free of Calendar authority and output fields.',
  ),
  contractTest(
    'CAL-002',
    [
      'src/contracts/v1/calendar.ts',
      'test/application/calendar/ownership-audit.test.ts',
      'test/application/calendar/writer-qualification.test.ts',
      'test/architecture/m13-calendar-audit-boundaries.test.ts',
      'test/architecture/m14-calendar-writer-boundaries.test.ts',
    ],
    'M-14 approved non-production live ownership/write qualification',
    'M-13 permits planning only for strong ownership or exact approved adoption. The bounded M-14 Auto Lesson 2 qualification re-read exact ownership before every mutation and completed rollback and cleanup with zero owned test events remaining.',
  ),
  contractTest(
    'CAL-003',
    [
      'test/contracts/v1/contracts.test.ts',
      'test/application/planning/calendar-intents.test.ts',
      'test/infrastructure/google-calendar/offline-writer-adapter.test.ts',
    ],
    'M-14 approved non-production live body/readback audit',
    'Desired-event tests and the injected-client adapter prove the exact admitted normalized fields, ownership markers, and simple provider body offline.',
  ),
  contractTest(
    'CAL-004',
    [
      'test/application/planning/calendar-intents.test.ts',
      'test/application/calendar/ownership-audit.test.ts',
      'test/application/calendar/writer-qualification.test.ts',
    ],
    'M-14 approved non-production live convergence and cleanup',
    'The Auto Lesson 2 gate proved create/replace/delete, injected-failure convergence, rollback, and empty cleanup. Its no-op was inert but provider-absent; the corrected seeded exact-owned no-op binding is proved offline and retains a later promotion disposition.',
  ),
  contractTest(
    'CAL-005',
    [
      'test/contracts/v1/contracts.test.ts',
      'test/infrastructure/google-calendar/offline-writer-adapter.test.ts',
    ],
    'M-14 approved non-production notification observation',
    'Intent contracts and every bounded live mutation fixed sendUpdates=none while excluding attendees and unsupported provider features; no attendee notification surface was admitted.',
  ),
  contractTest(
    'CAL-006',
    [
      'test/application/planning/calendar-intents.test.ts',
      'test/infrastructure/sqlite/repository.test.ts',
      'test/application/calendar/writer-qualification.test.ts',
      'test/entrypoints/m14-calendar-live-qualification.test.ts',
    ],
    'M-14 approved non-production replay/readback',
    'M-14 binds action mode, complete material configuration, approval window, source/build/dependency identity, and exact intent set to SHA-256 approvals; completed executions replay without provider access.',
  ),
  contractTest(
    'CAL-007',
    [
      'src/contracts/v1/operations.ts',
      'test/application/integration/read-only-gate.test.ts',
      'test/architecture/m10-read-only-integration-boundaries.test.ts',
    ],
    'M-14 writer tests',
    'M-10 fault-injects repair-required acquisition before enrichment and structurally has no Calendar capability or eligible intent.',
  ),
  contractTest(
    'CAL-008',
    [
      'test/contracts/v1/contracts.test.ts',
      'test/infrastructure/sqlite/repository.test.ts',
      'test/infrastructure/sqlite/continuity-import.test.ts',
      'test/infrastructure/sqlite/calendar-execution-state.test.ts',
    ],
    'M-14 approved non-production receipt/readback audit',
    'M-14 persists only bounded SHA-256 references, finite step states/outcomes, and sanitized error codes across restart; private provider content is absent.',
  ),
  contractTest(
    'CAL-009',
    [
      'docs/decisions/0006-parity-first-migration-and-single-writer.md',
      'test/application/calendar/lease-simulator.test.ts',
      'test/infrastructure/sqlite/calendar-execution-state.test.ts',
    ],
    'M-14 live process concurrency and M-17 cutover checks',
    'The durable M-14 SQLite mechanism proves one active scope lease, conflict, exact-owner release, expiry recovery, and restart persistence offline.',
  ),

  contractTest(
    'GC-001',
    [
      'test/architecture/boundaries.test.ts',
      'test/ports/contracts.test.ts',
      'test/architecture/m08-google-classroom-boundaries.test.ts',
      'test/architecture/m10-read-only-integration-boundaries.test.ts',
    ],
    'M-11 shadow evidence',
    'M-08 fixes one official read operation and least-privilege scope; protected M-10 evidence used only read-source capability and recorded zero source mutations.',
  ),
  contractTest(
    'GC-002',
    [
      'test/fixtures/m03-legacy-golden.ts',
      'test/domain/enrichment-content.test.ts',
      'test/infrastructure/google-classroom/adapter.test.ts',
      'test/application/integration/read-only-gate.test.ts',
    ],
    'M-11 shadow evidence',
    'M-03 and M-08 prove meeting-date-relative normalized windows, order, caps, filters, and complete visible fields; protected M-10 evidence composed the same enrichment contract for three current C509 courses.',
  ),
  contractTest(
    'GC-003',
    [
      'test/application/classroom/refresh.test.ts',
      'test/architecture/m08-google-classroom-boundaries.test.ts',
      'test/application/integration/read-only-gate.test.ts',
    ],
    'M-10 configured live resource evidence and M-11 shadow latency',
    'M-08 keeps bounded refresh off the TV path and proves backoff; M-10 composes its cache retention and abort behavior.',
  ),
  contractTest(
    'GC-004',
    [
      'test/domain/enrichment-content.test.ts',
      'test/infrastructure/sqlite/classroom-cache.test.ts',
      'test/application/integration/read-only-gate.test.ts',
    ],
    'M-11 shadow evidence',
    'M-03 accepts only matching fresh enrichment, M-08 validates normalized cache freshness, and protected M-10 evidence recorded three fresh and zero stale or missing cache entries.',
  ),
  contractTest(
    'GC-005',
    [
      'test/domain/enrichment-content.test.ts',
      'test/infrastructure/google-classroom/adapter.test.ts',
      'test/application/integration/read-only-gate.test.ts',
    ],
    'M-11 shadow evidence',
    'M-08 rejects missing or unsafe mappings independently; protected M-10 evidence joined each Tuesday C509 PowerSchool code to one unique numeric Classroom mapping through its embedded section token.',
  ),
  contractTest(
    'GC-006',
    [
      'test/application/classroom/refresh.test.ts',
      'test/infrastructure/google-classroom/official-client.test.ts',
      'test/application/integration/read-only-gate.test.ts',
    ],
    'M-11 shadow evidence',
    'M-08 proves bounded ordered partial-failure execution and sanitized provider errors; protected M-10 evidence refreshed all three current mappings while retaining degraded and repair-required classifications.',
  ),
  later(
    'GC-007',
    'User product-scope decision before implementing unrelated Google reads',
    'ADR-0011 resolves only the Classroom coursework capability; unrelated Gmail, Drive, Docs, Sheets, Slides, and Forms reads remain preserved but unresolved under U-001.',
  ),

  contractTest(
    'PLAN-001',
    [
      'test/domain/plan-state.test.ts',
      'test/application/planning/calendar-intents.test.ts',
      'test/application/integration/read-only-gate.test.ts',
    ],
    'M-11 shadow evidence',
    'M-03 derives ordered canonical plans and rejects invalid, stale, or unmapped input; protected M-10 evidence planned three current C509 meetings while the offline manifest retains multi-room, no-class, stale, and mapping-gap cases.',
  ),
  contractTest(
    'PLAN-002',
    'test/domain/plan-state.test.ts',
    'M-05 route isolation tests',
    'M-03 proves strict room and screen projection isolation.',
  ),
  contractTest(
    'PLAN-003',
    'test/domain/plan-state.test.ts',
    'M-05 fake-clock rendering tests',
    'M-03 derives and tests exact check-in, content, dismissal, and end boundaries.',
  ),
  contractTest(
    'PLAN-004',
    ['test/contracts/v1/contracts.test.ts', 'test/domain/plan-state.test.ts'],
    'M-05 visual state suite',
    'M-03 implements all eight states with minus/equal/plus boundary coverage.',
  ),
  contractTest(
    'PLAN-005',
    'test/domain/plan-state.test.ts',
    'M-05 visual transition tests',
    'M-03 covers hidden check-in at the first class and between classes.',
  ),
  contractTest(
    'PLAN-006',
    'test/domain/plan-state.test.ts',
    'M-05 day-complete rendering tests',
    'M-03 covers Tomorrow, Friday Next Week, gaps, no-next, and cross-screen exclusion.',
  ),
  contractTest(
    'PLAN-007',
    [
      'test/domain/plan-state.test.ts',
      'test/application/integration/read-only-gate.test.ts',
      'test/architecture/m10-read-only-integration-boundaries.test.ts',
    ],
    'U-011 decision and M-10 read-only fallback comparison',
    'M-03 keeps fallbacks disabled by default and explicitly unverified when enabled; M-10 constructs no Calendar capability and does not silently add a fallback. Long-term policy remains unresolved.',
  ),

  contractTest(
    'CONTENT-001',
    [
      'test/domain/enrichment-content.test.ts',
      'test/application/persistence/continuity-importer.test.ts',
      'test/infrastructure/sqlite/repository.test.ts',
    ],
    'M-05 rendering tests',
    'M-03 resolves both nesting forms and M-04 allowlists, versions, and round-trips scoped content.',
  ),
  contractTest(
    'CONTENT-002',
    'test/domain/enrichment-content.test.ts',
    'M-05 card rendering and duration tests',
    'M-03 card normalization preserves type, accent, lines, details, featured text, due information, and optional duration.',
  ),
  contractTest(
    'CONTENT-003',
    'test/domain/enrichment-content.test.ts',
    'M-05 objective rendering tests',
    'Fresh coursework generates grouped objectives before eligible static/date cards; stale coursework removes only documented card types.',
  ),
  contractTest(
    'CONTENT-004',
    'test/domain/enrichment-content.test.ts',
    'M-05 compacted objective visual tests',
    'M-03 pins the first-two-sentence limit, special rewrite, Classroom follow-up wording, featured title, unit focus, and due detail.',
  ),
  contractTest(
    'VOC-001',
    [
      'test/fixtures/m03-legacy-golden.ts',
      'test/domain/enrichment-content.test.ts',
    ],
    'M-04 vocabulary import tests',
    'M-03 ports source-priority de-duplication, context/CodeHS scoring, focused pools, and deterministic rotation.',
  ),
  contractTest(
    'VOC-002',
    [
      'test/domain/enrichment-content.test.ts',
      'test/application/persistence/continuity-importer.test.ts',
      'test/infrastructure/sqlite/repository.test.ts',
    ],
    'M-05 display integration tests',
    'M-03 defines same-meeting reuse and history behavior; M-04 separately persists allowlisted selection and history records.',
  ),

  contractTest(
    'ATT-001',
    [
      'test/domain/enrichment-content.test.ts',
      'test/application/display/controller.test.ts',
    ],
    'Later authorized comparison if required',
    'M-09 applies M-03 link validation consistently to target, preview, and QR paths while preserving all modeled link fields.',
  ),
  contractTest(
    'ATT-002',
    [
      'test/domain/enrichment-content.test.ts',
      'test/application/display/controller.test.ts',
      'test/app/mvp-server.test.ts',
    ],
    'Later authorized comparison if required',
    'M-09 preserves validated direct-over-wrapper precedence and only the evidenced check-in compatibility redirect; unknown aliases remain quarantined.',
  ),
  contractTest(
    'ATT-003',
    [
      'test/domain/enrichment-content.test.ts',
      'test/application/display/controller.test.ts',
      'test/presentation/html.test.ts',
    ],
    'M-09 live-safe attendance contract validation',
    'M-05 renders synthetic scoped QR/link and attendance summary data while preserving M-03 missing-versus-zero behavior.',
  ),
  contractTest(
    'ATT-004',
    [
      'test/application/display/qr-png.test.ts',
      'test/app/mvp-server.test.ts',
      'test/infrastructure/http/server.test.ts',
    ],
    'M-09 live-safe attendance scope validation',
    'M-05 generates a local PNG only after fixture plan/date/screen/meeting scope resolves; wrong scopes return not-found.',
  ),
  contractTest(
    'ATT-005',
    ['test/infrastructure/http/server.test.ts', 'test/app/mvp-server.test.ts'],
    'Later authorized comparison if required',
    'M-09 preserves bounded class/current/diagnostic route shapes, the evidenced check-in redirect, and not-found behavior for unsupported aliases using synthetic contracts only.',
  ),
  contractTest(
    'ATT-006',
    [
      'test/domain/attendance-matrix.test.ts',
      'test/architecture/m09-attendance-boundaries.test.ts',
    ],
    'Later authorized comparison if required',
    'M-09 proves a bounded transient roster-first complete P/T/A matrix while preventing learner rows from entering persistence or HTTP modules.',
  ),

  contractTest(
    'PRE-001',
    [
      'test/application/read-only/composition.test.ts',
      'test/application/display/controller.test.ts',
      'test/presentation/html.test.ts',
    ],
    'Production fixture comparison before cutover',
    'M-05 exposes the loaded-date synthetic preview, original/effective plan evidence, timeline, diagnostics, override, and rendered target.',
  ),
  contractTest(
    'PRE-002',
    'test/app/mvp-server.test.ts',
    'Production clock validation before cutover',
    'M-05 accepts pinned instants only on the explicit preview route/mode; normal display/target reads use the injected fixture clock.',
  ),
  contractTest(
    'PRE-003',
    [
      'test/architecture/boundaries.test.ts',
      'test/application/read-only/composition.test.ts',
      'test/application/display/controller.test.ts',
    ],
    'Production adapter mutation-spy validation',
    'M-02 structurally excludes writers, M-03 mutation spies remain at zero, and M-05 verifies preview does not write plans, overrides, holds, or proposed values.',
  ),

  contractTest(
    'OVR-001',
    [
      'test/domain/enrichment-content.test.ts',
      'test/application/persistence/continuity-importer.test.ts',
      'test/infrastructure/sqlite/repository.test.ts',
    ],
    'Production authorization and reload validation',
    'M-05 adds authenticated route coverage and SQLite reload/cross-screen isolation to the M-03/M-04 precedence and scope contract.',
  ),
  contractTest(
    'OVR-002',
    'test/domain/enrichment-content.test.ts',
    'Production fixture comparison before cutover',
    'M-05 transports and renders the M-03 announcement, append/replace, assignment hiding, dismissal, and simulator semantics.',
  ),
  invariant(
    'OVR-003',
    'docs/architecture-principles.md#10-screens-and-rooms-are-isolated-first-class-entities',
    'Named-operator decision remains later',
    'M-05 route tests require bounded scope and a constant-time bearer check while reads remain separate.',
  ),

  contractTest(
    'DISP-001',
    ['test/app/mvp-server.test.ts', 'test/infrastructure/http/server.test.ts'],
    'M-17 production route smoke check',
    'M-05 maps repository-only /, /tv, and /b407 compatibility aliases to the isolated B407 screen; private production routing remains later.',
  ),
  visual(
    'DISP-002',
    [
      'visual-morning-overview',
      'visual-idle',
      'visual-pre-checkin',
      'visual-in-class-content',
      'visual-dismissal-warning',
      'visual-post-end',
      'visual-day-complete',
    ],
    'Later user review and production visual approval',
    'M-05 Chrome 150 evidence records all eight 1920x1080 states with clocks, labels, countdowns, no overflow, and agent inspection; human and production approval remain later.',
  ),
  contractTest(
    'DISP-003',
    [
      'test/contracts/v1/contracts.test.ts',
      'test/presentation/assets-client.test.ts',
    ],
    'M-05 recorded recovery interaction and later production observation',
    'M-05 implements the frozen timeout/cadence/exponential-cap contract with last-good retention and source-level fake evidence.',
  ),
  visual(
    'DISP-004',
    ['visual-in-class-content'],
    'Later production carousel comparison',
    'M-05 Chrome evidence records the carousel controls with bounded hit targets; executable tests cover reveal-aware timing, swipe, pause/resume, single-card guards, and meeting-change reset.',
  ),
  contractTest(
    'DISP-005',
    'test/presentation/assets-client.test.ts',
    'Production browser comparison before cutover',
    'M-05 preserves client-local pause across same-meeting polls and resets it on meeting change while adding the separate server hold.',
  ),
  contractTest(
    'DISP-006',
    'test/infrastructure/sqlite/repository.test.ts',
    'Production authorization and reload validation',
    'M-05 adds authenticated HTTP/operator controls and fixture reload/screen isolation to M-04 plan-bound revisioned hold lifecycle persistence.',
  ),
  visual(
    'DISP-007',
    [
      'visual-in-class-content:objective',
      'visual-in-class-content:bellringer',
      'visual-in-class-content:vocabulary',
    ],
    'Later production viewport confirmation',
    'M-05 Chrome evidence records zero horizontal or vertical kiosk overflow at 1920x1080 and zero horizontal operator overflow at an effective 200% reflow viewport.',
  ),
  visual(
    'DISP-008',
    [
      'visual-morning-overview',
      'visual-no-classes',
      'visual-dismissal-warning',
      'visual-day-complete',
    ],
    'Later user and production visual approval',
    'M-05 Chrome evidence records and agent-inspects distinct full-screen and standard shells for all eight named cases at 1920x1080.',
  ),
  visual(
    'DISP-009',
    ['visual-in-class-content', 'visual-dismissal-warning'],
    'Later production network observation',
    'M-05 Chrome evidence records no external or unexpected requests, broken assets, or console/runtime errors while loading repository-owned assets under the self-only CSP.',
  ),

  contractTest(
    'HTTP-001',
    [
      'test/contracts/v1/contracts.test.ts',
      'test/infrastructure/http/server.test.ts',
      'test/app/mvp-server.test.ts',
    ],
    'M-17 production route smoke check',
    'M-05 implements every frozen route family plus safe attendance compatibility routes through an injected loopback controller.',
  ),
  contractTest(
    'HTTP-002',
    'test/infrastructure/http/server.test.ts',
    'Production proxy/header validation',
    'M-05 tests GET/HEAD/mutation methods, Allow responses, no-store dynamic content, and immutable versioned resources.',
  ),
  contractTest(
    'HTTP-003',
    'test/infrastructure/http/server.test.ts',
    'Production process-manager shutdown rehearsal',
    'M-05 tests defensive headers, bounded deadlines, generic errors, explicit loopback binding, and idempotent bounded shutdown.',
  ),
  contractTest(
    'MEDIA-001',
    [
      'test/infrastructure/http/server.test.ts',
      'test/app/mvp-media.test.ts',
      'test/app/mvp-server.test.ts',
    ],
    'Production asset/package validation',
    'ADR-0023 preserves the local media routes and browser fallback while the public distribution omits playable video; optional site-owned MP4 bytes require an exact external path, size, signature, and SHA-256 binding.',
  ),
  visual(
    'MEDIA-002',
    [
      'visual-dismissal-warning:local-media-ready',
      'visual-dismissal-warning:local-media-delayed',
    ],
    'Later production media observation',
    'M-12 Chrome evidence records both exact legacy 1280x720 MP4 layers at readyState 4 with the expected 8-second duration; executable tests cover delayed fallback and crossfade behavior.',
  ),

  contractTest(
    'HEALTH-001',
    [
      'test/application/display/controller.test.ts',
      'test/app/mvp-server.test.ts',
    ],
    'M-06 production dependency expansion',
    'M-05 reports fixture/LKG degradation; ADR-0023 keeps screen-plan readiness authoritative while optional missing media degrades to the repository-owned poster.',
  ),
  contractTest(
    'HEALTH-002',
    [
      'test/infrastructure/sqlite/repository.test.ts',
      'test/infrastructure/sqlite/migrations.test.ts',
      'test/infrastructure/sqlite/classroom-cache.test.ts',
      'test/application/integration/read-only-gate.test.ts',
    ],
    'M-10 configured live cache evidence and M-11 readiness presentation',
    'M-04 validates serialization-safe state and recovery. M-08 preserves normalized last-known-good Classroom cache after failure, and M-10 records retained stale state without provider identity output.',
  ),
  contractTest(
    'HEALTH-003',
    'test/domain/operations/health.test.ts',
    'M-11 shadow observations and production dependency evidence',
    'M-06 validates the complete redacted observation/report contract, stable issue ordering and scope-only fingerprints, hostile input rejection, and healthy/degraded/unhealthy synthetic cases.',
  ),
  contractTest(
    'ALERT-001',
    [
      'test/domain/operations/alerts.test.ts',
      'test/application/operations/alerts.test.ts',
      'test/infrastructure/sqlite/operations-state.test.ts',
    ],
    'Accepted transport policy and separately authorized delivery evidence',
    'M-06 proves new/unchanged/repeat/recovery/mixed/no-send decisions, restart-safe checkpoints, fake delivery, and failure that preserves the last successful fingerprint set. No live transport is selected.',
  ),

  contractTest(
    'PERSIST-001',
    [
      'test/infrastructure/sqlite/migrations.test.ts',
      'test/infrastructure/sqlite/repository.test.ts',
      'test/infrastructure/sqlite/backup.test.ts',
    ],
    'M-06 operational backup scheduling and M-17 restore rehearsal',
    'M-04 proves immediate transactions, checksummed-ledger/user-version agreement, validated generated metadata, payload-verified semantic no-ops, promise-like callback rollback, integrity-checked backup/restore, catalog-plus-byte-verified pruning, and canonical-instant retention helpers using synthetic temporary databases.',
  ),
  contractTest(
    'PERSIST-002',
    [
      'test/application/persistence/continuity-importer.test.ts',
      'test/application/persistence/attendance-continuity.test.ts',
      'test/infrastructure/sqlite/continuity-import.test.ts',
      'test/infrastructure/sqlite/attendance-continuity.test.ts',
    ],
    'Separately authorized safe-export reconciliation if requested',
    'M-09 adds whole-record attendance quarantine, explicit provenance, count-only reconciliation, and repeatable disposable-SQLite evidence; no legacy database or export is opened.',
  ),
  contractTest(
    'PERSIST-003',
    [
      '.gitignore',
      'test/application/persistence/continuity-importer.test.ts',
      'test/infrastructure/sqlite/backup.test.ts',
      'test/application/integration/read-only-gate.test.ts',
      'test/architecture/m10-read-only-integration-boundaries.test.ts',
    ],
    'M-10 configured live sensitive-data scan and M-11 state audit',
    'Finite schemas, forbidden-material checks, confined paths, and M-10 value-free result surfaces keep sensitive/runtime material outside Git and persisted state.',
  ),

  invariant(
    'OPS-001',
    'test/operations/systemd-templates.test.mjs',
    'M-11 isolated lifecycle and M-17 activation evidence',
    'M-06 statically verifies a hardened loopback service placeholder and separates the long-running process from bounded jobs; no service is installed or operated.',
  ),
  invariant(
    'OPS-002',
    'test/operations/systemd-templates.test.mjs',
    'U-003 inventory and approved clock/timezone evidence before activation',
    'M-06 preserves exact workflow names and prerequisite ordering while every timer remains inert and pending. M-07B records the future standalone Sunday-through-Friday 07:20 Asia/Ho_Chi_Minh requirement without implementing scheduling.',
  ),
  contractTest(
    'OPS-003',
    [
      'test/application/operations/registry.test.ts',
      'test/application/operations/runner.test.ts',
      'test/entrypoints/job.test.ts',
    ],
    'M-11 isolated lifecycle evidence',
    'M-06 provides finite exact-name dispatch, bounded deadlines, exhaustive results, redacted run-ledger writes, and usage rejection before configuration or filesystem access.',
  ),
  later(
    'OPS-004',
    'M-16 cutover/rollback rehearsal',
    'Operational switching is outside M-01 and requires separate authorization.',
  ),
  contractTest(
    'OPS-005',
    'test/domain/operations/briefs.test.ts',
    'U-015 content/destination/delivery characterization',
    'M-06 preserves distinct minimal redacted morning and next-configured-class-day evening contracts without guessing schedule dates; executable evening delivery remains skipped pending characterization.',
  ),

  invariant(
    'SEC-001',
    'docs/decisions/0004-separate-sensitive-and-runtime-state.md',
    'Named-operator decision and production auth audit',
    'M-05 separates reads from constant-time bearer-authorized mutations, supports read-only startup, and keeps authority out of URLs, bodies, storage, and errors.',
  ),
  contractTest(
    'SEC-002',
    [
      'test/fixtures/m03-legacy-golden.ts',
      'test/scripts/fixture-safety.test.mjs',
      'test/ports/contracts.test.ts',
      'test/infrastructure/http/server.test.ts',
    ],
    'Production proxy/path audit',
    'M-05 adds bounded request/body/query/path parsing, closed resources, traversal refusal, and redacted envelopes to existing fixture and command safety.',
  ),
  invariant(
    'NET-001',
    'test/operations/systemd-templates.test.mjs',
    'M-16 redacted route audit and M-17 cutover',
    'The accepted topology remains loopback plus Tailnet-only routing.',
  ),
  later(
    'NET-002',
    'U-004 redacted route audit and M-17 URL smoke comparison',
    'The private TV URL is deliberately not recorded.',
  ),
  invariant(
    'DEP-001',
    'test/architecture/m06-boundaries.test.ts',
    'M-18 dependency scan',
    'M-06 runtime boundaries contain no OpenClaw, provider, HTTP, arbitrary-command, or Calendar-writer dependency; final host retirement proof remains M-18.',
  ),

  later(
    'U-001',
    'User scope decision before exposing PS-010/PS-011 or GC-007',
    'General read capabilities remain preserved and unresolved.',
  ),
  invariant(
    'U-002',
    'docs/decisions/0015-aggregate-attendance-continuity.md',
    'Separately authorized safe-export comparison if requested',
    "The user accepted M-09's aggregate-only continuity and transient-matrix contract without inspecting submissions or raw student data.",
  ),
  later(
    'U-003',
    'Exact isolated candidate timer/offset manifest before M-17 activation and a separate final-handoff approval',
    'ADR-0022 keeps legacy schedules authoritative during the canary and requires distinct staggered candidate timers.',
  ),
  later(
    'U-004',
    'Exact candidate-only Tailnet target and legacy-route deny fingerprint before M-17 activation',
    'ADR-0022 keeps the private legacy route and normal Fully URL unchanged during the canary.',
  ),
  invariant(
    'U-005',
    'docs/decisions/0016-calendar-read-identity-and-ownership.md',
    'Repeat the hash-bound ownership audit for the exact M-15 production trial window',
    'Promoted M-13 records user-approved hash-bound dispositions for exactly three Tuesday candidates. Unmarked events on other dates remain unowned and require their own bounded audit and approval.',
  ),
  invariant(
    'U-006',
    'docs/decisions/0010-direct-powerschool-auth-adapter.md',
    'M-07B separately authorized read-only characterization',
    'ADR-0010 accepts exact playwright-core with installed Chrome, protected external profiles, same-origin GET-first reads, browser fallback, and separate explicit repair based only on the M-07A synthetic spike.',
  ),
  later(
    'U-007',
    'Approve and verify the exact secondary Calendar plus primary/legacy deny fingerprints before M-17 activation; approve its final disposition before handoff',
    'ADR-0022 permits a canary only on a manually created secondary owned Calendar and grants no calendar-creation or live operational authority.',
  ),
  later(
    'U-008',
    'Keep candidate alerts report-only; require a separate final-handoff approval for routine delivery',
    'ADR-0012 transport is qualified, but ADR-0022 prevents duplicate or ambiguous Telegram notifications during the canary.',
  ),
  later(
    'U-009',
    'User approves the active-school-day canary duration before activation and M-18 stabilization metrics before retirement',
    'ADR-0013 fixes the four-hour final-handoff RTO; ADR-0022 makes canary acceptance coverage-based while leaving its exact duration open.',
  ),
  later(
    'U-010',
    'User review and production browser/viewport confirmation before promotion',
    'M-05 records sanitized agent-inspected Chrome evidence at the provisional large-TV and laptop viewports; human and production acceptance remain unresolved.',
  ),
  later(
    'U-011',
    'User decision before M-10 fallback promotion',
    'Calendar/local fallback remains transitional and unverified.',
  ),
  later(
    'U-012',
    'Redacted mapping inventory and user rollout decision before M-12/M-17',
    'Synthetic multi-screen modeling does not assert which real rooms are active.',
  ),
  invariant(
    'U-013',
    'docs/decisions/0013-state-retention-and-recovery.md',
    'M-06/M-17 operational recovery evidence',
    'Accepted policy sets 14 daily and 8 weekly backups, four-hour RTO, 24-hour RPO, and category-specific state retention; M-04 proves only synthetic hooks.',
  ),
  later(
    'U-014',
    'User identity decision before M-05 operator-write activation',
    'The legacy bearer-token model is neither accepted nor replaced here.',
  ),
  later(
    'U-015',
    'Safe source/fixture characterization before M-06',
    'Morning and evening brief content/delivery behavior remains unresolved.',
  ),
];
