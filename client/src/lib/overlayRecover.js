// Auto-recovery decision for the camera overlay, distilled to a pure function.
//
// Turning the presenter's camera OFF tears down Zoom's camera rendering context,
// which destroys our inCamera overlay webview. Turning it back ON rebuilds the
// camera feed but does NOT re-run our rendering context, so the meter stays gone
// until re-armed. The panel learns of both via onMyMediaChange (real shape:
// `{ media: { video: { state } } }` on a camera toggle; resolution changes carry
// `{ video: { width, height } }` with no `state`; audio carries `{ audio: { state } }`).
//
// Recovery is a tiny state machine over those events: while the overlay is meant to
// be on, a camera-OFF arms a pending re-arm, and the next camera-ON consumes it and
// re-establishes the overlay. Gating on a confirmed OFF→ON transition means a stray
// `state:true` can't double-spawn a rendering context. Kept pure + table-testable
// (no jsdom), mirroring runCameraDraw.
//
// @param {object} evt      an onMyMediaChange event
// @param {object} prev     { overlayOn:boolean, needsRearm:boolean } current recovery state
// @returns {object}        { needsRearm:boolean, rearm:boolean }
//                          needsRearm = next pending-rearm state to store;
//                          rearm = true when the caller should re-run startCameraOverlay() now.
export function reduceOverlayRecovery(evt, { overlayOn, needsRearm }) {
  const video = evt?.media?.video;
  // Ignore audio events and resolution-only video events (no boolean state) — they
  // neither tear down nor restore the rendering context.
  if (!video || typeof video.state !== 'boolean') {
    return { needsRearm, rearm: false };
  }
  if (video.state === false) {
    // Camera off: the rendering context is torn down. Arm a re-arm only if the
    // overlay was supposed to be showing (else there is nothing to restore).
    return { needsRearm: overlayOn, rearm: false };
  }
  // Camera on: consume any pending re-arm. Restore the overlay only if it is still
  // meant to be on AND a teardown was armed; either way drop the pending flag so a
  // stale one (e.g. armed, then the overlay hidden) can't fire later without a fresh
  // off→on while the overlay is on.
  return { needsRearm: false, rearm: overlayOn && needsRearm };
}

// Build the onMediaChange handler that drives overlay auto-recovery, decoupled from
// React so it is unit-testable without jsdom (mirrors the runCameraDraw extraction).
// It reads/writes the pending-rearm flag through getters/setter (refs in App), runs
// the reducer, and on a confirmed re-arm re-runs startCameraOverlay() then posts a
// fresh snapshot. Returns a promise so callers can await it in tests; a failed
// re-arm is swallowed (the next toggle retries) and never surfaces to the caller.
//
// @param {object} deps
// @param {() => boolean} deps.getOverlayOn      is the overlay currently meant to be on
// @param {() => boolean} deps.getNeedsRearm     current pending-rearm flag
// @param {(v:boolean) => void} deps.setNeedsRearm  store the next pending-rearm flag
// @param {() => any} deps.startCameraOverlay    re-establish the camera rendering context
// @param {() => void} deps.postOverlay          push a fresh snapshot after re-arm
// @param {(event:string) => void} [deps.log]    lifecycle logger (begin/done)
// @returns {(evt:object) => Promise<void>}
export function createMediaRecoveryHandler({
  getOverlayOn,
  getNeedsRearm,
  setNeedsRearm,
  startCameraOverlay,
  postOverlay,
  log = () => {},
}) {
  return (evt) => {
    const { needsRearm, rearm } = reduceOverlayRecovery(evt, {
      overlayOn: getOverlayOn(),
      needsRearm: getNeedsRearm(),
    });
    setNeedsRearm(needsRearm);
    if (!rearm) return Promise.resolve();
    log('overlay-rearm:begin');
    return Promise.resolve(startCameraOverlay?.())
      .then(() => {
        postOverlay();
        log('overlay-rearm:done');
      })
      .catch(() => {
        /* a failed re-arm must not surface; the next toggle can retry */
      });
  };
}
