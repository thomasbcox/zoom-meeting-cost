// Zoom integration adapter.
//
// The rest of the app talks ONLY to this interface:
//
//   adapter.init()                  -> { context, self, participants }
//   adapter.getParticipants()       -> Participant[]
//   adapter.participantsAvailable() -> boolean (false if the fetch failed)
//   adapter.onParticipantsChange(cb)-> unsubscribe()
//   adapter.startCameraOverlay()    -> render the app onto the camera feed
//   adapter.stopCameraOverlay()     -> stop rendering onto the camera feed
//   adapter.postMessage(payload)    -> side panel -> camera context state push
//   adapter.onMessage(cb)           -> camera context receives state; unsubscribe()
//   adapter.isMock                  -> boolean
//
// where Participant = { id, displayName, email? }
//
// Two implementations:
//   - MockZoom  : used in the local prototype. Lets the UI add/remove fake
//                 participants to simulate join/leave, mirroring real Zoom
//                 events (which arrive from the SDK, not from the UI). The
//                 camera-overlay methods are recorded and the message bridge
//                 loops back so the simulated overlay preview can be exercised.
//   - RealZoom  : wraps @zoom/appssdk. Wired but only used when running inside
//                 the Zoom client. Left as a clearly-marked integration point.

import { postLog } from '../lib/postLog.js';
import { isZoomLikeEnvironment, decideAdapter } from './zoomEnv.js';

// Capabilities requested in zoomSdk.config(). Includes the camera-rendering and
// inter-webview messaging APIs the overlay needs. Exported so it can be asserted
// in tests and kept in sync with server/zoom-app-config.md.
export const ZOOM_CAPABILITIES = [
  'getRunningContext',
  'getMeetingContext',
  'getMeetingParticipants',
  'getUserContext',
  'onParticipantChange',
  // Camera overlay (Layers API):
  'runRenderingContext',
  'drawWebView',
  'clearWebView',
  'closeRenderingContext',
  // The camera instance composites the presenter's own video as the base layer
  // under the overlay webview. drawParticipant needs onMyMediaChange's media
  // info; both must also be enabled in the Marketplace dashboard.
  'drawParticipant',
  'onMyMediaChange',
  // Side panel -> camera-overlay state push. In camera (Layers) mode the panel
  // calls postMessage directly and the inCamera instance receives via onMessage
  // (matching Zoom's official camera-mode sample) — NO connect()/onConnect handshake.
  // connect/onConnect is the separate meeting<->main-client mirroring feature, which
  // this app does not use; requesting it here would only invite the inCamera connect
  // rejection we saw live ("API can only be called when running in a meeting").
  'postMessage',
  'onMessage',
];

// Defensive fallback for the camera surface dimensions when sdk.config() does
// not report config.media.renderTarget. Matches the previous hardcode.
const DEFAULT_RENDER_TARGET = { width: 1280, height: 720 };

const SEED_PARTICIPANTS = [
  { id: 'p1', displayName: 'Thomas Cox' },
  { id: 'p2', displayName: 'Jane Smith' },
  { id: 'p3', displayName: 'Acme CFO' },
  { id: 'p4', displayName: 'Dana Rivera' }, // intentionally unmatched -> default
];

export class MockZoom {
  constructor() {
    this.isMock = true;
    this._participants = [...SEED_PARTICIPANTS];
    this._subs = new Set();
    this._nextId = 5;
    // Camera-overlay instrumentation: recorded SDK calls + message loopback.
    this.calls = [];
    this._msgSubs = new Set();
    this._lastMsg = null;
  }

  async init() {
    return {
      context: { runningContext: 'inMeeting', meetingID: 'demo-meeting' },
      self: { id: 'p1', displayName: 'Thomas Cox' },
      participants: this.getParticipants(),
    };
  }

  getParticipants() {
    return this._participants.map((p) => ({ ...p }));
  }

  // The mock prototype always has a participant list, so it is never "unavailable".
  participantsAvailable() {
    return true;
  }

  onParticipantsChange(cb) {
    this._subs.add(cb);
    return () => this._subs.delete(cb);
  }

  _emit() {
    const snapshot = this.getParticipants();
    for (const cb of this._subs) cb(snapshot);
  }

  // --- Camera overlay (mock: record calls; no real compositing) -----------
  // The panel only spawns the camera rendering context; the actual compositing
  // happens in the camera instance via drawCameraOverlay (mirrors RealZoom).
  async startCameraOverlay() {
    this.calls.push({ method: 'runRenderingContext', view: 'camera' });
  }

