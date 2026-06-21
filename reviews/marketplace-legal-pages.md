Date: 2026-06-21 · Branch: claude/marketplace-legal-pages · Status: approved

Approved 2026-06-21 by Thomas: "make it so" — provider = Transformative Leadership
Lab LLC; support email thomas+mcsupport@txl-lab.com; **governing law Washington**
(updated from initial Wyoming guess); effective date 01-Jun-2026; app name "Meeting
Cost Meter"; pages styled to the TXL brand palette; internal docs → `dev-docs/`.

## Problem
The Zoom App Marketplace submission for **Meeting Cost Meter** requires four publicly
reachable pages: a Privacy Policy, Terms of Use, Support page, and Documentation
page. The repo has none. We need clean, accurate static HTML pages that truthfully
describe how the app handles data, so the submission's privacy/legal URLs can point
at them.

The pages must reflect the app's actual architecture (from project memory + code):
- The presenter's hourly-rate table, default rate, and loaded-cost multiplier are
  entered by the presenter and live only in their browser's `localStorage`.
- No participant data is stored on the server or persisted beyond the active
  meeting session.
- The server (a thin Express app) only ever receives sanitized **aggregate** cost
  state (`buildOverlayState()` output — total, cost/min, elapsed, attendee count),
  never individual rates or names.
- The app does not integrate with HR, payroll, SSO, or any employee directory;
  rates are explicitly the presenter's private estimates.

## In scope
- **Relocate internal dev docs out of `docs/`** (so GitHub Pages on `/docs` only
  exposes the public site). `git mv` all 8 current `docs/` files —
  `roadmap.md`, `railway-setup.md`, `overlay-live-test-matrix.md`,
  `camera-overlay-no-draw.md`/`.codex.json`, `camera-overlay-no-update.md`/`.codex.json`,
  `screenshot.png` — into a new top-level `dev-docs/` folder.
- **Fix the 5 references** to moved files: `README.md` (`docs/screenshot.png`,
  `docs/railway-setup.md`) and `server/zoom-app-config.md` (3× `../docs/railway-setup.md`).
  Also update stale inline-code path mentions *inside* the moved files
  (e.g. `docs/camera-overlay-*.codex.json` → `dev-docs/…`). `../reviews/…` links in
  `roadmap.md` remain valid from `dev-docs/` and are left unchanged. Archival
  `reviews/*.md` story files are NOT edited (point-in-time records).
- Create four static HTML pages in `docs/`:
  - `privacy.html` — Privacy Policy
  - `terms.html` — Terms of Use
  - `support.html` — Support
  - `documentation.html` — Documentation / how the app works
- Create `docs/index.html` linking to all four.
- One shared stylesheet `docs/styles.css` styled to **match the look of
  txl-lab.com** (its colors, type scale, spacing, header/footer treatment), derived
  by scraping the live site. Constraint kept: pages remain fully self-contained — no
  external CDN/font/script/analytics requests (a privacy page must not phone home);
  txl-lab.com's web fonts are approximated with a close self-contained font stack.
- Each page: branded header with the app name **"Meeting Cost Meter"**, a clear
  page heading, "Effective date: 1 June 2026", and a footer linking back to the
  index and naming the provider entity.

## Non-goals
- No hosting/serving wiring (no Express route changes, no GitHub Pages enablement,
  no Railway changes, no DNS). Enabling Pages is a post-merge follow-up.
- No edits to the *content* of the internal docs — they are moved verbatim; only
  their location and the path strings that reference them change.
- No edits to archival `reviews/*.md` story files.
- No application/client/server code changes; no build-step or test changes.
- No legal review/sign-off — content is a plain-language draft for Thomas to review
  and adjust before submission. Not legal advice.
- No pixel-perfect clone of txl-lab.com — the goal is a recognizably matching look
  (palette, type, header/footer), not a byte-for-byte reproduction.

## Acceptance criteria
1. `docs/index.html`, `docs/privacy.html`, `docs/terms.html`, `docs/support.html`,
   and `docs/documentation.html` all exist and are well-formed standalone HTML
   (each has `<!doctype html>`, `<title>`, and links `styles.css`).
2. `docs/styles.css` exists; every page links it and no page pulls any external
   resource (no `http(s)://` asset/script/font/CDN references in any page).
