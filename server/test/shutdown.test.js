import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

// Boots the real server entry (src/index.js) on an OS-assigned port, waits for it to
// listen, then sends a stop signal and asserts the process exits 0 — i.e. it shuts down
// gracefully instead of dying non-zero (143), which is what made Railway report false
// "crash" notifications on every redeploy.

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ENTRY = path.resolve(__dirname, '../src/index.js');

function bootThenSignal(signal) {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [ENTRY], {
      // API_PORT=0 → ephemeral port, so the test never clashes with a dev server.
      env: { ...process.env, API_PORT: '0' },
      stdio: ['ignore', 'pipe', 'pipe'],
    });

    const timer = setTimeout(() => {
      child.kill('SIGKILL');
      reject(new Error('server did not start and exit within the timeout'));
    }, 8000);

    let out = '';
    let signalled = false;
    child.stdout.on('data', (d) => {
      out += d.toString();
      if (!signalled && out.includes('server on')) {
        signalled = true;
        // kill() returns false if the signal wasn't delivered — fail loudly rather than
        // letting the test "pass" without actually signalling the process.
        if (!child.kill(signal)) {
          clearTimeout(timer);
          reject(new Error(`failed to deliver ${signal} to the server process`));
        }
      }
    });
    child.on('exit', (code) => {
      clearTimeout(timer);
      // Guard against a false pass: if the child exited before it listened and we signalled
      // it (e.g. a boot regression that exits 0 immediately), the boot→listen→signal→exit
      // path was never exercised. Require that we saw 'server on' and sent the signal.
      if (!signalled) {
        reject(new Error('server exited before listening / being signalled — boot path not exercised'));
        return;
      }
      resolve(code);
    });
    child.on('error', reject);
  });
}

test('exits 0 on SIGTERM (graceful shutdown)', async () => {
  const code = await bootThenSignal('SIGTERM');
  assert.equal(code, 0, 'process should exit 0 on SIGTERM, not 143');
});

test('exits 0 on SIGINT (graceful shutdown)', async () => {
  const code = await bootThenSignal('SIGINT');
  assert.equal(code, 0, 'process should exit 0 on SIGINT');
});
