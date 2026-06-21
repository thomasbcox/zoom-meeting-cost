Date: 2026-06-21 · Branch: claude/marketplace-legal-pages · Status: approved

Approved 2026-06-21 by Thomas ("ok do that"): expand this branch's scope; keep the
encrypted store and describe it accurately; reframe `rate` as hourly opportunity cost
across public docs, in-app copy, comments, and internal docs; no identifier/logic
changes; neutralize the multiplier help text now and flag its removal to a future
story; canonical definition via the hybrid (`dev-docs/opportunity-cost-rate.md` +
README pointer).

## Problem
Two related problems, both about what "rate" means and how we describe it.

**1. The policy pages are inaccurate.** The Privacy Policy and Terms on this branch
claim the presenter's rate data "stays only in the browser's localStorage" and that
"the server only receives sanitized aggregate cost state, never individual rate
data." That is false. There is a live, intentional server path: the presenter's full
config — participant **names** and per-person **rate values**, plus `aliases`,
`defaultRate`, `multiplier` — is sent to `PUT /api/rates`
([ratesApi.js](client/src/lib/ratesApi.js)) and persisted **encrypted at rest** on a
Railway volume, keyed to the presenter's Zoom uid
([rateStore.js](server/src/store/rateStore.js), [app.js:127-140](server/src/app.js)),
for cross-session/device persistence. The code already documents this honestly
([usePresenterStore.js:8](client/src/state/usePresenterStore.js)). **Decision: we are
KEEPING the encrypted store.** The docs must describe it accurately. Only the camera
overlay payload ([overlayState.js](client/src/lib/overlayState.js)) is aggregate-only,
and that remains true.

**2. "Rate" is framed as rate-of-pay; it should mean hourly opportunity cost.** The
number a presenter enters for each person should represent that person's **hourly
opportunity cost** — the value of the highest and best work they could be doing
instead of attending this meeting. It should **never** be their wage or salary,
because (A) pay is private and we never want it, and (B) wage *understates* the
meeting's true cost: an hour of someone's best work is usually worth far more than
what they are paid for it. Today the public docs, the in-app copy, and the code
comments all describe "rate" in pay terms ("hourly rate," "best-guess hourly rates,"
"benefits/overhead multiplier," "estimate each person's hourly rate").

## Canonical definition (to propagate verbatim-in-spirit)
> The rate you enter for each person is their **hourly opportunity cost** — the value
> of the highest and best work they could be doing instead of being in this meeting.
> It is deliberately **not** their wage or salary: pay is private (we never want it),
> and pay *understates* the cost of the meeting.

## In scope
Copy, comments, and documentation only. **No identifier, field, route, or schema
renames. No logic or math changes.**

- **Public docs accuracy** (`docs/privacy.html`, `docs/terms.html`, `docs/support.html`):
  describe the encrypted server rate store accurately — the config (names + values
  you assign) is sent to and stored on the server, encrypted at rest, tied to your
  Zoom account, used only to restore *your own* settings across sessions/devices,
  never shown to participants, never used to build the on-camera overlay. Remove the
  three false claims (browser-only / never-sent / no-server-storage).
- **Public docs reframe** (all 5 `docs/*.html`): state the canonical definition where
  "rate" is introduced; make explicit it is opportunity cost, not wage/salary, with
  both reasons (A private, B understates).
- **In-app copy** (client JSX user-facing strings only — `PresenterControls.jsx`,
  `App.jsx`, `SharedCostScreen.jsx` if live): relabel/help-text so the presenter is
  asked for hourly opportunity cost, not pay. **Neutralize the multiplier help text**
  (currently "benefits/overhead," a comp concept) to value-neutral wording; the field
  and logic stay. Fully removing the multiplier is flagged to a future story, not done
  here.
- **Backlog flag**: append an item to `reviews/backlog.md` for a future story to
  remove the loaded-cost multiplier (it's a compensation concept that no longer fits
  opportunity-cost framing).
- **Code comments** (`cost.js`, `overlayState.js`, `rateStore.js`, `ratesApi.js`,
  `usePresenterStore.js`): where a comment defines what `rate` *means*, say "hourly
  opportunity cost," not "best-guess rates / $/hr pay." Keep the existing privacy /
  ⚠️ accuracy notes intact.
