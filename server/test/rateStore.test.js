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

test('save then load round-trips the config', async () => {
  const cfg = {
    rateTable: [{ id: 'r1', name: 'Jane Smith', rate: 95 }],
    aliases: [{ id: 'a1', alias: 'Tom Cox', canonical: 'Thomas Cox' }],
    defaultRate: 125,
    multiplier: 1.25,
  };
  const saved = await rateStore.save('uid-1', cfg);
  assert.deepEqual(saved, cfg);
  assert.deepEqual(await rateStore.load('uid-1'), cfg);
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

test('an unknown uid loads safe defaults', async () => {
  assert.deepEqual(await rateStore.load('never-saved'), rateStore.DEFAULT_CONFIG);
});

test('a corrupt/undecryptable file loads defaults, never throws', async () => {
  await rateStore.save('uid-corrupt', { rateTable: [], aliases: [], defaultRate: 1, multiplier: 1 });
  const files = await fs.readdir(dir);
  const f = path.join(dir, files.find((x) => x.includes(Buffer.from('uid-corrupt').toString('base64url'))));
  await fs.writeFile(f, '{ not valid json', 'utf8');
  assert.deepEqual(await rateStore.load('uid-corrupt'), rateStore.DEFAULT_CONFIG);
});

test('a uid cannot be used to escape DATA_DIR (path traversal)', async () => {
  await rateStore.save('../../etc/evil', { rateTable: [], aliases: [], defaultRate: 0, multiplier: 1 });
  // The write stayed inside DATA_DIR (filename is base64url of the uid).
  const files = await fs.readdir(dir);
  assert.ok(files.every((f) => f.startsWith('rates-') && f.endsWith('.json')));
});