3. `docs/index.html` contains a link to each of the four other pages; each of the
   four pages contains a link back to `index.html`.
4. The four content claims in **Problem** (localStorage-only rates; no participant
   data persisted past the session; server sees aggregate-only state; no
   HR/payroll/SSO/directory integration) appear, accurately stated, in the Privacy
   Policy; the documentation page describes the same data flow consistently.
5. Pages contain no JavaScript and no tracking/analytics; **"Meeting Cost Meter"** is
   the app name used throughout; each page shows "Effective date: 1 June 2026"; the
   provider entity name and `thomas+mcsupport@txl-lab.com` support email appear where
   relevant; Terms names **Washington** as governing law.
6. After the move, `docs/` contains **only** the public site (the six files in AC1)
   — no `.md`/`.json`/`.png` internal docs remain — and `dev-docs/` contains the 8
   relocated files. File contents of the moved docs are unchanged except for
   self-referential path strings.
7. No broken references: `README.md` and `server/zoom-app-config.md` point at the new
   `dev-docs/…` paths; no tracked file outside `reviews/` still references a
   `docs/<moved-file>` path. `git grep` for the moved filenames under `docs/` returns
   nothing (outside `reviews/`).
8. Scope containment: `git diff --name-only main...HEAD` shows only — the six new
   `docs/` site files; the 8 `docs/→dev-docs/` renames; `README.md`;
   `server/zoom-app-config.md`; and `reviews/marketplace-legal-pages.md`. Nothing else.

## Test notes
- AC1/AC2/AC3/AC5: open each file; grep for `<!doctype`, `<title>`, the
  `styles.css` link, cross-links, the "Effective date: 1 June 2026" string, and
  assert no `http://`/`https://` resource refs and no `<script>` tags.
- AC4: read the Privacy Policy and documentation page; confirm each of the four
  claims is present and matches the architecture in project memory /
  `client/src/lib/overlayState.js` (`buildOverlayState` aggregate-only).
- AC6/AC7: `git ls-files docs/` lists only the six site files; `git ls-files dev-docs/`
  lists the 8 moved files; `git grep -n 'docs/\(roadmap\|railway-setup\|overlay-live\|camera-overlay\|screenshot\)' -- ':!reviews/*'`
  returns nothing.
- AC8: run `git diff --name-only main...HEAD` and verify no files appear beyond those
  this AC enumerates.
- Visual sanity: render `docs/index.html` in a browser; confirm consistent minimal
  styling and working navigation. (Manual; static pages, no server needed.)

## Hosting (resolved 2026-06-21)
Published via **GitHub Pages** serving the `main` branch `/docs` folder → pages go
at `docs/` root. Resulting Marketplace URLs:
- Home: `https://thomasbcox.github.io/zoom-meeting-cost/`
- Privacy: `https://thomasbcox.github.io/zoom-meeting-cost/privacy.html`
- Terms: `https://thomasbcox.github.io/zoom-meeting-cost/terms.html`
- Support: `https://thomasbcox.github.io/zoom-meeting-cost/support.html`
- Documentation: `https://thomasbcox.github.io/zoom-meeting-cost/documentation.html`

Enabling Pages is a repo setting (GitHub UI / `gh api`), done as a post-merge
follow-up — not part of this story's diff. Internal dev docs are relocated to
`dev-docs/` (see In scope) so `/docs` serves the public site only.

## Decisions (resolved 2026-06-21)
- **App name:** "Meeting Cost Meter".
- **Provider entity:** Transformative Leadership Lab LLC (confirmed from
  txl-lab.com's privacy/terms page, which lists it at Ridgefield, Washington).
- **Governing law:** **Washington** (Thomas updated from his initial "Wyoming" guess
  2026-06-21 — matches the entity's listed state).
- **Support contact:** thomas+mcsupport@txl-lab.com.
- **Effective date:** 1 June 2026 (01-Jun-2026).
- **New internal-docs folder:** `dev-docs/`.
- **Visual style:** match the TXL brand palette (Thomas-supplied 2026-06-21): sage
  `#dde2c9`, teal `#07a496`, sky `#31b5e9`, green `#a3d28b`, blue `#0070a5`, deep
  teal `#006060`, navy `#234262`. Fonts (Typekit `stolzl`/`korolev-compressed`)
  approximated with a self-contained stack — no external requests.
