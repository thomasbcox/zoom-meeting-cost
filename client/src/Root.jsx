import { useEffect, useState } from 'react';

import App from './App.jsx';
import OverlayApp from './components/OverlayApp.jsx';
import SdkBlockedError from './components/SdkBlockedError.jsx';
import { getZoomAdapter } from './zoom/zoomAdapter.js';
import { renderModeFor } from './lib/renderMode.js';
import { logLifecycle } from './lib/lifecycleLog.js';
import { buildInfo } from './lib/buildInfo.js';

// Top-level router. Resolves the Zoom adapter once, reads the running context,
// and mounts the right tree:
//   - 'overlay' (camera context) -> OverlayApp  (taxi meter only)
//   - 'panel'   (side panel)     -> App         (presenter config + controls)
// Initializing here keeps the heavy presenter hooks out of the camera webview.

export default function Root() {
  const [boot, setBoot] = useState(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const result = await getZoomAdapter();
      // Inside Zoom without a working real SDK: refuse to render the (mock)
      // presenter controls — show a blocking error instead.
      if (result.blocked) {
        if (cancelled) return;
        setBoot({ blocked: true, reason: result.reason });
        return;
      }
      const adapter = result.adapter;
      try {
        const { context, self, participants, rawContext } = await adapter.init();
        if (cancelled) return;
        const runningContext = context?.runningContext;
        // Diagnostic boot trace: which instance booted, in which running context, and
        // how it routed. Lets us tell the inMeeting panel from the inCamera render and
        // see whether a separate camera instance is even spawned.
        logLifecycle('boot', {
          mode: result.mode,
          runningContext,
          rawContext,
          routedMode: renderModeFor(runningContext),
          // Which build produced this bundle — env + FULL commit SHA (not shortened),
          // so the log line matches Railway deploy metadata directly.
          env: buildInfo.env,
          commit: buildInfo.commit,
        });
        setBoot({
          adapter,
          mode: result.mode,
          runningContext,
          self,
          participants: participants || [],
        });
      } catch (err) {
        // SDK init can fail outside Zoom or without scopes. Degrade to the panel
        // rather than blanking the app (a context we can't render is not 'camera').
        if (cancelled) return;
        // eslint-disable-next-line no-console
        console.warn('[meeting-cost] adapter init failed, falling back to panel:', err?.message);
        logLifecycle('init-error', { mode: result.mode, error: err?.message ?? String(err) });
        setBoot({ adapter, mode: result.mode, runningContext: undefined, self: undefined, participants: [] });
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  if (!boot) return null;

  if (boot.blocked) return <SdkBlockedError reason={boot.reason} />;

  const mode = renderModeFor(boot.runningContext);
  if (mode === 'overlay') return <OverlayApp adapter={boot.adapter} />;
  return <App adapter={boot.adapter} self={boot.self} initialParticipants={boot.participants} />;
}
