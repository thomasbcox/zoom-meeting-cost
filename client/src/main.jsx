import React from 'react';
import { createRoot } from 'react-dom/client';
import App from './App.jsx';
import './styles.css';
import { maybeRunZoomDiagnostics } from './zoom/zoomDiagnostics.js';

// Recon spike: when running inside Zoom (VITE_USE_ZOOM=1) with ?diag=1, probe
// the SDK and ship raw output to /api/log. No-op in ordinary mock dev.
maybeRunZoomDiagnostics();

createRoot(document.getElementById('root')).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>
);
