// Blocking error shown INSTEAD of the presenter controls when we're inside the
// Zoom client but can't run real (a mock build, or the SDK import failed). This
// is deliberately a dead end: the alternative — silently using MockZoom — looks
// successful to the presenter while rendering nothing onto the attendee video.

const REASONS = {
  'mock-build': {
    title: 'Real Zoom SDK not loaded',
    detail:
      'This build is running inside Zoom but was not built for real Zoom mode ' +
      '(VITE_USE_ZOOM is not set). The camera overlay would be simulated only and ' +
      'attendees would see nothing. Deploy the real-mode build to continue.',
  },
  'import-fail': {
    title: 'Real Zoom SDK not loaded',
    detail:
      'This build requested real Zoom mode but the Zoom Apps SDK (@zoom/appssdk) ' +
      'failed to load. The camera overlay cannot render to attendees. Check that the ' +
      'SDK is installed and reachable, then reload.',
  },
};

export default function SdkBlockedError({ reason }) {
  const { title, detail } = REASONS[reason] ?? REASONS['import-fail'];
  return (
    <div className="app">
      <div className="sdk-blocked" role="alert">
        <h1>{title}</h1>
        <p>{detail}</p>
        <p className="muted small">Mock prototype mode is disabled inside Zoom on purpose.</p>
      </div>
    </div>
  );
}
