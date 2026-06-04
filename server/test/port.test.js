import { test } from 'node:test';
import assert from 'node:assert/strict';

import { resolvePort } from '../src/port.js';

test('resolvePort prefers API_PORT', () => {
  assert.equal(resolvePort({ API_PORT: '9001', PORT: '3000' }), '9001');
});

test('resolvePort falls back to PORT (Railway injection)', () => {
  assert.equal(resolvePort({ PORT: '3000' }), '3000');
});

test('resolvePort defaults to 8787 when neither is set', () => {
  assert.equal(resolvePort({}), 8787);
});
