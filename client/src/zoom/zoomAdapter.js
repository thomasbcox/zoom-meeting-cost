// Zoom integration adapter.
//
// The rest of the app talks ONLY to this interface:
//
//   adapter.init()                  -> { context, self, participants }
//   adapter.getParticipants()       -> Participant[]
//   adapter.onParticipantsChange(cb)-> unsubscribe()
//   adapter.isMock                  -> boolean
//
// where Participant = { id, displayName, email? }
//
// Two implementations:
//   - MockZoom  : used in the local prototype. Lets the UI add/remove fake
//                 participants to simulate join/leave, mirroring real Zoom
//                 events (which arrive from the SDK, not from the UI).
//   - RealZoom  : wraps @zoom/appssdk. Wired but only used when running inside
//                 the Zoom client. Left as a clearly-marked integration point.

const SEED_PARTICIPANTS = [
  { id: 'p1', displayName: 'Thomas Cox' },
  { id: 'p2', displayName: 'Jane Smith' },
  { id: 'p3', displayName: 'Acme CFO' },
  { id: 'p4', displayName: 'Dana Rivera' }, // intentionally unmatched -> default
];

class MockZoom {
  constructor() {
    this.isMock = true;
    this._participants = [...SEED_PARTICIPANTS];
    this._subs = new Set();
    this._nextId = 5;
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
class RealZoom {
  constructor(sdk) {
    this.isMock = false;
    this._sdk = sdk;
    this._participants = [];
    this._subs = new Set();
  }

  async init() {
    const sdk = this._sdk;
    await sdk.config({
      capabilities: [
        'getRunningContext',
        'getMeetingContext',
        'getMeetingParticipants',
        'getUserContext',
        'onParticipantChange',
      ],
    });
    const context = await sdk.getRunningContext();
    let self = null;
    try {
      self = await sdk.getUserContext();
    } catch {
      /* may be unavailable depending on context */
    }
    await this._refresh();

    sdk.onParticipantChange(() => {
      this._refresh().then(() => this._emit());
    });

    return { context, self, participants: this.getParticipants() };
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