  async drawCameraOverlay() {
    this.calls.push({ method: 'drawParticipant' });
    this.calls.push({ method: 'drawWebView', webviewId: 'camera' });
  }

  async clearCameraOverlay() {
    this.calls.push({ method: 'clearWebView', webviewId: 'camera' });
  }

  async stopCameraOverlay() {
    this.calls.push({ method: 'closeRenderingContext' });
  }

  // --- State bridge (mock: loop back so the simulated overlay updates) -----
  postMessage(payload) {
    this._lastMsg = payload;
    for (const cb of this._msgSubs) cb(payload);
  }

  onMessage(cb) {
    this._msgSubs.add(cb);
    if (this._lastMsg) cb(this._lastMsg); // replay latest for late subscribers
    return () => this._msgSubs.delete(cb);
  }

  // --- Prototype-only controls (simulate Zoom join/leave events) ----------
  addParticipant(displayName) {
    const name = (displayName || '').trim();
    if (!name) return;
    this._participants.push({ id: `p${this._nextId++}`, displayName: name });
    this._emit();
  }

  removeParticipant(id) {
    this._participants = this._participants.filter((p) => p.id !== id);
    this._emit();
  }

  renameParticipant(id, displayName) {
    const p = this._participants.find((x) => x.id === id);
    if (p) {
      p.displayName = displayName;
      this._emit();
    }
  }
}

// Stringify an SDK rejection for a log payload without ever throwing.
function errMsg(err) {
  if (err instanceof Error) return err.message || String(err);
  if (err && typeof err === 'object') {
    try {
      return JSON.stringify(err);
    } catch {
      return String(err);
    }
  }
  return String(err);
}

// Real implementation — only instantiated inside the Zoom client. Kept minimal
// and dependency-lazy so the prototype build doesn't require @zoom/appssdk.
// Exported so the direct postMessage/onMessage overlay bridge can be unit-tested
// against a fake SDK (the real SDK only exists inside the Zoom client).
export class RealZoom {
  // `log` is the /api/log sink (injectable for tests). It instruments the
  // camera-overlay SDK calls so a live run leaves server-side ground truth; it
  // NEVER changes a method's outcome (no new throws; failures swallowed as before).
  constructor(sdk, { log = postLog } = {}) {
    this.isMock = false;
    this._sdk = sdk;
    this._log = log;
    this._participants = [];
    this._subs = new Set();
    this._msgSubs = new Set();
    // Whether the last getMeetingParticipants() succeeded. getMeetingParticipants
    // needs host/co-host + scope; when it fails the list is empty, which would
    // otherwise read as a valid $0 meeting. Track it so the UI can say so.
    this._participantsAvailable = true;
    // Camera-overlay draw inputs, captured at init() so the camera instance can
    // composite without re-deriving them: the surface size reported by config()
    // and the presenter's own participantUUID (base video layer).
    this._renderTarget = null;
    this._selfUUID = null;
  }

  async init() {
    const sdk = this._sdk;
    // config() reports the camera surface size in config.media.renderTarget; keep
    // it so the camera instance sizes drawParticipant/drawWebView to the surface
    // instead of a hardcoded resolution.
    const cfg = await sdk.config({ capabilities: ZOOM_CAPABILITIES });
    this._renderTarget = cfg?.media?.renderTarget ?? null;
    // getRunningContext() resolves to RunningContextResponse = { context }, NOT
    // { runningContext } (that name belongs to config()'s ConfigResponse). Read the
    // correct property and normalize to a canonical { runningContext } so Root can
    // route the real inCamera instance to overlay mode. (raw.runningContext kept as a
    // fallback in case a client/version ever returns the config-style name.)
    const rawCtx = await sdk.getRunningContext();
    const context = { runningContext: rawCtx?.context ?? rawCtx?.runningContext };
    let self = null;
    try {
      self = await sdk.getUserContext();
    } catch {
      /* may be unavailable depending on context */
    }
    await this._refresh();
    // Resolve the presenter's own participantUUID for the base video layer:
    // prefer getUserContext()'s own UUID, else match self against the (already
    // refreshed) participant list by name.
    this._selfUUID = this._resolveSelfUUID(self);

    if (typeof sdk.onParticipantChange === 'function') {
      sdk.onParticipantChange(() => {
        this._refresh().then(() => this._emit());
      });
    }

    // The inCamera overlay instance receives state pushed from the side panel via
    // postMessage. No connect() handshake: in camera (Layers) mode the panel posts
    // directly and the camera receives via onMessage (per Zoom's official sample);
    // connect()/onConnect is the meeting<->main-client mirroring feature, which the
    // inCamera instance can't even call ("API can only be called when running in a
    // meeting"), so it is intentionally not used here.
    if (typeof sdk.onMessage === 'function') {
      sdk.onMessage((evt) => {
        const payload = evt?.payload ?? evt;
        for (const cb of this._msgSubs) cb(payload);
      });
    }

    // rawContext is the unnormalized getRunningContext() result, surfaced purely so
    // Root's diagnostic boot log can record what the SDK actually returned.
    return { context, self, participants: this.getParticipants(), rawContext: rawCtx };
  }

