import { test } from 'node:test';
import assert from 'node:assert/strict';
import { writeFileSync, rmSync, mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { loadLocalEnv } from '../src/loadEnv.js';

test('loadLocalEnv reads vars from an existing env file into process.env', () => {
  const key = 'MEETING_COST_TEST_VAR_98765';
  // Write into a unique, private (0700) temp DIRECTORY, not a predictable name in the shared
  // tmpdir. mkdtempSync's random suffix closes the symlink / pre-creation race CodeQL flags.
  const dir = mkdtempSync(join(tmpdir(), 'meeting-cost-'));
  const file = join(dir, 'test.env');
  writeFileSync(file, `${key}=hello-railway\n`);
  try {
    assert.equal(process.env[key], undefined, 'precondition: var not set');
    const loaded = loadLocalEnv(file);
    assert.equal(loaded, true);
    assert.equal(process.env[key], 'hello-railway');
  } finally {
    rmSync(dir, { recursive: true, force: true });
    delete process.env[key];
  }
});

test('loadLocalEnv returns false and does not throw when the file is missing', () => {
  const missing = join(tmpdir(), 'meeting-cost-does-not-exist-12345.env');
  assert.doesNotThrow(() => {
    const loaded = loadLocalEnv(missing);
    assert.equal(loaded, false);
  });
});

test('loadLocalEnv surfaces a non-missing load failure (e.g. path is a directory)', () => {
  // Reading a directory as an env file throws EISDIR, not ENOENT — a real
  // problem that must propagate rather than look like "no .env".
  assert.throws(() => loadLocalEnv(tmpdir()), (err) => err && err.code !== 'ENOENT');
});
