import { useEffect, useState } from 'react';

import App from './App.jsx';
import OverlayApp from './components/OverlayApp.jsx';
import { getZoomAdapter } from './zoom/zoomAdapter.js';
import { renderModeFor } from './lib/renderMode.js';

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
      let adapter = null;
      try {
        adapter = await getZoomAdapter();
        const { context, participants } = await adapter.init();
        if (cancelled) return;
        setBoot({
          adapter,
          runningContext: context?.runningContext,
          participants: participants || [],
        });
      } catch (err) {
        // SDK init can fail outside Zoom or without scopes. Degrade to the panel
        // rather than blanking the app (a context we can't render is not 'camera').
        if (cancelled) return;
        // eslint-disable-next-line no-console
        console.warn('[meeting-cost] adapter init failed, falling back to panel:', err?.message);
        setBoot({ adapter, runningContext: undefined, participants: [] });
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  if (!boot) return null;

  const mode = renderModeFor(boot.runningContext);
  if (mode === 'overlay') return <OverlayApp adapter={boot.adapter} />;
  return <App adapter={boot.adapter} initialParticipants={boot.participants} />;
}
