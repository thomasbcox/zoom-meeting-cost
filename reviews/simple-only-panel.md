Date: 2026-07-12 · Branch: claude/simple-only-panel · Status: approved

# simple-only-panel — strip Meeting Cost to the dead-simple MVP (client)

## Problem

Meeting Cost carries a full per-participant cost model (a private rate table, name matching + aliases,
per-attendee overrides, roles, server-persisted config, past-meeting history) bolted around a much
simpler path that already exists and is the default: the `simple` model — `computeSimpleTotals` =
`attendeeCount × hourlyRate` (`client/src/lib/cost.js`). Thomas has decided to ship a **dead-simple
production version**: a manual attendee count + one user-supplied hourly rate driving the taxi meter,
with a vastly simplified panel. This is **Story 1 of 2** (client-side, mostly deletion); the
server-side rate store is removed separately in **Story 2 (`remove-rate-store`)**.

## In scope (client only)

- Make `simple` the **only** cost model; compute the meter directly from a manual count × one rate.
- Attendee count becomes a **plain manual number** — drop the participant-list dependency entirely.
- Panel runs **session-only** (no persistence): the store stops calling `/api/rates`.
- New defaults **2 attendees × $100/hr**; cadence set **{1, 10} s, default 10**; fold in **BUG-2**'s fix.
- Drop **roles** and **past-meetings history**; rebuild the panel to the minimal control set.
- Close **OPS-1** and **BUG-2** in the backlog.

## Non-goals (explicitly deferred / untouched)

- **Story 2**: the server-side store — `/api/rates`, `rateCrypto`, identity, `RATE_STORE_KEY`, the
  Railway Volume, export/delete. Left fully in place here (just no longer called by the client).
- **Story 2**: marketplace/scope-doc reconciliation (`server/zoom-app-config.md` `meeting:read:participant`,
  README, `dev-docs/railway-setup.md`). The client stops *needing* the participant scope, but the
  Marketplace config + docs are reconciled in Story 2.
- No teardown observability (heartbeat) — deferred.
- No visual redesign beyond the strip-down; reuse existing styles + the `NumberInput` control.
- Keep the camera-overlay pipeline (`runRenderingContext`, `drawWebView`, `drawParticipant`,
  `extrapolateOverlay` self-accrual, camera off/on recovery, `CostOverlay`), session start/pause/end,
  security headers, `/api/health`.

## Acceptance criteria

1. **Simple-only cost.** The per-participant model is gone: `computeTotals`, model-branching in
   `selectActiveTotals`, `matching.js`/`resolveAll`, `rateTable.js`, aliases, and `saveToList.js` are
   removed. The meter = `computeSimpleTotals({ userCount, averageRate })`.
2. **Manual count; no participant list.** The client no longer calls `getMeetingParticipants` /
   `onParticipantChange`; count is a manual numeric input (no live-count prefill/tracking, no
   `participantsAvailable`). `zoomAdapter` no longer refreshes/exposes a participant list. **Self-UUID
   for the base video comes from `getUserContext().participantUUID` only** — the participant-list-match
   fallback in `_resolveSelfUUID` is removed. `drawCameraOverlay` still draws the base video when that
   UUID is present and the meter (`drawWebView`) regardless; message bridge + camera off/on recovery
   unchanged. *(Binding pre-ship gate — Finding ①: a live dev run must confirm
   `getUserContext().participantUUID` resolves in-meeting, read from the existing `drawParticipant
   ok:true` vs `{ok:false, error:'no self participantUUID'}` log, BEFORE merge.)*
3. **Session-only (no client persistence) + dead identity removed.** `usePresenterStore` no longer
   imports/uses `ratesApi` (load/save/hydrate removed); config is in-memory for the session.
   `ratesApi.js` (+test) — now a dead client module — is removed. The client identity used only by the
   rate store is also removed: `getAppContext` from both adapters and the `getAppContext` +
   `getMeetingParticipants` entries in `ZOOM_CAPABILITIES`, with their dead tests (Finding ②). Nothing
   under `server/**`, `/api/rates`, or the Marketplace scope declaration changes — those are Story 2.
4. **Defaults.** Initial config: **2 attendees, $100/hr, cadence 10 s**.
5. **Cadence {1, 10}, default 10.** `DISPLAY_INTERVALS = [1, 10]`, default 10; the 60 s option and its
   `formatCadenceDuration` (`>= 60`) branch are removed.
6. **BUG-2 fixed.** At the 1 s cadence the displayed meter changes **at most once per second** (quantize
   when `stepSeconds >= 1`); internal accrual stays continuous.
7. **Roles + history dropped.** `RoleBar`, `role.js`, role gating (`canPerParticipant`),
   `SharedCostScreen`, `meetingSummary.js`, and the past-meetings / `meetingHistory` feature are removed
   from the panel and store.
