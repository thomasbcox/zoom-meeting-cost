import { useEffect, useRef, useState } from 'react';
import SharedCostScreen from './SharedCostScreen.jsx';

// Viewer wrapper around SharedCostScreen. The presenter publishes roughly once
// per second; to keep the numbers feeling live in between, we locally
// extrapolate the total and elapsed time from the last received snapshot using
// its costPerSecond and updatedAt timestamp.

export default function ViewerScreen({ state }) {
  const [, force] = useState(0);
  const stateRef = useRef(state);
  stateRef.current = state;

  useEffect(() => {
    const id = setInterval(() => force((n) => n + 1), 250);
    return () => clearInterval(id);
  }, []);

  if (!state) return <SharedCostScreen state={null} />;

  let display = state;
  if (state.status === 'running' && state.updatedAt) {
    const elapsedSince = Math.max(0, (Date.now() - state.updatedAt) / 1000);
    const cps = state.totals?.costPerSecond || 0;
    display = {
      ...state,
      elapsedSeconds: state.elapsedSeconds + elapsedSince,
      totalCost: state.totalCost + cps * elapsedSince,
    };
  }

  return <SharedCostScreen state={display} />;
}
