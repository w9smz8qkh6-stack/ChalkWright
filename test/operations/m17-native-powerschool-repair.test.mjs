import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

import {
  renderRepairEnvironment,
  validateRepairReferences,
  validateServiceAccount,
} from '../../scripts/operations/provision-m17-powerschool-repair.mjs';

test('renders only fixed Chalkwright-owned repair paths', () => {
  const rendered = renderRepairEnvironment();
  assert.match(rendered, /canary-powerschool-compatibility-profile/u);
  assert.match(rendered, /canary\/providers\/powerschool\/repair-references/u);
  assert.match(rendered, /canary\/providers\/powerschool\/onepassword/u);
  assert.doesNotMatch(rendered, /openclaw|legacy|\/home\//iu);
});

test('accepts only three distinct exact 1Password references', () => {
  const valid = {
    version: 1,
    usernameReference: 'op://vault/item/username',
    passwordReference: 'op://vault/item/password',
    totpReference: 'op://vault/item/otp?attribute=otp',
  };
  assert.deepEqual(validateRepairReferences(valid), valid);
  for (const invalid of [
    { ...valid, extra: true },
    { ...valid, passwordReference: valid.usernameReference },
    { ...valid, totpReference: 'op://vault/item/otp' },
    { ...valid, usernameReference: '/home/operator/secret' },
  ])
    assert.throws(
      () => validateRepairReferences(invalid),
      /m17-repair-provision-references-invalid/u,
    );
});

test('repair service is operator-only and retained-session plan reads receive no repair authority', () => {
  const unit = readFileSync(
    'systemd/m17/chalkwright-canary-powerschool-repair.service.in',
    'utf8',
  );
  const plan = readFileSync(
    'systemd/m17/chalkwright-canary-plan-refresh.service.in',
    'utf8',
  );
  assert.match(unit, /m17-powerschool-repair\.js/u);
  assert.match(
    unit,
    /CLASSROOM_HUB_POWERSCHOOL_IDENTITY_ORIGIN=https:\/\/accounts\.google\.com/u,
  );
  assert.match(unit, /-\/etc\/chalkwright\/canary\/operator/u);
  assert.match(unit, /-\/var\/lib\/chalkwright\/canary-production/u);
  assert.doesNotMatch(unit, /\[Install\]|\.timer|ExecCondition=/u);
  assert.doesNotMatch(plan, /powerschool-repair|onepassword|jit/iu);
  assert.match(plan, /production-retained-plan-refresh\.js/u);
  assert.match(
    plan,
    /CLASSROOM_HUB_POWERSCHOOL_IDENTITY_ORIGIN=https:\/\/accounts\.google\.com/u,
  );
  assert.match(
    plan,
    /ReadWritePaths=.*canary-powerschool-compatibility-profile/u,
  );
  assert.match(plan, /InaccessiblePaths=.*providers\/powerschool/u);
});

test('accepts only one dedicated 1Password service-account assignment', () => {
  assert.doesNotThrow(() =>
    validateServiceAccount(
      Buffer.from(`OP_SERVICE_ACCOUNT_TOKEN=ops_${'a'.repeat(40)}\n`, 'utf8'),
    ),
  );
  for (const invalid of [
    `OTHER_SECRET=ops_${'b'.repeat(40)}\nOP_SERVICE_ACCOUNT_TOKEN=ops_${'a'.repeat(40)}\n`,
    `OP_SERVICE_ACCOUNT_TOKEN=ops_${'a'.repeat(40)}\nEXTRA=value\n`,
    `OP_SERVICE_ACCOUNT_TOKEN=ops_${'a'.repeat(40)}\nOP_SERVICE_ACCOUNT_TOKEN=ops_${'b'.repeat(40)}\n`,
  ])
    assert.throws(
      () => validateServiceAccount(Buffer.from(invalid, 'utf8')),
      /m17-repair-provision-service-account-invalid/u,
    );
});
