// Zoom integration adapter.
//
// The rest of the app talks ONLY to this interface:
//
//   adapter.init()                  -> { context, self, participants }
//   adapter.getParticipants()       -> Participant[]
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
  // Side panel <-> camera context state bridge. These are "App Instances
  // Communication" APIs: postMessage fails with error 10041 ("app instances
  // aren't connected") until the instances call connect(), so connect/onConnect
  // must be requested alongside postMessage/onMessage.
  'connect',
  'onConnect',
  'postMessage',
  'onMessage',
];

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

  onParticipantsChange(cb) {
    this._subs.add(cb);
    return () => this._subs.delete(cb);
  }

  _emit() {
    const snapshot = this.getParticipants();
    for (const cb of this._subs) cb(snapshot);
  }

  // --- Camera overlay (mock: record calls; no real compositing) -----------
  async startCameraOverlay() {
    this.calls.push({ method: 'runRenderingContext', view: 'camera' });
    this.calls.push({ method: 'drawWebView' });
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

// Real implementation — only instantiated inside the Zoom client. Kept minimal
// and dependency-lazy so the prototype build doesn't require @zoom/appssdk.
// Exported so the connect/postMessage bridge can be unit-tested against a fake
// SDK (the real SDK only exists inside the Zoom client).
export class RealZoom {
  constructor(sdk) {
    this.isMock = false;
    this._sdk = sdk;
    this._participants = [];
    this._subs = new Set();
    this._msgSubs = new Set();
    // App-instance connection state for the postMessage bridge. postMessage
    // fails with 10041 until the panel and camera instances are connected, so
    // we hold the latest payload and replay it once onConnect fires.
    this._connected = false;
    this._pendingMsg = null;
  }

  async init() {
    const sdk = this._sdk;
    await sdk.config({ capabilities: ZOOM_CAPABILITIES });
    const context = await sdk.getRunningContext();
    let self = null;
    try {
      self = await sdk.getUserContext();
    } catch {
      /* may be unavailable depending on context */
    }
    await this._refresh();

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
    // onConnect fires once the peer instance (panel <-> camera) is reachable;
    // at that point we flush any payload that was held while disconnected.
    if (typeof sdk.onConnect === 'function') {
      sdk.onConnect(() => {
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
      Promise.resolve(sdk.connect()).catch(() => {});
    }

    return { context, self, participants: this.getParticipants() };
  }

  // --- Camera overlay (Layers API): render this webview onto the camera ----
  async startCameraOverlay() {
    await this._sdk.runRenderingContext({ view: 'camera' });
    // Cover the full frame; the overlay positions its content in a corner via
    // CSS over a transparent background.
    await this._sdk.drawWebView({ x: 0, y: 0, width: 1280, height: 720, zIndex: 1 });
  }

  async stopCameraOverlay() {
    await this._sdk.closeRenderingContext();
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
    // rejection; the next tick pushes a fresh snapshot anyway.
    Promise.resolve(this._sdk.postMessage(payload)).catch(() => {});
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
    } catch {
      // getMeetingParticipants requires host/co-host + scope; degrade quietly.
    }
  }

  getParticipants() {
    return this._participants.map((p) => ({ ...p }));
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

let _adapter = null;

/**
 * Returns the singleton adapter. Uses MockZoom unless we detect we're running
 * inside the Zoom client AND the SDK loads. To force real mode during Zoom
 * testing, set VITE_USE_ZOOM=1 and ensure @zoom/appssdk is installed.
 */
export async function getZoomAdapter() {
  if (_adapter) return _adapter;

  const wantReal = import.meta.env?.VITE_USE_ZOOM === '1';
  if (wantReal) {
    try {
      // The package is optional and only present for real in-Zoom builds, so we
      // hide it from Vite's static dependency scan.
      const mod = await import('@zoom/appssdk');
      _adapter = new RealZoom(mod.default ?? mod);
      return _adapter;
    } catch (err) {
      console.warn('[meeting-cost] Zoom SDK unavailable, using mock:', err?.message);
    }
  }

  _adapter = new MockZoom();
  return _adapter;
}