  // Run an instrumented SDK call: emit a /api/log entry recording success or
  // failure, then preserve the original outcome (re-throw on failure). Logging
  // must never break the call it observes, so the sink itself is swallowed.
  async _instrument(method, fn) {
    try {
      const result = await fn();
      this._emitLog({ kind: 'zoom-overlay', method, ok: true });
      return result;
    } catch (err) {
      this._emitLog({ kind: 'zoom-overlay', method, ok: false, error: errMsg(err) });
      throw err;
    }
  }

  _emitLog(payload) {
    try {
      Promise.resolve(this._log(payload)).catch(() => {});
    } catch {
      /* logging must never break the thing it observes */
    }
  }

  // --- Camera overlay (Layers API) -----------------------------------------
  // Panel instance: ONLY spawn the camera rendering context. The compositing
  // (drawParticipant + drawWebView) must happen in the spawned camera instance,
  // because drawWebView composites the webview of whichever instance calls it —
  // calling drawWebView here would draw the panel's full UI onto the camera.
  async startCameraOverlay() {
    await this._instrument('runRenderingContext', () =>
      this._sdk.runRenderingContext({ view: 'camera' })
    );
  }

  // Camera instance (OverlayApp on mount): composite the presenter's own video
  // as the base layer (zIndex 1) and this transparent overlay webview on top
  // (zIndex 2). Both are sized to the camera surface reported by config().
  async drawCameraOverlay() {
    const rt = this._renderTarget || DEFAULT_RENDER_TARGET;
    const rect = { x: 0, y: 0, width: rt.width, height: rt.height };
    if (this._selfUUID) {
      // The participant base layer is best-effort: drawParticipant is Host/Co-Host
      // only, while drawWebView (the meter) works for any role. A base-layer failure
      // must NOT suppress the meter, so swallow it here — _instrument has already
      // logged ok:false — and still draw the webview below.
      try {
        await this._instrument('drawParticipant', () =>
          this._sdk.drawParticipant({ participantUUID: this._selfUUID, ...rect, zIndex: 1 })
        );
      } catch {
        /* base video layer optional; meter still composites via drawWebView */
      }
    } else {
      // No UUID -> skip the base layer (the meter still composites). Record it so
      // a live run shows why the video base is missing.
      this._emitLog({
        kind: 'zoom-overlay',
        method: 'drawParticipant',
        ok: false,
        error: 'no self participantUUID',
      });
    }
    // webviewId is an arbitrary string label that identifies this webview layer.
    await this._instrument('drawWebView', () =>
      this._sdk.drawWebView({ webviewId: 'camera', ...rect, zIndex: 2 })
    );
  }

  // Camera instance: best-effort clear of the overlay webview layer on unmount.
  // The panel's stopCameraOverlay (closeRenderingContext) is the real teardown —
  // it removes ALL camera layers (including the participant base) and is what
  // triggers this unmount — so we do NOT separately clearParticipant (that would
  // need a third capability for a redundant call). Must never throw.
  async clearCameraOverlay() {
    try {
      await this._sdk.clearWebView?.({ webviewId: 'camera' });
    } catch {
      /* belt-and-suspenders; closeRenderingContext handles real teardown */
    }
  }

  async stopCameraOverlay() {
    await this._sdk.closeRenderingContext();
  }

