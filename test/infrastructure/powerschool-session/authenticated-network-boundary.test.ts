import assert from 'node:assert/strict';
import test from 'node:test';

import {
  classifyBlockedResourceOrigin,
  isAllowedBrowserResourceMethod,
  isPowerSchoolSameSiteResourceOrigin,
} from '../../../src/infrastructure/powerschool-session/authenticated-network-boundary.js';

const powerSchoolOrigin = 'https://teachers.school.example.co.uk';

test('classifies a blocked resource without retaining its URL', () => {
  const cases = [
    ['https://fonts.googleapis.com', 'resource-origin-blocked-google-font-css'],
    [
      'https://accounts.gstatic.com',
      'resource-origin-blocked-google-accounts-static',
    ],
    [
      'https://lh3.googleusercontent.com',
      'resource-origin-blocked-google-user-content',
    ],
    ['https://apis.google.com', 'resource-origin-blocked-google-other'],
    ['https://example.co.uk', 'resource-origin-blocked-powerschool-parent'],
    [
      'https://assets.teachers.school.example.co.uk',
      'resource-origin-blocked-powerschool-child',
    ],
    [
      'https://cdn.school.example.co.uk',
      'resource-origin-blocked-powerschool-sibling',
    ],
    [
      'https://cdn.assets-sis.example.co.uk',
      'resource-origin-blocked-powerschool-sibling-assets-sis-child',
    ],
    [
      'https://static.assets.example.co.uk',
      'resource-origin-blocked-powerschool-sibling-assets-child',
    ],
    [
      'https://img.cdn.example.co.uk',
      'resource-origin-blocked-powerschool-sibling-cdn-child',
    ],
    [
      'https://flow.auth.example.co.uk',
      'resource-origin-blocked-powerschool-sibling-auth-child',
    ],
    [
      'https://cdn.example.co.uk',
      'resource-origin-blocked-powerschool-sibling-cdn',
    ],
    [
      'https://www.example.co.uk',
      'resource-origin-blocked-powerschool-sibling-www',
    ],
    [
      'https://portal.example.co.uk',
      'resource-origin-blocked-powerschool-sibling-other',
    ],
    [
      'https://assets.portal.example.co.uk',
      'resource-origin-blocked-powerschool-sibling',
    ],
    ['chrome-extension://synthetic-id', 'resource-origin-blocked-non-http'],
    ['https://unrelated.invalid', 'resource-origin-blocked'],
  ] as const;
  for (const [origin, expected] of cases) {
    assert.equal(
      classifyBlockedResourceOrigin(new URL(origin), powerSchoolOrigin),
      expected,
    );
  }
});

test('recognizes only HTTPS PowerSchool same-site resource origins', () => {
  assert.equal(
    isPowerSchoolSameSiteResourceOrigin(
      new URL('https://services.example.co.uk'),
      powerSchoolOrigin,
    ),
    true,
  );
  assert.equal(
    isPowerSchoolSameSiteResourceOrigin(
      new URL('https://deep.unknown.example.co.uk'),
      powerSchoolOrigin,
    ),
    true,
  );
  assert.equal(
    isPowerSchoolSameSiteResourceOrigin(
      new URL('http://services.example.co.uk'),
      powerSchoolOrigin,
    ),
    false,
  );
  assert.equal(
    isPowerSchoolSameSiteResourceOrigin(
      new URL('https://services.example.com'),
      powerSchoolOrigin,
    ),
    false,
  );
});

test('allows legacy-compatible same-site sibling resource methods without allowing PowerSchool writes', () => {
  const sibling = new URL('https://assets-sis.school.example.co.uk/beacon');
  assert.equal(
    isAllowedBrowserResourceMethod({
      method: 'GET',
      url: sibling,
      powerSchoolOrigin,
    }),
    true,
  );
  assert.equal(
    isAllowedBrowserResourceMethod({
      method: 'OPTIONS',
      url: sibling,
      powerSchoolOrigin,
    }),
    true,
  );
  assert.equal(
    isAllowedBrowserResourceMethod({
      method: 'POST',
      url: sibling,
      powerSchoolOrigin,
    }),
    true,
  );
  assert.equal(
    isAllowedBrowserResourceMethod({
      method: 'POST',
      url: new URL(`${powerSchoolOrigin}/teachers/aet_schedulebell.html`),
      powerSchoolOrigin,
    }),
    false,
  );
  assert.equal(
    isAllowedBrowserResourceMethod({
      method: 'POST',
      url: new URL('https://ssl.gstatic.com/report'),
      powerSchoolOrigin,
    }),
    false,
  );
});
