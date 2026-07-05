Date: 2026-07-04 · Branch: claude/meeting-summary-history · Status: approved

## Problem

Thomas's original criticism #4: nothing about a meeting survives its end. He wants a summary
that persists — reporting the final dollar amount that was displayed, plus a bit of context —
"like an entry on the saved chat log or some message somewhere persistent."

Constraint established earlier: **posting to Zoom's in-meeting chat is not possible** — the
Zoom Apps SDK has no chat-send capability (`ZOOM_CAPABILITIES` confirms). So "survive the end"
is delivered as **server-persisted meeting history** (reusing the encrypted per-user store)
shown in the panel, plus a **copy-to-clipboard** summary the presenter can paste into chat
manually.

## In scope

- On **"End session"**, capture a summary of the just-ended session and persist it:
  `{ id, endedAt, totalCost, durationSeconds, headcount, costPerMinute, costModel }` —
  aggregates only (no names/rates). Trivial ends (no elapsed time) save nothing.
- Persist by **piggybacking on the existing per-user encrypted config blob**
  (`config.meetingHistory: []`, capped newest-first at 20) — reusing `/api/rates` persistence
  and the `userData` export/delete plumbing (no new store/endpoint/privacy registration). To
  make history **durable** despite the debounced settings save (Codex BLOCKER):
  - the append **flushes immediately** on End (not on the 800 ms debounce), and
  - the server **merge-preserves** `meetingHistory` on every `PUT /api/rates` — it unions the
    incoming rows with the stored rows (dedup by `id`, keep newest 20), so a `PUT` can only
    **add** history, never drop it. A stale/older client can no longer wipe it.
- A **"Past meetings"** panel section listing stored summaries (newest first): date, total,
  duration, headcount, $/min.
- A **"Copy summary"** action per meeting → one-line text to the clipboard (best-effort); the
  same text is rendered so it can be selected/copied manually as a fallback.
- **Snapshot correctness:** the End handler reads the *current* headcount / cost model /
  cost-rate via a per-render ref (not stale memoized values).
- **Privacy disclosure:** update the in-app saved-data notice and the privacy page to say
  aggregate past-meeting summaries are stored with the presenter config (operator-decryptable,
  included in export/delete).
- Build / append / format / merge logic in **pure, unit-tested** helpers; server-side
  validation of `meetingHistory`.

## Non-goals

- **No posting to Zoom's in-meeting chat** (no SDK capability) — copy-to-paste is the manual path.
- **No auto-save on meeting close / app teardown** — teardown is unreliable; the trigger is the
  explicit **"End session"** (with the immediate flush above closing the quick-close window).
- **No meeting topic / UUID** in the record — needs new adapter SDK plumbing (`getMeetingContext`).
- **No deletion of individual history rows** — the server merge is add-only (union); bulk
  removal remains via the existing account **delete-my-data**. (Noted limitation.)
- **No new server store / endpoint** — reuse the existing encrypted config blob + `PUT /api/rates`.
- **No per-person data** in summaries — aggregates only; the privacy boundary is unchanged.

## Acceptance criteria

1. On **"End session"** with `durationSeconds > 0`, a summary
   `{ id, endedAt, totalCost, durationSeconds, headcount, costPerMinute, costModel }` is
   prepended to `config.meetingHistory` (newest-first, cap 20) and **flushed to the server
   immediately** (not waiting for the debounce). Ending with no elapsed time appends nothing.
2. The End summary reflects the **current** session values — total, duration, **headcount**,
   **cost model**, and **$/min** as of End — not stale initial-render values.
3. `PUT /api/rates` **merge-preserves** `meetingHistory`: the saved value is the union of the
   request's rows and the stored rows, deduped by `id`, capped newest-first to 20 — so a `PUT`
   never removes history (a settings-only or stale client cannot wipe it).
4. A **"Past meetings"** panel lists summaries newest-first (date, total, duration, headcount,
   $/min) with an empty-state message when there are none; a per-row **"Copy summary"** copies a
   formatted one-line summary to the clipboard (best-effort), with the same text visible as a
   fallback.
