import { formatMoney } from '../lib/cost.js';
import { formatCadenceDuration } from '../lib/displayCadence.js';

// Pure, hook-free presentational overlay — the "taxi meter" composited onto the
// presenter's camera feed. No app chrome (no panels, header, or role bar) and a
// transparent background so only the card shows over the video. Kept hook-free
// so it renders identically in the camera context and the mock preview, and so
// it can be unit-tested by calling it directly.

export default function CostOverlay({ display }) {
  if (!display) return null;

  const { totalCost, costPerSecond, elapsedSeconds, attendees, status } = display;
  // totalCost / elapsedSeconds arrive already quantized to the display cadence by
  // the caller (overlay or preview); the cadence only picks the clock format here.
  const interval = Number(display.displayIntervalSeconds) || 1;
  const perMinute = (Number(costPerSecond) || 0) * 60;
  const live = status === 'running';
  const paused = status === 'paused';
  const count = Number(attendees) || 0;

  return (
    <div className="cost-overlay">
      <div className="cost-overlay-card">
        <div className="cost-overlay-label">
          <span className={`cost-overlay-dot ${live ? 'live' : paused ? 'paused' : 'idle'}`} />
          Meeting cost
        </div>
        <div className="cost-overlay-total" aria-label="Live meeting cost">
          {formatMoney(totalCost)}
        </div>
        <div className="cost-overlay-meta">
          <span>{`${formatMoney(perMinute)}/min`}</span>
          <span>{formatCadenceDuration(elapsedSeconds, interval)}</span>
          <span>{`${count} ${count === 1 ? 'person' : 'people'}`}</span>
        </div>
      </div>
    </div>
  );
}
