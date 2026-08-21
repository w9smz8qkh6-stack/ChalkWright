import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

test('production route cutover snapshots node serve status and restores the exact legacy target', () => {
  const source = readFileSync(
    'scripts/operations/cutover-production-tailscale-route.sh',
    'utf8',
  );
  assert.match(source, /tailscale serve status --json > "\$status"/u);
  assert.match(
    source,
    /install -o root -g root -m 0600 "\$status" "\$snapshot"/u,
  );
  assert.match(
    source,
    /tailscale serve --bg --https="\$serve_port" "\$previous_target"/u,
  );
  assert.match(source, /previous_target == http:\/\/127\.0\.0\.1:4318/u);
  assert.doesNotMatch(source, /tailscale serve (?:get|set)-config/u);
});