5. The server **validates** `meetingHistory` on save: an array (length ≤ 50) of rows with
   `strOrNull(id)`, finite `endedAt > 0`, `numNonNeg` `totalCost`/`durationSeconds`/`headcount`/
   `costPerMinute`, and known-or-absent `costModel`; a malformed blob → 400. A config **without**
   `meetingHistory` still round-trips (backward compatible).
6. The **build / append / format / merge** logic lives in **pure exported helpers** with unit
   tests; the in-app saved-data notice and the privacy page disclose stored meeting summaries.
7. Scope containment: `git diff --name-only main...HEAD` shows no files beyond
   `client/src/lib/meetingSummary.js` (+ test), `client/src/state/usePresenterStore.js`,
   `client/src/App.jsx`, `client/src/components/PresenterControls.jsx`, `client/src/styles.css`,
   `server/src/store/rateStore.js`, `server/src/app.js`, `server/test/rateStore.test.js`,
   `server/test/rates.test.js`, `docs/privacy.html`, and `reviews/meeting-summary-history*`.

## Test notes

- **AC1/AC6 (helpers):** `client/src/lib/meetingSummary.test.js` — `buildMeetingSummary(...)`
  computes `durationSeconds` (rounded) + `costPerMinute` (`costPerSecond*60`); `appendSummary`
  prepends and caps (21→20); `isRecordable` false at `durationSeconds === 0`;
  `formatMeetingSummary(s)` returns the expected one-line string.
- **AC3/AC5 (server):** `server/test/rateStore.test.js` — `validateConfig` accepts a well-formed
  `meetingHistory`, rejects a non-array / bad-`endedAt` / negative-or-NaN numeric / wrong-typed
  row / over-length array, and still accepts a config **omitting** it; `mergeHistory(incoming,
  stored)` unions + dedups by `id` + caps newest-first. `server/test/rates.test.js` — a
  `PUT` that omits `meetingHistory` preserves the stored rows; a `PUT` adding a new row keeps
  the old ones (union), capped.
- **AC2:** the store-wiring reads current values via the per-render ref — asserted indirectly
  by the helper inputs; the `App` ref wiring is verified by the diff (integration-level).
- **AC4:** verified by the diff (the `PastMeetings` section + copy handler); presentational,
  fed by the store — no node-env render harness. The clipboard call is guarded (best-effort);
  the fallback text is the same `formatMeetingSummary`.
- **AC7 (scope containment):** run `git diff --name-only main...HEAD` and verify no files appear
  beyond those AC7 enumerates.
- Gate: `npm test && npm run build`.

## Open questions

1. **BLOCKER fix — chosen approach.** Recommend **Option B: immediate flush on End + server
   union-merge-preserve on `PUT`** (no new endpoint; add-only history; smallest correct change).
   The alternative Codex offered is a dedicated `POST /api/history` append endpoint (fuller
   separation, more surface). Ratify Option B?
2. **History cap.** Client 20, server rejects `> 50`. OK?
3. **Copy affordance.** Per-row "Copy" + visible selectable text (clipboard best-effort — the
   Zoom webview may restrict `navigator.clipboard`). Acceptable, or prefer a download?

## Design sketch — HOW

- **Data model:** `config.meetingHistory: Array<{ id, endedAt, totalCost, durationSeconds,
  headcount, costPerMinute, costModel }>` (aggregates only) in the existing encrypted per-user
  blob. `DEFAULT_CONFIG.meetingHistory = []`. Persists/exports/deletes via existing paths.
- **Helpers (`client/src/lib/meetingSummary.js`), pure/node-testable:**
  `buildMeetingSummary({ endedAt, totalCost, elapsedSeconds, headcount, costPerSecond, costModel })`
  (`durationSeconds = round`, `costPerMinute = costPerSecond*60`);
  `appendSummary(history, s, max=20)` = `[s, ...history].slice(0, max)`;
  `formatMeetingSummary(s)` one-line text; `isRecordable(s)` = `durationSeconds > 0`.
