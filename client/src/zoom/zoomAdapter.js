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
  // Side panel <-> camera context state bridge. These are "App Instances
  // Communication" APIs: postMessage fails with error 10041 ("app instances
  // aren't connected") until the instances call connect(), so connect/onConnect
  // must be requested alongside postMessage/onMessage.
  'connect',
  'onConnect',
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
// Exported so the connect/postMessage bridge can be unit-tested against a fake
// SDK (the real SDK only exists inside the Zoom client).
export class RealZoom {
  // `log` is the /api/log sink (injectable for tests). It instruments the
  // camera-overlay SDK calls so a live run leaves server-side ground truth; it
  // NEVER changes a method's outcome (no new throws; failures swallowed as before).
  constructor(sdk, { log = postLog } = {}) {
    this.isMock = false;
    this._sdk = sdk;
    this._log = log;
    this._firstPostLogged = false;
    this._participants = [];
    this._subs = new Set();
    this._msgSubs = new Set();
    // App-instance connection state for the postMessage bridge. postMessage
    // fails with 10041 until the panel and camera instances are connected, so
    // we hold the latest payload and replay it once onConnect fires.
    this._connected = false;
    this._pendingMsg = null;
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
    const context = await sdk.getRunningContext();
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

    // Camera context receives state pushed from the side panel via postMessage.
    if (typeof sdk.onMessage === 'function') {
      sdk.onMessage((evt) => {
        const payload = evt?.payload ?? evt;
        for (const cb of this._msgSubs) cb(payload);
      });
    }

    // Establish the app-instance connection that the postMessage bridge needs.
    // onConnect fires when the peer instance (panel <-> camera) connection
    // settles — but the event reports either outcome (action: 'success' |
    // 'failure'), so only a success means the channel is live. A failure must
    // NOT mark us connected or flush the held payload (that would post over a
    // dead bridge and lose the snapshot); we keep waiting for a later success.
    if (typeof sdk.onConnect === 'function') {
      sdk.onConnect((evt) => {
        if (evt?.action !== 'success') return;
        this._connected = true;
        if (this._pendingMsg != null) {
          const payload = this._pendingMsg;
          this._pendingMsg = null;
          this._send(payload);
        }
      });
    }
    if (typeof sdk.connect === 'function') {
      // The peer instance may not be up yet (error 10039); that's non-fatal —
      // onConnect will fire when it is, and the held payload is replayed then.
      // Instrumented (success/failure) but still swallowed: the failure path is
      // expected and recovered by onConnect, so it must not surface as an error.
      Promise.resolve(sdk.connect())
        .then(() => this._emitLog({ kind: 'zoom-overlay', method: 'connect', ok: true }))
        .catch((err) =>
          this._emitLog({ kind: 'zoom-overlay', method: 'connect', ok: false, error: errMsg(err) })
        );
    }

    return { context, self, participants: this.getParticipants() };
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
      await this._instrument('drawParticipant', () =>
        this._sdk.drawParticipant({ participantUUID: this._selfUUID, ...rect, zIndex: 1 })
      );
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

  // Camera instance: best-effort clear of the layers this instance drew, on
  // unmount. The panel's stopCameraOverlay (closeRenderingContext) is the real
  // teardown; these must never throw (clearParticipant may not be enabled).
  async clearCameraOverlay() {
    try {
      await this._sdk.clearWebView?.({ webviewId: 'camera' });
    } catch {
      /* belt-and-suspenders; closeRenderingContext handles real teardown */
    }
    try {
      await this._sdk.clearParticipant?.();
    } catch {
      /* clearParticipant capability may be absent; non-fatal */
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

  // --- State bridge: side panel -> camera context --------------------------
  postMessage(payload) {
    // Until the instances are connected, postMessage would reject with 10041.
    // Hold only the latest payload (overlay state is a full snapshot, so an
    // older one is worthless) and replay it from the onConnect handler.
    if (!this._connected) {
      this._pendingMsg = payload;
      return;
    }
    this._send(payload);
  }

  _send(payload) {
    // Swallow rejections so a failed push can't surface as an unhandled
    // rejection; the next tick pushes a fresh snapshot anyway. Log only the
    // FIRST send's outcome — that's the one that proves the bridge is live;
    // logging every tick would flood /api/log.
    const logFirst = !this._firstPostLogged;
    if (logFirst) this._firstPostLogged = true;
    Promise.resolve(this._sdk.postMessage(payload))
      .then(() => {
        if (logFirst) this._emitLog({ kind: 'zoom-overlay', method: 'postMessage', ok: true });
      })
      .catch((err) => {
        if (logFirst)
          this._emitLog({ kind: 'zoom-overlay', method: 'postMessage', ok: false, error: errMsg(err) });
      });
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
