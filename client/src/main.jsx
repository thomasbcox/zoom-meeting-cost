import React from 'react';
import { createRoot } from 'react-dom/client';
import Root from './Root.jsx';
import './styles.css';
import { maybeRunZoomDiagnostics } from './zoom/zoomDiagnostics.js';
import { installGlobalErrorReporting } from './lib/reportError.js';
import ErrorBoundary from './components/ErrorBoundary.jsx';

// Make in-Zoom failures visible: ship uncaught errors / rejections to /api/log
// (there is no easy console inside the Zoom client).
installGlobalErrorReporting();

// Recon spike: when running inside Zoom (VITE_USE_ZOOM=1) with ?diag=1, probe
// the SDK and ship raw output to /api/log. No-op in ordinary mock dev.
maybeRunZoomDiagnostics();

createRoot(document.getElementById('root')).render(
  <React.StrictMode>
    <ErrorBoundary>
      <Root />
    </ErrorBoundary>
  </React.StrictMode>
);