8. **Panel rebuilt.** `PresenterControls` shows only: hourly-rate input, attendee-count input, cadence
   toggle {1,10}, Show/Hide on video, session controls, and the live readout + viewer preview. No
   cost-model toggle, rate table, aliases, overrides, or past-meetings.
9. **Backlog.** `OPS-1` (participant self-heal poll — now moot) and `BUG-2` (fixed) moved to **Done**.
10. **Dead tests gone; gate green.** Tests for every removed module are deleted; rewritten/surviving
    tests pass. `npm test && npm run build` is green.

## Test notes

- AC1/AC2/AC3/AC7: `git grep` confirms the removed symbols/modules are gone from `client/src`; read the
  rewritten `App.jsx`, `PresenterControls.jsx`, `usePresenterStore.js`, `cost.js`, `zoomAdapter.js` to
  confirm the surviving overlay/session logic is intact.
- AC4: read `usePresenterStore.js` default config (2 / 100 / 10).
- AC5/AC6: `displayCadence.test.js` — `DISPLAY_INTERVALS` is `[1,10]`; `quantizeForDisplay` floors at
  `step = 1`; no `>= 60` formatting branch.
- AC9: read `BACKLOG.md` — OPS-1 + BUG-2 under `## Done`.
- AC10: the gate runs the suite + build.
- **Scope containment:** run `git diff --name-only main...HEAD` and verify no files appear beyond those
  enumerated in the Design sketch file list.

## Open questions