- **Store (`usePresenterStore`):** `DEFAULT_CONFIG.meetingHistory = []`; `addMeetingSummary(s)`
  assigns `id` (`newId('m')`), computes `next = { ...c, meetingHistory: appendSummary(...) }`,
  `setPersisted(next)`, **and immediately** `saveRates(adapter, next)` (flush now — the debounced
  effect stays as a retry). `saveRates` continues to send the whole config; the server owns the
  merge (below), so the client needn't strip history.
- **App (`sessionActions.end`):** keep `sessionActions` stable; add a `summaryInputsRef`
  updated each render (parallel to `liveRef`) holding `{ costPerSecond: totals.costPerSecond,
  headcount: participants.length, costModel: config.costModel }`. `end()` builds the summary
  from `totalRef`/`elapsedRef` + `summaryInputsRef.current` via `buildMeetingSummary`; if
  `isRecordable`, `actions.addMeetingSummary(summary)`; then `setSession({status:'ended'})`.
  `Date.now()` is available (app runtime).
- **UI (`PresenterControls`):** a `PastMeetings` section over `config.meetingHistory` (date,
  `$total`, `mm:ss`, headcount, `$/min`) with per-row "Copy" → `try { navigator.clipboard?.
  writeText(formatMeetingSummary(s)); } catch {}` and the text rendered (muted, selectable).
  Empty-state row when none. Also update the ⚠️ saved-data notice to mention stored summaries.
  Reuses `.panel` / `.edit-table` / `.btn.tiny`.
- **Server (`rateStore.js` + `app.js`):**
  - `validateConfig`: if `meetingHistory` present → `Array.isArray`, length ≤ 50, each row an
    object with `strOrNull(id)`, finite `endedAt > 0`, `numNonNeg` numeric fields, and
    `costModel` known-or-absent; else `null`. Absent → unchanged.
  - `mergeHistory(incoming = [], stored = [], max = 20)` — dedup by `id` (incoming wins), keep
    newest-first by `endedAt`, cap. Pure, tested.
  - `PUT /api/rates`: after `validateConfig`, **load** the existing blob and set
    `cfg.meetingHistory = mergeHistory(cfg.meetingHistory, existing?.meetingHistory)` before
    `save` — so every write preserves/adds history. (One extra read on PUT; negligible.)
- **Privacy (`docs/privacy.html`):** add that aggregate past-meeting summaries (ended time,
  duration, total, headcount, model — no names/rates) are stored with the presenter config,
  operator-decryptable, and included in export/delete.
- No new dependency; no new store or endpoint.

## Codex design review (2026-07-04)

**Verdict: storage direction right (capped aggregate history in the encrypted per-user blob
beats a new store; server shape-validation + 100 kb limit are a sound bound) — but not
merge-ready as sketched.** Three findings, all folded into the revised spec/sketch above.

- **[BLOCKER · one-way · kludgy] History append rode a debounced whole-config PUT.** The
  800 ms debounce loses a row on quick panel close, and a stale client saving a config without
  `meetingHistory` wipes existing history — data loss of the feature's primary artifact.
  _Alternative:_ explicit durable write (immediate flush on End) + server preserve/merge of
  `meetingHistory` (or a dedicated append endpoint). _Win:_ keeps reuse/export/delete while
  eliminating quick-teardown loss and stale overwrites. **→ Option B (immediate flush + server
  union-merge-preserve on PUT), Open Q1 / AC1 / AC3.**
- **[IMPORTANT · two-way · kludgy] End snapshot needs an explicit dependency strategy.**
  `sessionActions` is memoized with `[]`; reading `totals`/`participants.length`/`config` in
  `end()` in place would capture stale initial-render values (right total/duration refs, wrong
  headcount/model/$-per-min). _Alternative:_ a per-render `summaryInputsRef` (parallel to
  `liveRef`) or dependency-listed memo. **→ `summaryInputsRef`, AC2.**
