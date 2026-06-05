import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// Dev server proxies API (/api) + auth (/auth) traffic to the Node backend so
// the client can use same-origin URLs (which is also how it behaves in production).
export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
    proxy: {
      '/api': 'http://localhost:8787',
      '/auth': 'http://localhost:8787',
    },
  },
});
