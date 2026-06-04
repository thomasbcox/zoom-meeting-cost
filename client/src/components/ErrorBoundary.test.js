import { describe, it, expect, vi } from 'vitest';

// Mock the reporter so componentDidCatch doesn't hit the network.
vi.mock('../lib/reportError.js', () => ({ reportClientError: vi.fn() }));

import ErrorBoundary from './ErrorBoundary.jsx';
import { reportClientError } from '../lib/reportError.js';

describe('ErrorBoundary', () => {
  it('getDerivedStateFromError flags the error with its message', () => {
    expect(ErrorBoundary.getDerivedStateFromError(new Error('nope'))).toEqual({
      hasError: true,
      message: 'nope',
    });
  });

  it('componentDidCatch reports to the error sink', () => {
    const eb = new ErrorBoundary({});
    eb.componentDidCatch(new Error('crash'), { componentStack: 'stack' });
    expect(reportClientError).toHaveBeenCalledTimes(1);
    const arg = reportClientError.mock.calls[0][0];
    expect(arg.source).toBe('react-error-boundary');
    expect(arg.message).toBe('crash');
  });

  it('renders children normally, fallback when hasError', () => {
    const eb = new ErrorBoundary({ children: 'KIDS' });
    expect(eb.render()).toBe('KIDS');

    eb.state = { hasError: true, message: 'boom' };
    const el = eb.render();
    expect(el.props.role).toBe('alert');
    const serialized = JSON.stringify(el);
    expect(serialized).toContain('Something went wrong');
    expect(serialized).toContain('boom');
  });
});
