import { test } from 'node:test';
import assert from 'node:assert/strict';
import { writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { loadLocalEnv } from '../src/loadEnv.js';

test('loadLocalEnv reads vars from an existing env file into process.env', () => {
  const key = 'MEETING_COST_TEST_VAR_98765';
  const file = join(tmpdir(), `meeting-cost-${key}.env`);
  writeFileSync(file, `${key}=hello-railway\n`);
  try {
    assert.equal(process.env[key], undefined, 'precondition: var not set');
    const loaded = loadLocalEnv(file);
    assert.equal(loaded, true);
    assert.equal(process.env[key], 'hello-railway');
  } finally {
    rmSync(file, { force: true });
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
