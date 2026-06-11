import { promises as fs } from 'node:fs';
import path from 'node:path';

import * as rateCrypto from './rateCrypto.js';

// Per-presenter rate config persisted to a Railway volume, ENCRYPTED at rest. One JSON
// file per uid under DATA_DIR (default /data); the file holds ONLY the rateCrypto
// envelope (ciphertext) — plaintext never touches disk. All reads are defensive:
// unknown / corrupt / undecryptable → defaults, never throws.

export const DEFAULT_CONFIG = Object.freeze({
  rateTable: [],
  aliases: [],
  defaultRate: 0,
  multiplier: 1,
});

function dataDir() {
  return process.env.DATA_DIR || '/data';
}

// Map a uid → a safe filename. base64url-encode the uid so it can never contain path
// separators / traversal sequences and can't escape DATA_DIR.
function fileFor(uid) {
  const safe = Buffer.from(String(uid), 'utf8').toString('base64url');
  return path.join(dataDir(), `rates-${safe}.json`);
}

// Shape-guard a config object (defensive against tampered/garbage persisted data).
function sanitize(cfg) {
  const c = cfg && typeof cfg === 'object' ? cfg : {};
  return {
    rateTable: Array.isArray(c.rateTable) ? c.rateTable : [],
    aliases: Array.isArray(c.aliases) ? c.aliases : [],
    defaultRate: Number.isFinite(Number(c.defaultRate)) ? Number(c.defaultRate) : 0,
    multiplier: Number.isFinite(Number(c.multiplier)) ? Number(c.multiplier) : 1,
  };
}

export async function load(uid) {
  try {
    const raw = await fs.readFile(fileFor(uid), 'utf8');
    const plaintext = rateCrypto.decrypt(uid, JSON.parse(raw));
    return sanitize(JSON.parse(plaintext));
  } catch {
    // Missing file, corrupt JSON, wrong key, tampering — all degrade to defaults.
    return { ...DEFAULT_CONFIG };
  }
}

export async function save(uid, config) {
  const cfg = sanitize(config);
  const envelope = rateCrypto.encrypt(uid, JSON.stringify(cfg));
  await fs.mkdir(dataDir(), { recursive: true });
  await fs.writeFile(fileFor(uid), JSON.stringify(envelope), 'utf8');
  return cfg;
}
