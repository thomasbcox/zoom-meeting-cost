import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import * as rateStore from '../src/store/rateStore.js';

let dir;
const prevDir = process.env.DATA_DIR;
const prevKey = process.env.RATE_STORE_KEY;

before(async () => {
  dir = await fs.mkdtemp(path.join(os.tmpdir(), 'rate-store-'));
  process.env.DATA_DIR = dir;
  process.env.RATE_STORE_KEY = 'store-test-master-key';
});

after(async () => {
  if (prevDir === undefined) delete process.env.DATA_DIR;
  else process.env.DATA_DIR = prevDir;
  if (prevKey === undefined) delete process.env.RATE_STORE_KEY;
  else process.env.RATE_STORE_KEY = prevKey;
  await fs.rm(dir, { recursive: true, force: true });
});

test('save then load round-trips the full config verbatim (client owns the schema)', async () => {
  const cfg = {
    rateTable: [{ id: 'r1', name: 'Jane Smith', rate: 95 }],
    aliases: [{ id: 'a1', alias: 'Tom Cox', canonical: 'Thomas Cox' }],
    defaultRate: 125,
    multiplier: 1.25,
    costModel: 'simple',
    simpleAverageRate: 100,
    simpleMultiplier: 1.1,
    simpleUserCount: null,
  };
  const saved = await rateStore.save('uid-1', cfg);
  assert.deepEqual(saved, cfg);
  assert.deepEqual(await rateStore.load('uid-1'), cfg);
});

test('save rejects a non-object body (→ null, caller 400s)', async () => {
  assert.equal(await rateStore.save('uid-x', 'not-an-object'), null);
  assert.equal(await rateStore.save('uid-x', [1, 2, 3]), null);
});

test('validateConfig accepts a well-formed config and rejects malformed ones', () => {
  const ok = {
    rateTable: [{ id: 'r1', name: 'Jane', rate: 95 }],
    aliases: [{ id: 'a1', alias: 'Tom', canonical: 'Thomas' }],
    defaultRate: 125,
    multiplier: 1,
    costModel: 'simple',
    simpleAverageRate: 100,
    simpleMultiplier: 1.1,
    simpleUserCount: null,
  };
  assert.equal(rateStore.validateConfig(ok), ok);

  // Each of these is rejected (→ null).
  const bad = [
    'string',
    [1, 2],
    { rateTable: 'oops', aliases: [] }, // rateTable not an array
    { rateTable: [], aliases: {} }, // aliases not an array
    { rateTable: [{ name: 'X', rate: '95' }], aliases: [], defaultRate: 0, multiplier: 1 }, // string rate
    { rateTable: [{ name: 'X', rate: NaN }], aliases: [], defaultRate: 0, multiplier: 1 }, // non-finite rate
    { rateTable: [{ name: 'X', rate: -5 }], aliases: [], defaultRate: 0, multiplier: 1 }, // negative rate
    { rateTable: [{ rate: 1 }], aliases: [], defaultRate: 0, multiplier: 1 }, // missing name
    { rateTable: [], aliases: [{ alias: 'a' }], defaultRate: 0, multiplier: 1 }, // alias missing canonical
    { rateTable: [], aliases: [], defaultRate: 'free', multiplier: 1 }, // non-number setting
    { rateTable: [], aliases: [], defaultRate: 0, multiplier: 1, costModel: 'weird' }, // bad costModel
  ];
  for (const b of bad) assert.equal(rateStore.validateConfig(b), null, JSON.stringify(b));
});

test('validateConfig: multiplier/simpleMultiplier are optional (removed field) yet rejected when malformed', () => {
  // The loaded-cost multiplier was removed (reviews/remove-cost-multiplier.md). A NEW
  // client omits both fields entirely — that must still validate.
  const noMult = {
    rateTable: [{ id: 'r1', name: 'Jane', rate: 95 }],
    aliases: [],
    defaultRate: 125,
    costModel: 'perParticipant',
    simpleAverageRate: 100,
    simpleUserCount: null,
  };
  assert.equal(rateStore.validateConfig(noMult), noMult);

  // A LEGACY blob still carrying valid values is tolerated (the client ignores them).
  assert.ok(rateStore.validateConfig({ ...noMult, multiplier: 1.25, simpleMultiplier: 1.1 }));

  // But a malformed legacy value is still rejected (→ null).
  assert.equal(rateStore.validateConfig({ ...noMult, multiplier: -1 }), null);
  assert.equal(rateStore.validateConfig({ ...noMult, multiplier: 'x' }), null);
  assert.equal(rateStore.validateConfig({ ...noMult, simpleMultiplier: -1 }), null);
  assert.equal(rateStore.validateConfig({ ...noMult, simpleMultiplier: NaN }), null);
});

test('the on-disk file is ciphertext, not plaintext', async () => {
  await rateStore.save('uid-secret', {
    rateTable: [{ id: 'r1', name: 'Acme CFO', rate: 220 }],
    aliases: [],
    defaultRate: 0,
    multiplier: 1,
  });
  const files = await fs.readdir(dir);
  const raw = await fs.readFile(path.join(dir, files.find((f) => f.startsWith('rates-'))), 'utf8');
  assert.ok(!raw.includes('Acme CFO'), 'plaintext name must not be on disk');
  assert.ok(JSON.parse(raw).ct, 'file holds an encryption envelope');
});

test('an unknown uid loads null (caller falls back to client defaults)', async () => {
  assert.equal(await rateStore.load('never-saved'), null);
});

test('a corrupt/undecryptable file loads null, never throws', async () => {
  await rateStore.save('uid-corrupt', { rateTable: [], aliases: [] });
  const files = await fs.readdir(dir);
  const f = path.join(dir, files.find((x) => x.includes(Buffer.from('uid-corrupt').toString('base64url'))));
  await fs.writeFile(f, '{ not valid json', 'utf8');
  assert.equal(await rateStore.load('uid-corrupt'), null);
});

test('a uid cannot be used to escape DATA_DIR (path traversal)', async () => {
  await rateStore.save('../../etc/evil', { rateTable: [], aliases: [], defaultRate: 0, multiplier: 1 });
  // The write stayed inside DATA_DIR (filename is base64url of the uid).
  const files = await fs.readdir(dir);
  assert.ok(files.every((f) => f.startsWith('rates-') && f.endsWith('.json')));
});
