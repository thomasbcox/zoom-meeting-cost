import React from 'react';
import { createRoot } from 'react-dom/client';
import Root from './Root.jsx';
import './styles.css';
import { installGlobalErrorReporting } from './lib/reportError.js';
import ErrorBoundary from './components/ErrorBoundary.jsx';

// Make in-Zoom failures visible: ship uncaught errors / rejections to /api/log
// (there is no easy console inside the Zoom client).
installGlobalErrorReporting();

createRoot(document.getElementById('root')).render(
  <React.StrictMode>
    <ErrorBoundary>
      <Root />
    </ErrorBoundary>
  </React.StrictMode>
);
