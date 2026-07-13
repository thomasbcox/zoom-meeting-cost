import { describe, it, expect } from 'vitest';
import CostOverlay from './CostOverlay.jsx';

// Hook-free component: call it directly and inspect the returned element tree,
// mirroring the ErrorBoundary test's approach (node env, no jsdom).

describe('CostOverlay', () => {
  it('renders nothing without display state', () => {
    expect(CostOverlay({ display: null })).toBe(null);
  });

  it('shows the total and is the transparent overlay container (no app chrome)', () => {
    const el = CostOverlay({
      display: {
        status: 'running',
        totalCost: 71.04,
        costPerSecond: 150 / 3600,
        elapsedSeconds: 982,
        attendees: 1,
      },
    });
    const serialized = JSON.stringify(el);
    expect(el.props.className).toBe('cost-overlay');
    expect(serialized).toContain('$71.04');
    expect(serialized).toContain('1 person');
    // none of the side-panel chrome leaks into the overlay
    expect(serialized).not.toContain('panel');
    expect(serialized).not.toContain('rolebar');
    expect(serialized).not.toContain('controls');
  });

  it('pluralizes the attendee count', () => {
    const el = CostOverlay({
      display: { status: 'running', totalCost: 0, costPerSecond: 0, elapsedSeconds: 0, attendees: 3 },
    });
    expect(JSON.stringify(el)).toContain('3 people');
  });

  describe('cadence-aware clock', () => {
    const base = { status: 'running', totalCost: 10, costPerSecond: 1, attendees: 2 };

    it('shows h:mm:ss for the per-second / 10s cadences', () => {
      const sec = JSON.stringify(CostOverlay({ display: { ...base, elapsedSeconds: 70, displayIntervalSeconds: 1 } }));
      expect(sec).toContain('00:01:10');
      const ten = JSON.stringify(CostOverlay({ display: { ...base, elapsedSeconds: 70, displayIntervalSeconds: 10 } }));
      expect(ten).toContain('00:01:10');
    });

    it('defaults to per-second formatting when no cadence is given', () => {
      const def = JSON.stringify(CostOverlay({ display: { ...base, elapsedSeconds: 70 } }));
      expect(def).toContain('00:01:10');
    });
  });
});
