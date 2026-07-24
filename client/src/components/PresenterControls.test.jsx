import { describe, it, expect } from 'vitest';
import PresenterControls from './PresenterControls.jsx';

// PresenterControls has no top-level hooks (its NumberInput children are elements, not invoked
// when we call the component directly), so we call it and inspect the returned element tree —
// same node-env pattern as CostOverlay.test.js. Here we only exercise the camera-off warning.

const baseProps = {
  config: { simpleAverageRate: 100, simpleUserCount: 5, displayIntervalSeconds: 10 },
  actions: {},
  session: { status: 'idle' },
  sessionActions: {},
  overlayOn: false,
  startOverlay: () => {},
  stopOverlay: () => {},
  previewDisplay: null,
};

describe('PresenterControls camera-off warning', () => {
  it('renders a role=alert warning with the given notice when set (AC2)', () => {
    const notice = 'Turn your camera on, then click "Show cost on video."';
    const s = JSON.stringify(PresenterControls({ ...baseProps, overlayNotice: notice }));
    expect(s).toContain('overlay-warning'); // the prominent warning class
    expect(s).toContain('"role":"alert"'); // announced to assistive tech
    expect(s).toContain('Turn your camera on'); // step 1
    expect(s).toContain('Show cost on video'); // step 2
  });

  it('renders no warning when the notice is cleared (AC6)', () => {
    const s = JSON.stringify(PresenterControls({ ...baseProps, overlayNotice: null }));
    expect(s).not.toContain('overlay-warning');
  });
});
