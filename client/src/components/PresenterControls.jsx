import { useState } from 'react';
import { formatMoney } from '../lib/cost.js';
import { SourceBadge } from './SharedCostScreen.jsx';

// Presenter-only panel. Everything here is private to the presenter; only the
// resolved/sanitized shared state is broadcast to viewers.

export default function PresenterControls({
  config,
  overrides,
  actions,
  session,
  sessionActions,
  prefs,
  setPrefs,
  resolved,
}) {
  const running = session.status === 'running';
  const paused = session.status === 'paused';
  const active = running || paused;

  return (
    <div className="controls">
      {/* --- Session ------------------------------------------------------ */}
      <section className="panel">
        <h3>Shared session</h3>
        <div className="btn-row">
          {!active && (
            <button className="btn primary" onClick={sessionActions.start}>
              Start shared session
            </button>
          )}
          {running && (
            <button className="btn" onClick={sessionActions.pause}>
              Pause counting
            </button>
          )}
          {paused && (
            <button className="btn" onClick={sessionActions.resume}>
              Resume counting
            </button>
          )}
          {active && (
            <button className="btn danger" onClick={sessionActions.end}>
              End session
            </button>
          )}
        </div>
        <p className="muted small">
          Status: <strong>{session.status}</strong>
        </p>
      </section>

      {/* --- Display preferences ------------------------------------------ */}
      <section className="panel">
        <h3>Viewer display</h3>
        <label className="check">
          <input
            type="checkbox"
            checked={!!prefs.aggregateOnly}
            onChange={(e) => setPrefs({ ...prefs, aggregateOnly: e.target.checked })}
          />
          Show aggregate totals only (hide the participant list)
        </label>
        <label className="check">
          <input
            type="checkbox"
            checked={!!prefs.hideRates}
            disabled={prefs.aggregateOnly}
            onChange={(e) => setPrefs({ ...prefs, hideRates: e.target.checked })}
          />
          Show names but hide individual rates
        </label>
      </section>

      {/* --- Global rate settings ----------------------------------------- */}
      <section className="panel">
        <h3>Rate settings</h3>
        <div className="field-row">
          <label>
            Default hourly rate
            <NumberInput
              value={config.defaultRate}
              onCommit={(v) => actions.setDefaultRate(v)}
              prefix="$"
            />
          </label>
          <label>
            Loaded-cost multiplier
            <NumberInput
              value={config.multiplier}
              step="0.05"
              onCommit={(v) => actions.setMultiplier(v)}
              suffix="×"
            />
          </label>
        </div>
        <p className="muted small">
          Multiplier applies to every rate (e.g. 1.25 for benefits/overhead).
        </p>
      </section>

      {/* --- Private rate table ------------------------------------------- */}
      <RateTableEditor config={config} actions={actions} />

      {/* --- Aliases ------------------------------------------------------ */}
      <AliasEditor config={config} actions={actions} />

      {/* --- Current-meeting overrides ------------------------------------ */}
      <OverridesEditor resolved={resolved} overrides={overrides} actions={actions} />
    </div>
  );
}

function RateTableEditor({ config, actions }) {
  const [name, setName] = useState('');
  const [rate, setRate] = useState('');

  const add = () => {
    actions.addRule(name, rate);
    setName('');
    setRate('');
  };

  return (
    <section className="panel">
      <h3>Private rate rules</h3>
      <p className="muted small">Best-guess hourly rates. Never shared with viewers.</p>
      <table className="edit-table">
        <tbody>
          {config.rateTable.map((r) => (
            <tr key={r.id}>
              <td>
                <input
                  className="inline"
                  value={r.name}
                  onChange={(e) => actions.updateRule(r.id, { name: e.target.value })}
                />
              </td>
              <td className="num">
                <NumberInput
                  value={r.rate}
                  prefix="$"
                  onCommit={(v) => actions.updateRule(r.id, { rate: v })}
                />
              </td>
              <td>
                <button className="btn tiny danger" onClick={() => actions.deleteRule(r.id)}>
                  ✕
                </button>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      <div className="add-row">
        <input
          placeholder="Name (e.g. Jane Smith)"
          value={name}
          onChange={(e) => setName(e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && add()}
        />
        <input
          placeholder="$/hr"
          type="number"
          value={rate}
          onChange={(e) => setRate(e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && add()}
        />
        <button className="btn" onClick={add}>
          Add
        </button>
      </div>
    </section>
  );
}

function AliasEditor({ config, actions }) {
  const [alias, setAlias] = useState('');
  const [canonical, setCanonical] = useState('');

  const add = () => {
    actions.addAlias(alias, canonical);
    setAlias('');
    setCanonical('');
  };

  return (
    <section className="panel">
      <h3>Name aliases</h3>
      <p className="muted small">Map a meeting display name to a rate-rule name.</p>
      <table className="edit-table">
        <tbody>
          {config.aliases.map((a) => (
            <tr key={a.id}>
              <td>{a.alias}</td>
              <td className="muted">→ {a.canonical}</td>
              <td>
                <button className="btn tiny danger" onClick={() => actions.deleteAlias(a.id)}>
                  ✕
                </button>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      <div className="add-row">
        <input
          placeholder='Alias (e.g. "Tom Cox")'
          value={alias}
          onChange={(e) => setAlias(e.target.value)}
        />
        <input
          placeholder="Canonical name"
          value={canonical}
          onChange={(e) => setCanonical(e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && add()}
        />
        <button className="btn" onClick={add}>
          Add
        </button>
      </div>
    </section>
  );
}

function OverridesEditor({ resolved, overrides, actions }) {
  return (
    <section className="panel">
      <h3>Per-participant overrides</h3>
      <p className="muted small">
        Override the rate for someone in this meeting. Not saved to the rate table.
      </p>
      <table className="edit-table">
        <tbody>
          {resolved.map((p) => (
            <tr key={p.id}>
              <td>{p.displayName}</td>
              <td>
                <SourceBadge source={p.source} />
              </td>
              <td className="num">{formatMoney(p.rate, { decimals: 0 })}</td>
              <td className="num">
                <input
                  className="inline num"
                  type="number"
                  placeholder="override"
                  value={overrides[p.id] ?? ''}
                  onChange={(e) => actions.setOverride(p.id, e.target.value)}
                />
              </td>
            </tr>
          ))}
          {resolved.length === 0 && (
            <tr>
              <td className="muted">No participants in the meeting.</td>
            </tr>
          )}
        </tbody>
      </table>
    </section>
  );
}

// Number input that commits on blur / Enter so typing isn't fought by clamping.
function NumberInput({ value, onCommit, step = '1', prefix, suffix }) {
  // Local draft so typing isn't fought by clamping; re-synced from `value` on
  // focus and committed on blur/Enter.
  const [draft, setDraft] = useState(String(value ?? ''));

  return (
    <span className="num-input">
      {prefix && <span className="affix">{prefix}</span>}
      <input
        type="number"
        step={step}
        value={draft}
        onChange={(e) => setDraft(e.target.value)}
        onFocus={() => setDraft(String(value ?? ''))}
        onBlur={() => onCommit(draft)}
        onKeyDown={(e) => {
          if (e.key === 'Enter') {
            onCommit(draft);
            e.currentTarget.blur();
          }
        }}
      />
      {suffix && <span className="affix">{suffix}</span>}
    </span>
  );
}
