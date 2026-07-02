import { buildInfo, envKind, shortCommit } from '../lib/buildInfo.js';

// Small, presenter-private stamp of which build is running: environment + short commit,
// e.g. `dev · a1b2c3d`. Reads buildInfo (the baked, actually-loaded bundle version), not
// a runtime fetch — so it reflects exactly what this webview is running and can expose a
// stale cached bundle vs the server's /api/version. Hook-free (callable directly in
// tests, like CostOverlay). Shown in ALL environments; prod is styled muted while dev
// stands out (per reviews/build-env-stamp.md). The full commit + build time are in the
// title tooltip.

export default function BuildBadge() {
  // Compact display label: the normalized kind for dev/prod, else the raw env (e.g. 'local').
  const label = envKind === 'other' ? buildInfo.env : envKind;
  const title = [
    `env: ${buildInfo.env}`,
    `commit: ${buildInfo.commit}`,
    buildInfo.builtAt ? `built: ${buildInfo.builtAt}` : null,
  ]
    .filter(Boolean)
    .join('\n');

  return (
    <span className={`build-badge build-badge-${envKind}`} title={title}>
      {label} · {shortCommit}
    </span>
  );
}
