// Pre-commit entry point: scan the STAGED content of changed files for secrets.
//
// Run by `.githooks/pre-commit`. Exits non-zero (blocking the commit) when a
// likely secret is found, printing the file/line and the allowlist hint. The core
// (`scanFiles`) takes an injected reader so it can be unit-tested without git.

import { execSync } from 'node:child_process';
import { findSecrets, ALLOW_MARKER } from './detect.mjs';

// Pure-ish core: given a list of files and a reader (path -> staged content),
// return all findings keyed by file. No git, no process exit — testable directly.
export function scanFiles(files, readStaged) {
  const results = [];
  for (const file of files) {
    let content;
    try {
      content = readStaged(file);
    } catch {
      continue; // unreadable (e.g. deleted) — nothing to scan
    }
    if (content == null) continue;
    const findings = findSecrets(content);
    if (findings.length) results.push({ file, findings });
  }
  return results;
}

function stagedFiles() {
  const out = execSync('git diff --cached --name-only --diff-filter=ACM', {
    encoding: 'utf8',
  });
  return out.split('\n').map((s) => s.trim()).filter(Boolean);
}

function readStagedBlob(file) {
  // `:file` is the staged (index) version — exactly what is about to be committed.
  return execSync(`git show :"${file}"`, { encoding: 'utf8' });
}

export function runHook() {
  const results = scanFiles(stagedFiles(), readStagedBlob);
  if (!results.length) return 0;

  process.stderr.write('\n✖ Secret-scan blocked this commit — possible secret in staged changes:\n\n');
  for (const { file, findings } of results) {
    for (const f of findings) {
      process.stderr.write(`  ${file}:${f.line}  [${f.rule}]  ${f.preview}\n`);
    }
  }
  process.stderr.write(
    `\nIf this is an intentional synthetic fixture (no real credential), add the\n` +
      `marker \`${ALLOW_MARKER}\` on the same line to allowlist it. NEVER commit a\n` +
      `real secret — rotate it if one was exposed.\n\n`
  );
  return 1;
}

// Only run when invoked directly (the hook), not when imported by tests.
if (import.meta.url === `file://${process.argv[1]}`) {
  process.exit(runHook());
}