  // Resolve the presenter's own participantUUID for drawParticipant. Prefer the
  // UUID from getUserContext(); fall back to matching self's name against the
  // refreshed participant list (whose id is already the participantUUID).
  _resolveSelfUUID(self) {
    if (self?.participantUUID) return String(self.participantUUID);
    const name = self?.screenName ?? self?.displayName;
    if (name) {
      const match = this._participants.find((p) => p.displayName === name);
      if (match) return match.id;
    }
    return null;
  }

  // --- State bridge: side panel -> camera overlay (direct postMessage) ------
  // No connection handshake: the panel posts the latest snapshot directly each
  // tick and the inCamera instance receives it via onMessage (Zoom camera-mode
  // sample pattern). Every send's outcome is logged (we're still debugging the
  // live overlay) and rejections are swallowed so a failed push never surfaces as
  // an unhandled rejection — the next tick posts a fresh snapshot anyway.
  postMessage(payload) {
    // Defer the SDK call by one microtask (Promise.resolve().then) so a SYNCHRONOUS
    // throw from sdk.postMessage becomes a rejected promise too — caught and logged
    // ok:false alongside async rejections, and never escaping to the caller. The
    // caller posts from a React effect, where a synchronous throw would trip the
    // ErrorBoundary and blank the panel; the overlay push must never do that.
    Promise.resolve()
      .then(() => this._sdk.postMessage(payload))
      .then(() => this._emitLog({ kind: 'zoom-overlay', method: 'postMessage', ok: true }))
      .catch((err) =>
        this._emitLog({ kind: 'zoom-overlay', method: 'postMessage', ok: false, error: errMsg(err) })
      );
  }

  onMessage(cb) {
    this._msgSubs.add(cb);
    return () => this._msgSubs.delete(cb);
  }

  async _refresh() {
    try {
      const res = await this._sdk.getMeetingParticipants();
      const list = res?.participants ?? [];
      this._participants = list.map((p) => ({
        id: String(p.participantUUID ?? p.screenName ?? p.participantId),
        displayName: p.screenName ?? p.displayName ?? 'Participant',
        email: p.email,
      }));
      this._participantsAvailable = true;
    } catch {
      // getMeetingParticipants requires host/co-host + scope. Mark the list
      // unavailable so the UI can distinguish "can't read participants" from a
      // genuine empty/$0 meeting, rather than degrading silently to $0.
      this._participantsAvailable = false;
    }
  }

  getParticipants() {
    return this._participants.map((p) => ({ ...p }));
  }

  participantsAvailable() {
    return this._participantsAvailable;
  }

  onParticipantsChange(cb) {
    this._subs.add(cb);
    return () => this._subs.delete(cb);
  }

  _emit() {
    const snapshot = this.getParticipants();
    for (const cb of this._subs) cb(snapshot);
  }
}

let _result = null;

/**
 * Resolve which adapter to use. Returns a RESULT object (not a bare adapter):
 *
 *   { adapter: RealZoom, mode: 'real' }            -- real SDK in use
 *   { adapter: MockZoom, mode: 'mock' }            -- local prototype
 *   { adapter: null, blocked: true, reason }       -- refuse to run; show error
 *                                                     reason: 'mock-build' | 'import-fail'
 *
 * Inside the Zoom client we NEVER silently use the mock: a mock build, or a
 * failed SDK import, becomes a blocking result so Root can show "Real Zoom SDK
 * not loaded" instead of presenter controls that do nothing attendee-facing.
 * To run real, set VITE_USE_ZOOM=1 and ensure @zoom/appssdk is installed.
 */
export async function getZoomAdapter() {
  if (_result) return _result;

  const wantReal = import.meta.env?.VITE_USE_ZOOM === '1';
  const inZoom = isZoomLikeEnvironment();

  let importOk = false;
  let mod = null;
  if (wantReal) {
    try {
      // The package is optional and only present for real in-Zoom builds, so we
      // hide it from Vite's static dependency scan.
      mod = await import('@zoom/appssdk');
      importOk = true;
    } catch (err) {
      console.warn('[meeting-cost] Zoom SDK import failed:', err?.message);
    }
  }

  const plan = decideAdapter({ wantReal, inZoom, importOk });
  if (plan.action === 'real') {
    _result = { adapter: new RealZoom(mod.default ?? mod), mode: 'real' };
  } else if (plan.action === 'mock') {
    _result = { adapter: new MockZoom(), mode: 'mock' };
  } else {
    _result = { adapter: null, blocked: true, reason: plan.reason };
  }
  return _result;
}
