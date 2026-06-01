import { formatMoney, formatDuration } from '../lib/cost.js';

// Renders the shared meeting-cost view from a shared-state object. This is the
// SAME component presenters and viewers see — the difference is purely the data
// each one is given (presenters build a full local state; viewers receive the
// sanitized broadcast).

export default function SharedCostScreen({ state }) {
  if (!state) {
    return (
      <div className="cost-screen empty">
        <p className="muted">Waiting for the presenter to start a shared session…</p>
      </div>
    );
  }

  const { status, elapsedSeconds, totalCost, totals, participants, prefs, presenterName } = state;
  const paused = status === 'paused';
  const ended = status === 'ended';

  return (
    <div className="cost-screen">
      <div className="cost-headline">
        <div className="total-cost" aria-label="Total meeting cost">
          {formatMoney(totalCost)}
        </div>
        <div className="status-row">
          {ended && <span className="badge badge-ended">Session ended</span>}
          {paused && <span className="badge badge-paused">Paused</span>}
          {!paused && !ended && <span className="badge badge-live">● Live</span>}
          {presenterName && <span className="muted">Presenter: {presenterName}</span>}
        </div>
      </div>

      <div className="metrics">
        <Metric label="Cost / minute" value={formatMoney(totals.costPerMinute)} />
        <Metric label="Elapsed" value={formatDuration(elapsedSeconds)} />
        <Metric label="Attendees" value={String(totals.attendeeCount)} />
        <Metric label="Combined / hour" value={formatMoney(totals.combinedHourly)} />
      </div>

      {prefs?.aggregateOnly ? (
        <p className="muted detail-note">
          Participant details are hidden by the presenter — showing totals only.
        </p>
      ) : (
        <ParticipantRows participants={participants} hideRates={prefs?.hideRates} />
      )}

      <p className="estimate-note">
        Estimated cost based on presenter-defined rates. These are best-guess
        estimates, not payroll figures.
      </p>
    </div>
  );
}

function Metric({ label, value }) {
  return (
    <div className="metric">
      <div className="metric-value">{value}</div>
      <div className="metric-label">{label}</div>
    </div>
  );
}

function ParticipantRows({ participants = [], hideRates }) {
  if (participants.length === 0) {
    return <p className="muted detail-note">No participants yet.</p>;
  }
  return (
    <table className="participant-table">
      <thead>
        <tr>
          <th>Participant</th>
          {!hideRates && <th className="num">Est. rate / hr</th>}
          {!hideRates && <th>Source</th>}
        </tr>
      </thead>
      <tbody>
        {participants.map((p) => (
          <tr key={p.id}>
            <td>{p.displayName}</td>
            {!hideRates && <td className="num">{formatMoney(p.rate, { decimals: 0 })}</td>}
            {!hideRates && (
              <td>
                <SourceBadge source={p.source} />
              </td>
            )}
          </tr>
        ))}
      </tbody>
    </table>
  );
}

export function SourceBadge({ source }) {
  const map = {
    matched: { label: 'matched', cls: 'src-matched' },
    default: { label: 'default', cls: 'src-default' },
    manual: { label: 'manual override', cls: 'src-manual' },
  };
  const s = map[source] || { label: source || '—', cls: 'src-default' };
  return <span className={`src-badge ${s.cls}`}>{s.label}</span>;
}
