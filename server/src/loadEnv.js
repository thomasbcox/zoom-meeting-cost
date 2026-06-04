// Load a local .env for development if one is present.
//
// On Railway (and any platform host) config is injected as environment
// variables, so there is no committed .env — a missing file must be a harmless
// no-op, never a boot failure. We avoid the `--env-file-if-exists` CLI flag
// (which only exists on Node >= 20.12 / 22 and would crash an older runtime) and
// load programmatically instead:
//   - `process.loadEnvFile` is undefined on older Node -> optional chaining skips
//     it (no crash).
//   - `process.loadEnvFile('.env')` throws if the file is missing -> caught.
//
// Imported for its side effect, FIRST, before any module that reads process.env
// at evaluation time (e.g. zoom/oauth.js).

export function loadLocalEnv(path = '.env') {
  // Older Node has no loadEnvFile — skip without pretending we loaded anything.
  if (typeof process.loadEnvFile !== 'function') return false;
  try {
    process.loadEnvFile(path);
    return true;
  } catch (err) {
    // A missing .env is the expected case (e.g. Railway injects config as env
    // vars) — swallow it. Any OTHER failure (unreadable/malformed .env) is a real
    // problem worth surfacing rather than booting with config silently absent.
    if (err?.code === 'ENOENT') return false;
    throw err;
  }
}

loadLocalEnv();
