// Build stamp for the running client bundle: which environment + git commit it was
// built from. The __APP_*__ constants are baked at build time by Vite `define` (see
// vite.config.js) from Railway's RAILWAY_ENVIRONMENT_NAME / RAILWAY_GIT_COMMIT_SHA.
// Because they're baked into the bundle, this reflects the ACTUAL loaded code — so it
// can diverge from the live server's /api/version and thereby expose a stale cached
// bundle (Zoom caches the webview aggressively).
//
// The `typeof … !== 'undefined'` guards keep this safe in any context where `define`
// did not run (unit tests, SSR): the constants resolve to the fallbacks instead of
// throwing a ReferenceError.

/* global __APP_ENV__, __APP_COMMIT__, __APP_BUILT_AT__ */

const rawEnv = typeof __APP_ENV__ !== 'undefined' ? __APP_ENV__ : 'local';
const rawCommit = typeof __APP_COMMIT__ !== 'undefined' ? __APP_COMMIT__ : 'dev';
const rawBuiltAt = typeof __APP_BUILT_AT__ !== 'undefined' ? __APP_BUILT_AT__ : null;

// Normalize the (arbitrary, Railway-supplied) environment name to a small fixed set so
// styling/logic never depends on the exact string. Railway reports 'production' /
// 'development'; keep 'prod'/'dev' too for a local override. Anything else → 'other'.
export function normalizeEnv(env) {
  const e = String(env ?? '').toLowerCase();
  if (e === 'prod' || e === 'production') return 'prod';
  if (e === 'dev' || e === 'development') return 'dev';
  return 'other';
}

export const buildInfo = {
  env: rawEnv, // raw env label (full, e.g. 'production') — for /api/version parity + logs
  commit: rawCommit, // full commit SHA — the observability-grade identifier
  builtAt: rawBuiltAt,
};

// Fixed-vocabulary environment kind for CSS classes / conditional UI ('prod'|'dev'|'other').
export const envKind = normalizeEnv(buildInfo.env);

// Compact commit for display in the badge (the full SHA lives in buildInfo.commit).
export const shortCommit = String(buildInfo.commit).slice(0, 7);
