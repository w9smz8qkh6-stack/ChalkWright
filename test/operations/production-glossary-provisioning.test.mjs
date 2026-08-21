import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import test from 'node:test';

import { buildProductionGlossaryPayload } from '../../scripts/operations/provision-production-glossary.mjs';

const driveScope = 'https://www.googleapis.com/auth/drive.readonly';

test('builds protected production glossary payloads without widening Drive scope', () => {
  const credential = {
    version: 1,
    type: 'authorized-user',
    clientId: 'client-id-123.apps.googleusercontent.com',
    clientSecret: 'client-secret-123',
    refreshToken: 'refresh-token-123',
    scopes: [driveScope],
  };
  const payload = buildProductionGlossaryPayload(
    {
      version: 1,
      academicYear: '2026-27',
      academicYearFolderId: 'year-folder-123',
      requestTimeoutSeconds: 15,
      maximumPagesPerSource: 3,
      maximumFilesPerCourse: 20,
      courses: [
        {
          classId: 'web-design-a',
          subject: 'Web Design',
          courseName: 'Web Design',
          defaultLanguage: 'en',
        },
      ],
    },
    credential,
  );
  assert.equal(
    payload.config.credentialReferencePath,
    '/etc/chalkwright/production/providers/google-drive/authorized-user.json',
  );
  assert.deepEqual(payload.credential.scopes, [driveScope]);
  assert.deepEqual(Object.keys(payload.environment).sort(), [
    'CLASSROOM_HUB_GLOSSARY_CONFIG_REFERENCE',
    'CLASSROOM_HUB_PRODUCTION_CONFIG_REFERENCE',
  ]);
});

test('production sudo policy pins the glossary provisioning controller', () => {
  const controller = readFileSync(
    'scripts/operations/provision-production-glossary.mjs',
    'utf8',
  );
  const policy = readFileSync(
    'scripts/operations/install-chalkwright-production-sudo-policy.sh',
    'utf8',
  );
  const digest = createHash('sha256').update(controller).digest('hex');
  assert.match(
    policy,
    new RegExp(`^glossary_provision_digest=${digest}$`, 'mu'),
  );
  assert.match(policy, /chalkwright-production-admin provision-glossary/u);
});
