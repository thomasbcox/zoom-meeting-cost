import { promises as fs } from 'node:fs';
import path from 'node:path';

import * as rateCrypto from './rateCrypto.js';

// Per-presenter rate config persisted to a Railway volume, ENCRYPTED at rest. One JSON
// file per uid under DATA_DIR (default /data); the file holds ONLY the rateCrypto
// envelope (ciphertext) — plaintext never touches disk.
//
// The server is a dumb, size-bounded blob store: it persists the presenter's config
// object verbatim (the CLIENT owns the schema + defaults and merges on load), so adding
// client config fields never needs a server change. Reads are defensive: missing /
// corrupt / undecryptable → null (the caller falls back to client defaults), never throws.

function dataDir() {
  return process.env.DATA_DIR || '/data';
}

// Map a uid → a safe filename. base64url-encode the uid so it can never contain path
// separators / traversal sequences and can't escape DATA_DIR.
function fileFor(uid) {
  const safe = Buffer.from(String(uid), 'utf8').toString('base64url');
  return path.join(dataDir(), `rates-${safe}.json`);
}

// A plain JSON object (not array/null) or null. Guards stored + incoming data.
export function asConfigObject(cfg) {
  return cfg && typeof cfg === 'object' && !Array.isArray(cfg) ? cfg : null;
}

// Returns the stored config object, or null if there's nothing usable for this uid.
export async function load(uid) {
  try {
    const raw = await fs.readFile(fileFor(uid), 'utf8');
    const plaintext = rateCrypto.decrypt(uid, JSON.parse(raw));
    return asConfigObject(JSON.parse(plaintext));
  } catch {
    return null;
  }
}

// Persist the config object for uid (encrypted). Returns the stored object, or null if
// the input wasn't a plain object (the caller should 400).
export async function save(uid, config) {
  const cfg = asConfigObject(config);
  if (!cfg) return null;
  const envelope = rateCrypto.encrypt(uid, JSON.stringify(cfg));
  await fs.mkdir(dataDir(), { recursive: true });
  await fs.writeFile(fileFor(uid), JSON.stringify(envelope), 'utf8');
  return cfg;
}
