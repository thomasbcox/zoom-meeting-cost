import React from 'react';
import { reportClientError } from '../lib/reportError.js';

// Catches render-time errors anywhere below it, reports them to /api/log, and
// shows a minimal visible message instead of a blank white screen (which is all
// the Zoom client would otherwise show on an uncaught render error).

export default class ErrorBoundary extends React.Component {
  constructor(props) {
    super(props);
    this.state = { hasError: false, message: '' };
  }

  static getDerivedStateFromError(error) {
    return { hasError: true, message: error?.message ?? String(error) };
  }

  componentDidCatch(error, info) {
    reportClientError({
      source: 'react-error-boundary',
      message: error?.message ?? String(error),
      stack: error?.stack,
      componentStack: info?.componentStack,
    });
  }

  render() {
    if (this.state.hasError) {
      return (
        <div className="app-error" role="alert">
          <h2>Something went wrong.</h2>
          <p>
            The app hit an unexpected error and couldn&apos;t render. The details
            were sent to the server log.
          </p>
          {this.state.message && <pre className="app-error-detail">{this.state.message}</pre>}
        </div>
      );
    }
    return this.props.children;
  }
}
