// Drives the camera-instance compositing from the OverlayApp mount lifecycle.
//
// Only the REAL camera instance composites layers onto the video: the panel
// must not (it would draw its own full UI), and the mock preview just renders
// the meter visually. `shouldDraw` is that "I am the real camera instance"
// signal (OverlayApp passes its transparentBody flag, which is true only for
// the camera-context mount in Root).
//
// Returns a cleanup that clears the layers this instance drew. Extracted as a
// plain function so the mount/unmount contract is unit-testable without jsdom.
export function runCameraDraw(adapter, shouldDraw) {
  if (!shouldDraw) return () => {};
  adapter?.drawCameraOverlay?.();
  return () => {
    adapter?.clearCameraOverlay?.();
  };
}
