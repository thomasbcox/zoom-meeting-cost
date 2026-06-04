// Maps a Zoom running context to which UI the app should render.
//
//   'inCamera' -> 'overlay'  : the transparent taxi-meter composited onto the
//                              presenter's camera feed (seen by all participants)
//   anything else -> 'panel' : the in-meeting side panel (presenter config +
//                              overlay start/stop control)
//
// Zoom returns the running context from getRunningContext(); 'inCamera' is the
// camera rendering context entered via runRenderingContext({ view: 'camera' }).

export function renderModeFor(runningContext) {
  return runningContext === 'inCamera' ? 'overlay' : 'panel';
}