1. **Story size.** ~18 files, including *rewrites* of `App.jsx`, `PresenterControls.jsx`,
   `usePresenterStore.js`, `cost.js`, and `zoomAdapter.js`. Mostly deletion, but the `zoomAdapter`
   participant-list removal is the one semi-independent chunk. Keep as one story, or peel the
   `zoomAdapter` participant removal into a **Story 1a**? *Recommend: keep as one — it's cohesive and
   the deletions interlock (App can't drop the participant path while the adapter still feeds it).*
2. **`role.js` fully removed?** Dropping role gating leaves `role.js`/`isHostRole` with no consumer.
   *Recommend: remove entirely — anyone running the app shows the meter on their own camera; no
   host-only gate remains.* Confirm there's no residual role need (e.g., gating who can Show).
3. **`zoomDiagnostics.js`** logs participant/user-context *shape* (no PII). Trim its participant-list
   part, or leave it? *Recommend: leave unless it imports a deleted module; it's harmless observability
   and reconciling it belongs with the Story 2 marketplace pass.*
4. **`ratesApi.js` deleted here** (dead client caller once the store stops using it) vs left for Story 2.
   *Recommend: delete here — it's dead **client** code; Story 2 is server-only.*

## Design sketch — HOW

Pure simplification: make the existing `simple` path the whole app and delete the per-participant/
persistence/roles/history scaffolding around it. No new dependency, data model, or cross-cutting pattern.

- **Config shape (session-only, in-memory):** `{ simpleAverageRate: 100, simpleUserCount: 2,
  displayIntervalSeconds: 10 }`. No `rateTable` / `aliases` / `overrides` / `meetingHistory`.
- **`state/usePresenterStore.js`** → a thin `useState(DEFAULT_CONFIG)` exposing `setSimpleAverageRate`,
  `setSimpleUserCount`, `setDisplayInterval`. Drop `ratesApi` load/save/hydrate, `repairConfig`,
  `meetingSummary`, `rateTable`, overrides, and the debounced-persist effect.
- **`lib/cost.js`** → keep `computeSimpleTotals`, `formatMoney`, `formatDuration`. Delete
  `computeTotals`, `selectActiveTotals` model branching (collapse to compute-simple or call
  `computeSimpleTotals` directly from App), and the participant-tracking helpers
  (`simpleLiveCount` / `simpleCountDisplay` / `simpleCountCommit`). Count is a plain non-neg clamp.
- **`App.jsx`** → remove `participants` state, `resolveAll`, `role`/`canPerParticipant`/effective-model,
  `liveCountForSimple`, `summaryRef`/`addMeetingSummary`, `RoleBar`, `SharedCostScreen`. Compute
  `totals = computeSimpleTotals({ userCount: config.simpleUserCount, averageRate:
  config.simpleAverageRate })`. Keep the 1 s accrual tick, `postOverlay`/`buildOverlayState`, camera
  recovery poll, viewer preview (`quantizeForDisplay`), and `OverlayApp` routing.
- **`components/PresenterControls.jsx`** → keep the `SimpleCostPanel` (rate + count) + cadence toggle +
  Show/Hide + session controls + preview; delete `RateTableEditor` / `AliasEditor` / `OverridesEditor` /
  `PastMeetings` / the cost-model toggle and their imports.
- **`lib/displayCadence.js`** → `DISPLAY_INTERVALS = [1, 10]`, default `10`; `quantizeForDisplay` guard
  becomes `step >= 1` (BUG-2 fix); drop the `>= 60` branch in `formatCadenceDuration`.
- **`zoom/zoomAdapter.js`** → remove `getMeetingParticipants` / `onParticipantChange` / participant
  refresh / `matching` import; keep `runRenderingContext`, `drawParticipant` (base video), `drawWebView`,
  the message bridge, and `getVideoState` recovery.
- **`OverlayApp.jsx`** stays as-is — the BUG-2 fix lives in `quantizeForDisplay`, so the 250 ms
  re-render now shows a value that only changes on second boundaries.

**File list (scope-containment AC):**
- *Delete (module + test):* `client/src/lib/matching.js`(+`.test.js`), `client/src/lib/rateTable.js`(+test),
  `client/src/lib/saveToList.js`(+test), `client/src/lib/ratesApi.js`(+test),
  `client/src/lib/meetingSummary.js`(+test), `client/src/lib/role.js`(+test),
  `client/src/lib/presenterName.js`(+test) — orphaned once the presenter-name/role UI was dropped
- *Delete (component, no test):* `client/src/components/RoleBar.jsx`, `client/src/components/SharedCostScreen.jsx`
- *Rewrite:* `client/src/App.jsx`, `client/src/components/PresenterControls.jsx`,
  `client/src/state/usePresenterStore.js`(+`.test.js`), `client/src/lib/cost.js`(+`.test.js`),
  `client/src/lib/displayCadence.js`(+`.test.js`), `client/src/zoom/zoomAdapter.js`(+`.test.js`)
- *Test-only edit:* `client/src/components/CostOverlay.test.js` — drop the retired 60 s cadence-clock test.
- *Backlog:* `BACKLOG.md`
- *Not touched (Open Q3 resolved):* `client/src/zoom/zoomDiagnostics.js` imports only `postLog` — left as-is.
  `client/src/Root.jsx` still harmlessly passes `self`/`initialParticipants` (App ignores them) — left for a follow-up tidy.

## Codex design review (2026-07-12)

**Verdict:** shape sound, cohesive, repo-consistent — *"React `useState` is sufficient, existing pure
cost/cadence helpers remain appropriate, no dependency offers a meaningfully simpler solution; I would
build it substantially this way"* — with two boundary omissions to resolve first.

### IMPORTANT (both two-way · kludgy)
1. **Participant removal can silently weaken the base-video pipeline** — `_resolveSelfUUID` prefers
   `getUserContext().participantUUID` but falls back to matching self against the refreshed participant
   list; `drawCameraOverlay` draws the presenter's video base only when a self-UUID resolves. Removing
   the list deletes the fallback, so if `getUserContext` lacks a `participantUUID` the base video is
   skipped — contradicting AC2. **Alternative:** state + verify the self-UUID contract from
   `getUserContext`; revise scope if the SDK doesn't guarantee it. **Win:** no silent base-video
   regression.
2. **Dead client identity capability left behind** — `getAppContext` (+ its `ZOOM_CAPABILITIES` entry)
   exists solely for the rate-store presenter identity; after persistence it's dead client code.
   **Alternative:** remove `getAppContext` from both adapters + `ZOOM_CAPABILITIES` + tests in Story 1;
   leave server identity/routes/Marketplace for Story 2. **Win:** the client-first boundary is complete.

## Design decisions (2026-07-12)

Thomas's decision, verbatim: **"fix both, verify getUserContext live before ship"** — scope approved,
both findings fixed.

- **Finding ① (base video) — FIXED (scope adjusted + live gate).** Keep `getUserContext` as the
  self-UUID source; remove only the participant list/refresh/tracking and the `_resolveSelfUUID`
  list-match fallback (AC2 reworded). **Binding pre-ship gate:** before the `/close` merge, a live dev
  run must confirm `getUserContext().participantUUID` resolves in-meeting — read from the existing
  `drawParticipant` log (`ok:true` = resolved; `{ok:false, error:'no self participantUUID'}` = not).
  If it does not resolve, STOP and revisit — do not ship a bare-meter base.
- **Finding ② (dead identity) — FIXED (client-only).** Remove `getAppContext` from both adapters + drop
  `getAppContext`/`getMeetingParticipants` from `ZOOM_CAPABILITIES` + dead tests (folded into AC3).
  Server identity / `/api/rates` / Marketplace scope untouched (Story 2).
- **Open questions — resolved per recommendation (scope approved):** (1) keep as one story; (2) remove
  `role.js` entirely; (3) leave `zoomDiagnostics` unless it imports a deleted module; (4) delete
  `ratesApi.js` in this story.
