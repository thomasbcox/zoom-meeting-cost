import { test } from 'node:test';
import assert from 'node:assert/strict';

import { findSecrets, shannonEntropy, ALLOW_MARKER } from './detect.mjs';
import { scanFiles } from './scan-staged.mjs';

// All inputs below are SYNTHETIC — structurally secret-shaped but not real
// credentials (memory: feedback-no-real-secrets-in-repo).

// Build secret-shaped values at runtime so this test file itself contains no
// committed token literal (and so the pre-commit scan doesn't flag its own tests).
const randomToken = ['AbCd12', 'EfGh34', 'IjKl56', 'MnOp78'].join(''); // mixed-class, len 24
const hexToken = '0123456789abcdef'.repeat(2); // 32 hex chars, full-spread (high entropy)

test('AC2: flags a PEM private-key block', () => {
  // Assembled at runtime so this source line doesn't itself contain the literal
  // trigger (which would, correctly, trip our own pre-commit hook).
  const pem = '-----BEGIN RSA ' + 'PRIVATE KEY' + '-----';
  const found = findSecrets(`const k = \`${pem}\`;`);
  assert.equal(found.length, 1);
  assert.equal(found[0].rule, 'private-key');
});

test('AC2: flags an AWS-style access key', () => {
  const text = `const id = "AKIA${'A1B2C3D4E5F6G7H8'.slice(0, 16)}";`;
  const found = findSecrets(text);
  assert.equal(found.length, 1);
  assert.equal(found[0].rule, 'aws-access-key');
});

test('AC2: flags a high-entropy value assigned to a secret-named identifier', () => {
  const found = findSecrets(`client_secret = "${randomToken}"`);
  assert.equal(found.length, 1);
  assert.equal(found[0].rule, 'assigned-secret');

  const hexFound = findSecrets(`api_key: '${hexToken}'`);
  assert.equal(hexFound.length, 1, 'long hex token should be flagged');
});

test('AC2: does NOT flag clean code', () => {
  const clean = [
    'const total = computeTotals(resolved);',
    'export const DEFAULT_PRESENTER_NAME = "Presenter";',
    'const url = "https://example.com/path?x=1";',
  ].join('\n');
  assert.deepEqual(findSecrets(clean), []);
});

test('AC2: does NOT flag low-entropy descriptive synthetic fixtures', () => {
  // Mirrors the repo's existing fixtures.
  const fixtures = [
    "const SYNTHETIC_SECRET = 'test-secret-not-a-real-credential';",
    'fetch(`/auth/callback?code=SECRET123`);',
    "process.env.ZOOM_CLIENT_SECRET = 'test-secret-not-a-real-credential';",
  ].join('\n');
  assert.deepEqual(findSecrets(fixtures), [], 'descriptive word-secrets must pass');
});

test('AC3: a line with the allowlist marker is skipped', () => {
  const line = `client_secret = "${randomToken}" // ${ALLOW_MARKER}`;
  assert.deepEqual(findSecrets(line), []);
});

test('shannonEntropy: random string > dictionary phrase', () => {
  assert.ok(shannonEntropy(randomToken) > shannonEntropy('aaaaaaaaaaaa'));
});

test('AC4: scanFiles blocks a staged synthetic secret and passes clean content', () => {
  const staged = {
    'config.js': `const client_secret = "${randomToken}";`,
    'app.js': 'export const name = "Presenter";',
  };
  const read = (f) => staged[f];

  const dirty = scanFiles(['config.js'], read);
  assert.equal(dirty.length, 1);
  assert.equal(dirty[0].file, 'config.js');
  assert.equal(dirty[0].findings[0].rule, 'assigned-secret');

  const clean = scanFiles(['app.js'], read);
  assert.deepEqual(clean, []);
});

test('AC4: scanFiles skips unreadable (deleted) files without throwing', () => {
  const read = () => {
    throw new Error('does not exist');
  };
  assert.deepEqual(scanFiles(['gone.js'], read), []);
});
