# Dependency review — 2026-06-21

A point-in-time decision record for the project's dependencies: what to upgrade, what to
hold, and why holding is safe. Refresh when Dependabot opens new PRs, or quarterly.

> **Note (2026-07-09):** this snapshot trails the current tree — `dev-docs/roadmap-archive.md` carries
> newer dependency notes (e.g. later esbuild/vite pins). Cross-check the roadmap until this doc is
> refreshed on the next Dependabot batch.

**Bottom line:** hold every breaking major (React 19, Express 5, Vite 8, plugin-react 6);
take patches and the CI-action updates; review `@zoom/appssdk` updates by hand. **No open
security alerts.**

## Summary

| Dependency | Type | Installed | Proposed | Decision |
|---|---|---|---|---|
| `@zoom/appssdk` | runtime | 0.16.38 | — | **Review each** (don't auto-hold) |
| `react` | runtime | 18.3.1 | 19.2.7 | **Hold** (no React 19) |
| `react-dom` | runtime | 18.3.1 | 19.2.7 | **Hold** (lockstep with react) |
| `express` | runtime | 4.22.2 | 5.2.1 | **Hold** (no Express 5) |
| `vite` | dev/build | 6.4.3 | 8.1.0 | **Hold** (no Vite 8) |
| `@vitejs/plugin-react` | dev/build | 4.7.0 | 6.0.3 | **Hold** (couples to Vite 8) |
| `vitest` | dev | 4.1.8 | 4.1.9 | **Take** (patch) |
| `npm-run-all` | dev | 4.1.5 | — | Keep |
| `actions/checkout` | CI | v4 | v7 | **Take** (grouped) |
| `actions/setup-node` | CI | v4 | v6 | **Take** (grouped) |
| `github/codeql-action` | CI | v3 | v4 | **Take** (grouped) |

## Runtime dependencies

### `@zoom/appssdk` 0.16.38 — review each update
The core Zoom integration, and **pre-1.0** (`0.x`), so under semver even a minor bump can be
breaking. We do **not** auto-hold it — we want to track Zoom's SDK — but every update PR must
be read against the Zoom Apps changelog and validated with a real in-Zoom run (the overlay /
camera-rendering path can't be covered by unit tests). No update is pending today.
*Safe to hold at 0.16.38:* it's the version verified to work; upgrading is a reviewed action.

### `react` 18.3.1 — HOLD (do not take 19) · PR #42
React 19 (19.2.7) is a **major** with real breaking changes (JSX-transform/runtime
requirements, removed deprecated APIs, ref and Context changes). The app gains nothing from it
right now, and our overlay/side-panel code + `@zoom/appssdk` are validated on React 18.
*Why safe to hold:* 18.3.1 is the latest 18.x, actively maintained, **no security advisories**.
Staying put carries no known risk; React 19 would be a deliberate migration with in-Zoom
re-verification.

### `react-dom` 18.3.1 — HOLD (lockstep) · PR #43
Must match `react`'s major exactly; holds with React 18 for the same reasons. Safe identically.

### `express` 4.22.2 — HOLD (do not take 5) · PR #44 (closed)
Express 5 (5.2.1) is a **major** with breaking router/middleware and path-matching changes;
**our `test + build` fails on it**. The server is a thin Express-4 app with no need for any
Express-5 feature.
*Why safe to hold:* 4.22.2 is the latest 4.x, security-patched, **no open advisories**.
A move to 5 would require code changes + re-test and will be its own story if/when warranted.

## Dev / build dependencies

### `vite` 6.4.3 — HOLD (do not take 8) · in PR #41
The dev-deps group proposed **Vite 6 → 8 — two majors at once**, a significant bundler change
(Rolldown/Oxc transition, plugin-API shifts). CI happened to pass, but a two-major jump in the
build tool is a deliberate upgrade, not a routine bump, and shouldn't ride in on a vitest patch.
*Why safe to hold:* 6.4.3 already includes the path-traversal dev-server fix (alerts #1/#3,
below); it builds our app correctly today.

### `@vitejs/plugin-react` 4.7.0 — HOLD (couples to Vite 8) · in PR #41
v6 **drops Babel and targets Vite 8**, so it's bound to the Vite-8 decision — hold together.
*Safe:* 4.7.0 works with Vite 6.

### `vitest` 4.1.8 — TAKE the patch (4.1.9)
Test-only patch, no API change. It will arrive in the next dev-deps (minor/patch) group PR now
that majors are excluded from that group.

### `npm-run-all` 4.1.5 — keep
Dev-only script orchestration; nothing pending.

## CI / GitHub Actions — TAKE (as one grouped PR)
These run only in CI (never shipped) and are validated by the CI run itself, so major bumps are
low-risk and worth taking to stay current:
- **`actions/checkout` v4 → v7** — mostly newer action-runtime/Node; low risk.
- **`actions/setup-node` v4 → v6** — keeps Node setup current.
- **`github/codeql-action` v3 → v4** — v3 is being deprecated; v4 is the supported SAST line.

After the config change groups GitHub-Actions updates, review and merge the single grouped PR.

## Disposition of the 7 first-run Dependabot PRs
| PR | Bump | Disposition |
|---|---|---|
| #44 | express 4→5 | **Closed** (breaking; failed CI) |
| #43 | react-dom 18→19 | **Close** (hold; now ignored by config) |
| #42 | react 18→19 | **Close** (hold; now ignored) |
| #41 | dev-deps: vite 6→8, plugin-react 4→6, vitest patch | Dependabot **auto-closes** once vite/plugin-react majors are ignored; the vitest patch returns in the next group PR |
| #40 | actions/checkout 4→7 | **Take** — consolidates into the grouped Actions PR |
| #39 | actions/setup-node 4→6 | **Take** — grouped |
| #38 | github/codeql-action 3→4 | **Take** — grouped |

## Security posture
**0 open Dependabot alerts.** The 3 historical alerts are dev-tooling only and already
satisfied by installed versions — no production exposure:
- vite ≤ 6.4.1 path traversal (×2) → fixed; we're on 6.4.3.
- esbuild ≤ 0.24.2 dev-server request exposure → dev-server only; fixed in our chain.

## Config that enforces this
`.github/dependabot.yml` ignores **major** updates for `react`, `react-dom`, `express`,
`vite`, `@vitejs/plugin-react`; restricts the dev-dependencies group to minor/patch; and groups
GitHub-Actions updates. Minor/patch + security updates still flow weekly.
