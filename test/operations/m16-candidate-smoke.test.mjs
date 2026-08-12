import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

test('M-16 smoke launcher binds exact release and isolated transient capabilities', () => {
  const source = readFileSync(
    'scripts/operations/run-m16-candidate-smoke.sh',
    'utf8',
  );
  assert.match(
    source,
    /release=002264cb6de9d04f18a0da4737b71510981b3027d1cb9f18429a8bfab4d0c823/u,
  );
  assert.equal((source.match(/\/usr\/bin\/systemd-run/gu) ?? []).length, 3);
  assert.match(source, /production-plan-refresh\.env/u);
  assert.match(source, /production-classroom-refresh\.env/u);
  assert.match(source, /InaccessiblePaths=-\/etc\/classroom-hub\/providers/u);
  assert.match(source, /RuntimeMaxSec=2h/u);
  assert.match(source, /classroom_status -ne 0 && \$classroom_status -ne 2/u);
  assert.doesNotMatch(source, /tailscale|systemctl|enable|daemon-reload/u);
  assert.equal(source.includes('routeChanges\\\":0'), true);
  assert.equal(source.includes('providerWrites\\\":0'), true);
  assert.equal(source.includes('calendarRequests\\\":0'), true);
});
