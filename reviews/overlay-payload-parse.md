# overlay-payload-parse

Date: 2026-06-07 · Branch: claude/overlay-payload-parse · Status: approved

> **Approved (2026-06-07, Thomas):** "approve." Open questions take the proposed
> defaults: (1) no symmetric stringify on send — parse on receive only; (2) keep the
> ~1/sec diagnostics for this round, throttle once confirmed.

## Problem

The `camera-overlay-diagnostics` live trace proved the channel works end to end:
the panel (`inMeeting`) streams `postMessage ok` every second, and the camera
(`inCamera`) fires `overlay-message` every second, 1:1 with the sends. **No
topology problem, no sender-death, no need for a server relay.**

The one remaining defect: every `overlay-message` logged **`keys: null, status:
null`** — the message envelope arrives, but its **payload is not an object** when
our receive handler reads it. So `OverlayApp` sets null state and `CostOverlay`
renders nothing.

The SDK type says `OnMessageEvent = { timestamp, payload: JSONObject, … }`, yet
runtime hands us a non-object. Given the perfect 1:1 envelope delivery, the
overwhelmingly likely cause is that **the payload crosses the instance boundary as
a JSON string** (the annotation says `JSONObject`; runtime serializes), and our
handler — `const payload = evt?.payload ?? evt;` (`zoomAdapter.js`) — never
`JSON.parse`s it. `keys: null` (a string isn't an object) and `status: null`
(`string.status` is undefined) fit exactly.

This story makes the receive path **robustly extract + parse** the payload, and adds
a **shape-only boundary diagnostic** so the same deploy is self-confirming: if the
payload was a string, it now parses → the meter shows live values; if it turns out
to be genuinely `null`, the new log proves that (→ a follow-up addresses the send
shape, still no relay).

## In scope

- **Pure extraction helper.** New `client/src/lib/overlayMessage.js` exporting
  `normalizeIncomingMessage(evt)`: take `evt.payload` when `evt` is an object with a
  `payload` key, else `evt`; if the result is a **string**, `JSON.parse` it and
  return the parsed value; if parsing throws, return the original string unchanged;
  pass objects/null/undefined through as-is.
- **Wire into `RealZoom`.** `RealZoom.init`'s `onMessage` handler uses
  `normalizeIncomingMessage(evt)` before dispatching to `_msgSubs`, so a
  string-serialized snapshot reaches `OverlayApp` as the object.
- **Self-confirming diagnostic (shape only).** At the `RealZoom` receive boundary,
  emit a `lifecycle` `overlay-message-raw` log with **types/flags only** —
  `evtType`, `hasPayloadKey`, `payloadType` — never values. Enrich `OverlayApp`'s
  existing `overlay-message` log with `type` (the `typeof` of the normalized payload,
  `null`-cased) so the next live run shows object-vs-null at a glance.

## Non-goals

- **No change to the send path** (`App.postOverlay` / `RealZoom.postMessage` /
  `buildOverlayState`). We keep sending the object; the receive side parses. (Changing
  both risks double-encoding — see Open questions.)
- **No server relay**, no new endpoints, no `onRenderedAppOpened`.
- **No change** to the draw path, routing, or `CostOverlay` rendering.
- **No privacy-payload change** — `buildOverlayState` stays aggregate-only; the new
  logs carry only types/keys/flags, never names/rates/values.

## Acceptance criteria

1. **Robust extraction (unit-tested).** `normalizeIncomingMessage(evt)`:
   `{ payload: obj }` → `obj`; `{ payload: '<json>' }` → parsed object; bare
   `'<json>'` → parsed object; a plain object (no `payload` key) → itself; an invalid
   JSON string → the string unchanged; `null`/`undefined` → `null`/`undefined`.
2. **Receive path parses.** `RealZoom.init`'s `onMessage` dispatches
   `normalizeIncomingMessage(evt)` to subscribers — verified by a test where the fake
   SDK delivers `{ payload: JSON.stringify(snapshot) }` and the `RealZoom.onMessage`
   subscriber receives the **parsed object** (deep-equal to `snapshot`).
3. **Self-confirming diagnostic.** A `lifecycle`/`overlay-message-raw` entry is emitted
   at the receive boundary with `evtType` / `hasPayloadKey` / `payloadType` (no
   values); `OverlayApp`'s `overlay-message` log includes a `type` field. (Shape
   reviewed by reading; behaviour confirmed by the live run.)
4. **Containment + privacy.** The diff touches only: `client/src/lib/overlayMessage.js`
   (+ test), `client/src/zoom/zoomAdapter.js`, `client/src/zoom/zoomAdapter.test.js`,
   `client/src/components/OverlayApp.jsx`, and `reviews/overlay-payload-parse.md`. No
   send-path / draw / routing change; new logs carry only types/keys/flags.
5. **Gate green.** `npm test && npm run build` passes.

## Test notes

- **AC1** — unit-test `normalizeIncomingMessage` across the six cases above (pure,
  node-testable).
- **AC2** — extend `zoomAdapter.test.js`: add `onMessage(cb)` + a `fireMessage(evt)`
  helper to the fake SDK (the fake had no `onMessage` — this also closes the receive-
  path coverage gap deferred from the diagnostics review), then assert that after
  `init()`, firing `{ payload: JSON.stringify(snap) }` delivers `snap` (object) to a
  `RealZoom.onMessage` subscriber.
- **AC3** — shape-only; verified by reading the new log fields + the next live run.
- **AC4** — run `git diff --name-only main...HEAD` and verify no files appear beyond
  those AC4 enumerates.
- **AC5** — `npm test && npm run build`.

## Open questions

1. **Symmetric stringify on send?** We keep sending the object and only parse on
   receive (matches the observed string-on-arrival). Should we also `JSON.stringify`
   on send for symmetry? *Proposed: no* — if Zoom passes the object through verbatim
   in some clients, stringifying both sides risks double-encoding; receive-side
   parse-if-string handles both. Revisit only if the live `overlay-message-raw` log
   shows the payload arriving `null` (not a string).
2. **Diagnostic permanence/volume.** `overlay-message-raw` fires ~1/sec like
   `overlay-message`. *Proposed: keep for this debugging round* (consistent with the
   diagnostics story's decision), throttle once the meter is confirmed working.

## Build note (2026-06-07)

AC → file map:

- **AC1** (normalizeIncomingMessage) — `client/src/lib/overlayMessage.js` (+ `overlayMessage.test.js`)
- **AC2** (RealZoom receive path parses) — `client/src/zoom/zoomAdapter.js` (`init` onMessage); fake `onMessage`/`fireMessage` + receive tests in `client/src/zoom/zoomAdapter.test.js`
- **AC3** (self-confirming diagnostic) — `client/src/zoom/zoomAdapter.js` (`overlay-message-raw`), `client/src/components/OverlayApp.jsx` (`type` on `overlay-message`)
- **AC4** (containment + privacy) — diff scoped to the above + story file
- **AC5** (gate) — full suite + build