- **Internal docs (hybrid):** add the canonical note `dev-docs/opportunity-cost-rate.md`
  as the single source of truth defining `rate` = hourly opportunity cost; add a
  one-line definition **plus a link to it** in `README.md` (the front door, no
  restating); align `dev-docs/roadmap.md` and `server/zoom-app-config.md` where they
  already discuss the concept (point at the canonical note rather than duplicating).
- **Tests**: update only assertions that reference changed copy strings, so the gate
  stays green. No test logic/behavior changes.

## Non-goals
- No variable/function/field/route/file renames (`rate`, `rateTable`, `defaultRate`,
  `/api/rates`, `rateStore`, `rates-<uid>.json` all stay). The persisted schema is
  untouched.
- No math/logic changes — `computeTotals`, `selectActiveTotals`, `buildOverlayState`,
  validation, crypto are behaviorally identical.
- Not a decision to remove or redesign the encrypted store (we are keeping it).
- Removing the loaded-cost multiplier — flagged to a future story (backlog), not here.
- Not a re-model of inputs (no role tiers, no revenue-based valuation) — only the
  *description* of the existing single per-person number changes.
- Do not touch "rate" where it means something else (rate-limiting, refresh/frame
  rate). Meaning-aware edits only.

## Acceptance criteria
1. **Privacy accuracy:** `docs/privacy.html` accurately states that the presenter's
   config (names entered + opportunity-cost values assigned) is sent to and stored on
   the server, encrypted at rest, tied to their Zoom account, for their own
   cross-session/device persistence; readable only via their account; never shared
   with participants; never part of the camera overlay (aggregate-only). None of the
   three false claims remains in any `docs/*.html` (no "only in ... localStorage as
   the sole store," "never sent to our server," or "no participant data is stored on
   the server" in a way that contradicts the store).
2. **Terms aligned:** `docs/terms.html` contains no statement contradicting AC1.
3. **Opportunity-cost framing (public):** every `docs/*.html` that introduces the
   per-person number frames it as hourly opportunity cost; `docs/documentation.html`
   (and the privacy page where rate is described) state the canonical definition
   including "highest and best work" and that it is **not** wage/salary, with both
   reasons. No public-doc copy implies the number is the person's pay.
4. **In-app copy:** user-facing strings in the live presenter UI ask for opportunity
   cost, not pay; no "wage"/"salary"/"benefits/overhead" pay-framing remains in app
   copy. (Identifiers unchanged.)
5. **Comments:** the semantic-definition comments in the five listed source files
   describe `rate` as hourly opportunity cost; existing privacy/⚠️ notes preserved.
6. **Internal docs:** `dev-docs/opportunity-cost-rate.md` exists with the canonical
   definition; `README.md` has a one-line definition that links to it; `dev-docs/roadmap.md`
   and `server/zoom-app-config.md` reflect that `rate` = opportunity cost where they
   discuss it. Unrelated "rate" senses are untouched.
9. **Multiplier:** the multiplier field and logic are unchanged; only its help text is
   neutralized away from "benefits/overhead." `reviews/backlog.md` has a new item
   flagging the future story to remove the multiplier.
7. **No behavior change:** `git diff main...HEAD` shows changes only to comments,
   user-facing string literals, `.md`/`.html` docs, and test files whose assertions
   reference changed copy. No identifier/field/route/schema renames; the logic lines
   of `cost.js` and `overlayState.js` are unchanged.
8. **Gate green:** `npm test && npm run build` passes.

## Test notes
- AC1/AC2/AC3: grep `docs/*.html` for the removed false phrases (absent) and for
  "opportunity cost," "highest and best," and the not-wage/salary statement (present);
  read privacy + terms to confirm the store is described accurately and consistently.
- AC4/AC5: read the listed components and source files; grep app copy for
  `wage|salary|benefits/overhead` (absent in user-facing strings); confirm comments
  updated.
- AC6: confirm the new dev-doc exists; spot-check roadmap/README/zoom-app-config;
  verify rate-limiting / refresh-rate mentions are unchanged.
- AC7: `git diff --name-only main...HEAD` reviewed; inspect that no `export`/identifier
  lines changed in the five source files (only comments/strings); diff `cost.js` and
  `overlayState.js` to confirm logic untouched.
- AC8: run `npm test && npm run build`.

## Decisions (resolved 2026-06-21)
1. **Branch:** continue on `claude/marketplace-legal-pages` (scope expanded); one
   review/merge vs `main` covering the Marketplace pages + this reframe.
2. **Multiplier:** keep field + logic, neutralize help text now; removal flagged to a
   future story via `reviews/backlog.md`.
3. **In-app copy:** in scope — reframe the presenter UI strings now.
4. **Canonical note (hybrid):** add `dev-docs/opportunity-cost-rate.md` as the single
   source of truth; README carries a one-line definition that links to it; other docs
   point at it rather than restating.

## Build note (2026-06-21)
AC → file map (implementation):
- AC1 Privacy accuracy → `docs/privacy.html`
- AC2 Terms aligned → `docs/terms.html`
- AC3 Opportunity-cost framing (public) → `docs/index.html`, `docs/privacy.html`, `docs/terms.html`, `docs/support.html`, `docs/documentation.html`
- AC4 In-app copy → `client/src/components/PresenterControls.jsx`, `client/src/App.jsx`, `client/src/components/SharedCostScreen.jsx`
- AC5 Comments → `client/src/lib/cost.js`, `client/src/lib/overlayState.js`, `server/src/store/rateStore.js`, `client/src/lib/ratesApi.js`, `client/src/state/usePresenterStore.js`
- AC6 Internal docs (hybrid) → `dev-docs/opportunity-cost-rate.md` (new canonical), `README.md` (one-line + link), `dev-docs/roadmap.md`, `server/zoom-app-config.md`
- AC7 No behavior change → `cost.js` / `overlayState.js` diffs are comments only; no identifier/field/route/schema renames
- AC9 Multiplier neutralized + backlog flag → `client/src/components/PresenterControls.jsx`, `reviews/backlog.md`

Note: this branch also carries the earlier `marketplace-legal-pages` story; Codex reviews the full branch vs `main` and reads both spec files. PR step skipped — repo uses a local-merge workflow.

## Codex review (2026-06-21, base main, HEAD 4415098)
**Summary:** The branch preserves identifiers, routes, schemas, and application math,
but does not yet fully satisfy the documentation/framing specs. (Codex could not run the
gate under its read-only sandbox; the gate was run green locally before this review.)

### BLOCKER
1. **Privacy policy falsely says the server handles overlay snapshots** — `docs/privacy.html:75`.
   The "How our server handles your data" section lists the aggregate overlay snapshot as a
   second *server-handled* flow, but the app server has no overlay route — `buildOverlayState()`
   goes through Zoom's panel→camera message bridge, in-client. Suggestion: server handles only
   the saved config; describe the overlay aggregate as an in-client Zoom camera message the
   server never receives or retains.
2. **Privacy policy omits half the canonical definition** — `docs/privacy.html:38`. AC3 requires
   the full canonical definition on this page ("highest and best work" + both reasons). The page
   gives "best work" + pay-is-private only; missing "highest and best" and reason B (pay
   understates the cost).

### IMPORTANT
3. **Public docs misstate the per-participant math** — `docs/documentation.html:50` (also
   privacy.html, terms.html). Docs say the app multiplies per-person estimates by elapsed time
   *and participant count*; the per-participant model sums each person's value and prorates by
   elapsed time — count-multiplication belongs only to the simple-average model.
4. **Compensation-era comments remain in `client/src/lib/matching.js`** (lines 3, 12, 72) and
   `matching.test.js` ("hourly rate", "loaded-cost multiplier/overhead"). The comment reframe
   (AC5) missed this core module, leaving inconsistent framing.
5. **README duplicates the canonical definition** — `README.md:10`. Decision 4 wanted a one-line
   definition + link (single source of truth in dev-docs); the added block restates the full
   definition and both reasons across ~6 lines — the duplication the hybrid explicitly avoids.

Last-reviewed SHA: 4415098 (base for any re-review)
