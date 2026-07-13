import { useCallback, useState } from 'react';

import { DEFAULT_DISPLAY_INTERVAL, normalizeDisplayInterval } from '../lib/displayCadence.js';

// The presenter's SESSION-ONLY configuration for the dead-simple meter: a manual
// attendee count + one hourly opportunity-cost rate + the display cadence. Nothing is
// persisted (no server store, no localStorage) — it resets to the defaults each session.
//
// `rate` is an hourly OPPORTUNITY COST (value of best alternative work), not pay —
// see dev-docs/opportunity-cost-rate.md.
export const DEFAULT_CONFIG = {
  simpleAverageRate: 100, // $/hr opportunity cost per attendee
  simpleUserCount: 2, // manual attendee count
  displayIntervalSeconds: DEFAULT_DISPLAY_INTERVAL,
};

export function usePresenterStore() {
  const [config, setConfig] = useState(() => ({ ...DEFAULT_CONFIG }));

  const setSimpleAverageRate = useCallback((rate) => {
    setConfig((c) => ({ ...c, simpleAverageRate: clampNum(rate, 0) }));
  }, []);

  const setSimpleUserCount = useCallback((count) => {
    setConfig((c) => ({ ...c, simpleUserCount: clampNum(count, 0) }));
  }, []);

  const setDisplayInterval = useCallback((seconds) => {
    setConfig((c) => ({ ...c, displayIntervalSeconds: normalizeDisplayInterval(seconds) }));
  }, []);

  return {
    config,
    actions: { setSimpleAverageRate, setSimpleUserCount, setDisplayInterval },
  };
}

export function clampNum(v, min) {
  const n = Number(v);
  if (!Number.isFinite(n)) return min;
  return Math.max(min, n);
}
