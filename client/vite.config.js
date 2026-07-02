import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// Build-time stamp baked into the client bundle so the running app can report which
// environment + git commit it was built from (see reviews/build-env-stamp.md). Railway
// injects RAILWAY_ENVIRONMENT_NAME + RAILWAY_GIT_COMMIT_SHA during the build; a local
// build (neither set) falls back to 'local'/'dev'. These become the __APP_*__ globals
// read by src/lib/buildInfo.js. Because the value is baked, the badge reflects the
// ACTUAL loaded bundle — so a stale cached bundle shows a different commit than the
// live server's /api/version.
const buildEnv = process.env.RAILWAY_ENVIRONMENT_NAME || 'local';
const buildCommit = process.env.RAILWAY_GIT_COMMIT_SHA || 'dev';
const builtAt = new Date().toISOString();

// Dev server proxies API (/api) + auth (/auth) traffic to the Node backend so
// the client can use same-origin URLs (which is also how it behaves in production).
export default defineConfig({
  plugins: [react()],
  define: {
    __APP_ENV__: JSON.stringify(buildEnv),
    __APP_COMMIT__: JSON.stringify(buildCommit),
    __APP_BUILT_AT__: JSON.stringify(builtAt),
  },
  server: {
    port: 5173,
    proxy: {
      '/api': 'http://localhost:8787',
      '/auth': 'http://localhost:8787',
    },
  },
});
