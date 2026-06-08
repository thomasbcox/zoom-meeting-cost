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
  // Camera on: restore only after a confirmed teardown while the overlay was on.
  if (overlayOn && needsRearm) {
    return { needsRearm: false, rearm: true };
  }
  return { needsRearm, rearm: false };
}
