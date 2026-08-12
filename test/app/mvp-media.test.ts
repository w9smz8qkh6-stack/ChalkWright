import assert from 'node:assert/strict';
import {
  linkSync,
  mkdirSync,
  mkdtempSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from 'node:fs';
import { createHash } from 'node:crypto';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';

import { loadDismissalMedia } from '../../src/app/mvp-server.js';

function temporaryRoot(): string {
  const root = mkdtempSync(join(tmpdir(), 'classroom-hub-media-test-'));
  mkdirSync(join(root, 'public'));
  return root;
}

const syntheticMp4 = Buffer.concat([
  Buffer.from('0000001866747970', 'hex'),
  Buffer.from('isom00000200isomiso2', 'ascii'),
]);

function reference(path: string, bytes = syntheticMp4) {
  return {
    path,
    byteLength: bytes.byteLength,
    sha256: createHash('sha256').update(bytes).digest('hex'),
  };
}

test('configured media rejects missing, malformed, directory, symlink, and hard-link targets', () => {
  for (const kind of [
    'missing',
    'malformed',
    'directory',
    'symlink',
    'hardlink',
  ] as const) {
    const root = temporaryRoot();
    try {
      const path = join(root, 'public', 'private-dismissal.mp4');
      if (kind === 'malformed') writeFileSync(path, 'junk');
      if (kind === 'directory') mkdirSync(path);
      if (kind === 'symlink') {
        const target = join(root, 'public', 'other.mp4');
        writeFileSync(target, 'synthetic-target');
        symlinkSync(target, path);
      }
      if (kind === 'hardlink') {
        const target = join(root, 'public', 'other.mp4');
        writeFileSync(target, syntheticMp4);
        linkSync(target, path);
      }
      assert.throws(
        () => loadDismissalMedia(reference(path)),
        /dismissal-media-invalid/u,
      );
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  }
});

test('no private media is a supported poster-fallback state', () => {
  assert.deepEqual(loadDismissalMedia(), { resources: {}, ready: false });
});

test('media readiness accepts an exact external digest-bound MP4', () => {
  const root = temporaryRoot();
  try {
    const path = join(root, 'public', 'private-dismissal.mp4');
    writeFileSync(path, syntheticMp4);
    const media = loadDismissalMedia(reference(path));
    assert.equal(media.ready, true);
    assert.deepEqual(media.resources.dismissal?.bytes, syntheticMp4);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('media readiness rejects same-size MP4-looking bytes with the wrong checksum', () => {
  const root = temporaryRoot();
  try {
    const path = join(root, 'public', 'private-dismissal.mp4');
    writeFileSync(path, syntheticMp4);
    assert.throws(
      () =>
        loadDismissalMedia({
          ...reference(path),
          sha256: '0'.repeat(64),
        }),
      /dismissal-media-invalid/u,
    );
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
