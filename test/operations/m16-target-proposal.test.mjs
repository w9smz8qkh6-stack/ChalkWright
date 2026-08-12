import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const proposalPath = 'docs/migration/m16-target-proposal.json';

test('freezes only the approved inert M-16 target proposal and explicit unknowns', () => {
  const text = readFileSync(proposalPath, 'utf8');
  const proposal = JSON.parse(text);
  assert.deepEqual(Object.keys(proposal).sort(), [
    'alertDelivery',
    'cadence',
    'classroomEnrichment',
    'display',
    'livePreflight',
    'maintenance',
    'operatorRoles',
    'preparedOn',
    'retainedDisabled',
    'schedulerPolicy',
    'schemaVersion',
    'status',
    'timeZone',
    'unresolved',
  ]);
  assert.equal(proposal.schemaVersion, 4);
  assert.equal(proposal.status, 'approved-inert-target');
  assert.equal(proposal.timeZone, 'Asia/Ho_Chi_Minh');
  assert.deepEqual(proposal.display, {
    canonicalRoom: 'C509',
    canonicalScreen: 'screen-c509-production',
    compatibilityAlias: 'b407',
    routePath: '/classroom-screen',
    candidateLoopbackPort: 4317,
    candidateService: 'classroom-hub-production.service',
    candidateServiceTemplate: 'systemd/classroom-hub.service.in',
    validatedBrowser: 'Google Chrome 150.0.7871.114',
    validatedViewports: ['3840x2160', '1920x1080', '1366x768'],
    physicalKiosk: {
      device: 'Hikvision DS-D5C75RB/A interactive flat panel',
      computer: 'built-in Android computer',
      hostRelationship: 'not the Ubuntu server',
      kioskBrowser: 'Fully Kiosk Browser 1.60.1-play',
      documentedNativeOutput: '3840x2160@60Hz',
      renderingEngine:
        'Android WebView; installed provider/version unavailable and not inferred',
      cssViewport:
        'runtime-dependent; bounded by three-viewport offline envelope and on-device pre-cutover smoke',
    },
  });
  assert.deepEqual(proposal.maintenance, {
    window: '18:00-20:00',
    timeZone: 'Asia/Ho_Chi_Minh',
    selectionBasis: 'user-approved reasonable outside-class-hours window',
    stopConditions: [
      'class-or-next-class-state-active',
      'replacement-readiness-failed',
      'backup-or-rollback-readiness-failed',
      'operator-unavailable',
    ],
  });
  assert.deepEqual(proposal.livePreflight, {
    observedOn: '2026-08-12',
    route: {
      status: 'read-only-observed-no-change',
      listenerHash:
        'sha256:5223574a7a0952b74f3d067cb205f37abbd2c798c04158b6caf21f849716e706',
      path: '/classroom-screen',
      backendScheme: 'http',
      backendLoopbackPort: 20790,
      backendPath: '/',
      backendHash:
        'sha256:7375ae4af3c04c9bfc2324dad324a6c11bc1fe9e430738c5d8f638a3c5493014',
      ownerUnit: 'classroom-screen.service',
      funnelAllowed: false,
      statusOnlyProbes: [
        '/:200',
        '/classroom-screen:200',
        '/health:200',
        '/ready:200',
      ],
    },
    productionProvisioning: {
      status: 'inert-core-provisioned-alert-deferred',
      serviceIdentity: 'classroom-hub',
      serviceIdentityPresent: true,
      protectedFilesCreated: 5,
      corePaths: [
        '/etc/classroom-hub/server',
        '/etc/classroom-hub/jobs',
        '/etc/classroom-hub/providers/google-classroom',
        '/etc/classroom-hub/operator',
        '/var/lib/classroom-hub/production',
        '/var/lib/classroom-hub/powerschool-session',
        '/opt/classroom-hub',
      ],
      protectedReferenceClasses: [
        'server-config',
        'plan-environment',
        'classroom-environment',
        'classroom-read-grant',
        'operator-authority',
      ],
      deferredPaths: ['/etc/classroom-hub/providers/alert-delivery'],
      runtimeArchiveSha256:
        'sha256:cc73d49e1a3aebfa6bda62375c1955167096cee34b8d82c082773ec02f0aef53',
      provisioningEvidenceSha256:
        'sha256:f44cc79292695d89fd52b214f3fee629d5792ed51996cc132008952a68018494',
      runtimeExtracted: false,
      productionUnitsInstalled: false,
    },
  });
  assert.deepEqual(
    proposal.cadence.map(
      ({ role, legacySchedule, acceptedReplacementSchedule }) => ({
        role,
        legacySchedule,
        ...(acceptedReplacementSchedule === undefined
          ? {}
          : { acceptedReplacementSchedule }),
      }),
    ),
    [
      {
        role: 'powerschool-refresh',
        legacySchedule: '20 6 * * 1-5',
        acceptedReplacementSchedule:
          'Sun,Mon,Tue,Wed,Thu,Fri at 07:20:00 Asia/Ho_Chi_Minh; Saturday excluded',
      },
      { role: 'morning-brief', legacySchedule: '30 6 * * 1-5' },
      { role: 'daily-schedule-brief', legacySchedule: '45 6 * * 1-5' },
      { role: 'health-alert', legacySchedule: 'every-30-minutes' },
    ],
  );
  assert.deepEqual(proposal.retainedDisabled, [
    'legacy-calendar-sync',
    'legacy-evening-brief',
    'legacy-duplicate-health',
  ]);
  assert.deepEqual(proposal.classroomEnrichment, {
    status: 'legacy-policy-user-authorized',
    trigger: 'active-class-asynchronous',
    triggerStates: ['pre_checkin', 'in_class_content'],
    evaluationIntervalSeconds: 30,
    successfulRefreshThrottleSeconds: 30,
    failureBackoffSeconds: [60, 120, 240, 480, 900],
    failureBackoffMaximumSeconds: 900,
    cacheOnFailure: 'retain-last-known-good',
    displayRequestBlocking: false,
    refreshScope: 'exact-active-mapped-class-only',
    replacementAuthority: 'isolated-read-only-worker',
    triggerImplementation: 'offline-qualified-unwired',
  });
  assert.deepEqual(proposal.schedulerPolicy, {
    status: 'accepted-inert-policy',
    wallClockMissedRun: 'do-not-catch-up; use-next-scheduled-evaluation',
    healthAlertRetry: 'next-30-minute-evaluation; no-burst-catch-up',
    calendarRetry:
      'no-automatic-provider-retry; journal-aware-preflight-and-convergence-only',
  });
  assert.deepEqual(proposal.alertDelivery, {
    status: 'accepted-offline-qualified-unwired',
    providerHost: 'api.telegram.org',
    operation: 'sendMessage',
    evaluationIntervalSeconds: 1800,
    repeatSeconds: 21600,
    requestTimeoutSeconds: 10,
    automaticRetries: 0,
    protectContent: true,
    authority: 'two-separate-owner-only-external-value-files',
    messageContent: 'redacted-kind-counts-and-evaluated-instant',
  });
  assert.deepEqual(Object.keys(proposal.unresolved).sort(), [
    'alertDeliveryProvisioning',
    'authenticationRepairLiveGate',
    'classroomRefreshTriggerWiring',
  ]);
  assert.doesNotMatch(
    text,
    /(?:credential|oauth|token|secret|refresh[_-]?token|private[_-]?key|tail\d+|\.ts\.net|\/home\/|\/srv\/|jobId)/iu,
  );
});