- **[IMPORTANT · two-way · nonstandard] Stored history needs a privacy disclosure.** The blob
  now also holds meeting metadata (ended time, duration, total, headcount, model); existing
  copy describes mainly the value table. _Alternative:_ update the in-app notice + privacy page
  to disclose aggregate summaries (operator-decryptable, in export/delete), keeping the
  no-names/no-per-person boundary explicit. **→ AC6, `docs/privacy.html` + in-app notice.**

## Design decisions (2026-07-04)

Thomas: "accept all." Dispositions:

1. **BLOCKER (history durability)** — **fix via Option B:** immediate flush on End + server
   union-merge-preserve of `meetingHistory` on `PUT /api/rates` (no new endpoint; add-only).
2. **IMPORTANT (End snapshot)** — **fix:** per-render `summaryInputsRef` for current
   headcount/model/cost-rate.
3. **IMPORTANT (privacy disclosure)** — **fix:** in-app saved-data notice + `docs/privacy.html`.
4. Open questions: cap **20 client / reject >50 server**; copy = **per-row button + selectable
   text, clipboard best-effort**.

This shape is binding on implementation.

## Build note (2026-07-04)

AC → file map:

- **AC1 (record on End + immediate flush)** — `client/src/App.jsx` (`sessionActions.end` +
  `summaryRef`), `client/src/state/usePresenterStore.js` (`addMeetingSummary`).
- **AC2 (current-value snapshot)** — `client/src/App.jsx` (`summaryRef` updated each render).
- **AC3 (PUT merge-preserve)** — `server/src/app.js` (guarded merge), `server/src/store/rateStore.js`
  (`mergeHistory`).
- **AC4 (Past meetings panel + copy)** — `client/src/components/PresenterControls.jsx`
  (`PastMeetings`), `client/src/styles.css`.
- **AC5 (server validation)** — `server/src/store/rateStore.js` (`validateConfig` history block).
- **AC6 (pure helpers + privacy)** — `client/src/lib/meetingSummary.js`; in-app notice
  (`PresenterControls.jsx`) + `docs/privacy.html`.
- Tests: `client/src/lib/meetingSummary.test.js`, `server/test/rateStore.test.js`,
  `server/test/rates.test.js`.
- **AC7 (scope)** — `git diff --name-only main...HEAD`.

## Codex approach review (2026-07-04, base main, HEAD 8363140)

**Verdict: mostly the right shape (capped aggregate history in the existing blob, pure
helpers, server union-preserve, no new store/endpoint) — two shape issues.**

- **[BLOCKER · two-way · kludgy] Hydration gate can drop an End-session append.**
  `addMeetingSummary` flushes only when `hydratedRef.current` is true (and the debounced save
  is likewise hydration-gated). If a presenter ends a `durationSeconds > 0` session **before
  the boot `loadRates` resolves** — and especially when it returns `null` (new user, no later
  `setPersisted` to re-trigger the debounce) — the summary stays in local state and never
  persists. Real (if narrow) AC1 loss path for the feature's primary artifact.
  _Alternative:_ queue pending summaries while unhydrated and merge/flush them once load
  finishes (still `/api/rates` + server merge-preserve). _Win:_ "End with duration > 0
  persists" holds in every client lifecycle state.
- **[IMPORTANT · two-way · kludgy] Summary headcount has a second source of truth.** The
  summary stores `participants.length`, but the displayed total/$-per-min use
  `totals.attendeeCount` — which in **simple mode** honors the explicit attendee-count
  override. So a simple-mode session with a manual N saves a total computed from N but a
  headcount of the live count — inconsistent. _Alternative:_ take `headcount` from
  `totals.attendeeCount` (same snapshot the UI shows). _Win:_ the persisted/copied summary
  matches the numbers the presenter saw.

(Codex could not run the suite — read-only sandbox `EPERM` on Vite's temp write; gate was
green locally.)
