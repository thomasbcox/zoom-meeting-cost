import { useEffect, useRef, useState } from 'react';
import { formatMoney, simpleCountCommit, simpleCountDisplay } from '../lib/cost.js';
import { displayDraft } from '../lib/numberInputDraft.js';
import { saveToListTarget } from '../lib/saveToList.js';
import { MAX_RATES } from '../lib/rateTable.js';
import { normalizeName } from '../lib/normalize.js';
import { formatMeetingSummary } from '../lib/meetingSummary.js';
import { sessionControls } from '../lib/sessionControls.js';
import { DISPLAY_INTERVALS, DISPLAY_INTERVAL_LABELS } from '../lib/displayCadence.js';
import { SourceBadge } from './SharedCostScreen.jsx';
import CostOverlay from './CostOverlay.jsx';

// Presenter-only panel. Everything here is private to the presenter; only the
// resolved/sanitized shared state is broadcast to viewers.

export default function PresenterControls({
  config,
  overrides,
  actions,
  session,
  sessionActions,
  overlayOn,
  startOverlay,
  stopOverlay,
  resolved,
  previewDisplay,
  canPerParticipant = true,
  participantsAvailable = true,
  liveCountForSimple = resolved.length,
}) {
  // Which session controls to show for the current status. `ended` now offers a
  // way out (start new / resume) instead of being a dead-end. Overlay Show/Hide is
  // independent of session status and always available.
  const c = sessionControls(session.status);
  const ended = session.status === 'ended';
  // Non-hosts can't read the participant list, so they get ONLY the Simple model:
  // no cost-model toggle, no per-participant editors. Hosts/co-hosts see the full UI.
  const showSimple = !canPerParticipant || config.costModel === 'simple';

  return (
    <div className="controls">
      {/* --- Session + camera overlay ------------------------------------- */}
      <section className="panel">
        <h3>Cost overlay</h3>
        <div className="btn-row">
          {!overlayOn ? (
            <button className="btn primary" onClick={startOverlay}>
              Show cost on video
            </button>
          ) : (
            <button className="btn danger" onClick={stopOverlay}>
              Hide from video
            </button>
          )}
          {c.start && (
            <button className="btn primary" onClick={sessionActions.start}>
              Start session
            </button>
          )}
          {c.startNew && (
            <button className="btn primary" onClick={sessionActions.start}>
              Start new session
            </button>
          )}
          {c.pause && (
            <button className="btn" onClick={sessionActions.pause}>
              Pause counting
            </button>
          )}
          {c.resume && (
            <button className="btn" onClick={sessionActions.resume}>
              {ended ? 'Resume' : 'Resume counting'}
            </button>
          )}
          {c.end && (
            <button className="btn" onClick={sessionActions.end}>
              End session
            </button>
          )}
        </div>
        <p className="muted small">
          Overlay <strong>{overlayOn ? 'on your video' : 'hidden'}</strong> · counting{' '}
          <strong>{session.status}</strong> · renders on your camera feed, so everyone sees it —
          keep this panel open while counting.
        </p>

        {/* --- Display cadence + viewer preview ------------------------- */}
        <div className="cadence">
          <span className="muted small">Update display every</span>
          <div className="btn-row">
            {DISPLAY_INTERVALS.map((sec) => (
              <button
                key={sec}
                className={`btn tiny ${config.displayIntervalSeconds === sec ? 'primary' : ''}`}
                onClick={() => actions.setDisplayInterval(sec)}
                aria-pressed={config.displayIntervalSeconds === sec}
              >
                {DISPLAY_INTERVAL_LABELS[sec]}
              </button>
            ))}
          </div>
        </div>

        <div className="overlay-preview">
          <span className="muted small">What viewers see — aggregate only, never names</span>
          <div className="overlay-preview-stage">
            <CostOverlay display={previewDisplay} />
          </div>
        </div>
      </section>

      {/* --- Cost model toggle: host/co-host only (non-hosts are Simple-locked) --- */}
      {canPerParticipant && (
        <section className="panel">
          <h3>Cost model</h3>
          <div className="btn-row">
            <button
              className={`btn ${config.costModel !== 'simple' ? 'primary' : ''}`}
              onClick={() => actions.setCostModel('perParticipant')}
            >
              Per-participant
            </button>
            <button
              className={`btn ${config.costModel === 'simple' ? 'primary' : ''}`}
              onClick={() => actions.setCostModel('simple')}
            >
              Simple (N × rate)
            </button>
          </div>
          <p className="muted small">
            {config.costModel === 'simple'
              ? 'Flat estimate: attendees × average opportunity cost.'
              : 'Per-person opportunity cost from your private table.'}
          </p>
        </section>
      )}

      {showSimple ? (
        /* --- Simple cost model (replaces the per-participant editors) ----- */
        <SimpleCostPanel
          config={config}
          actions={actions}
          liveCount={liveCountForSimple}
          participantsAvailable={participantsAvailable}
        />
      ) : (
        <>
          {/* --- Global rate settings ------------------------------------- */}
          <section className="panel">
            <h3>Opportunity-cost settings</h3>
            <div className="field-row">
              <label>
                Default hourly opportunity cost
                <NumberInput
                  value={config.defaultRate}
                  onCommit={(v) => actions.setDefaultRate(v)}
                  prefix="$"
                />
              </label>
            </div>
          </section>

          {/* --- Private rate table ------------------------------------- */}
          <RateTableEditor config={config} actions={actions} />

          {/* --- Aliases ------------------------------------------------ */}
          <AliasEditor config={config} actions={actions} />

          {/* --- Current-meeting overrides ------------------------------ */}
          <OverridesEditor
            resolved={resolved}
            overrides={overrides}
            actions={actions}
            config={config}
          />
        </>
      )}

      {/* --- Past meetings (persists across sessions) --------------------- */}
      <PastMeetings history={config.meetingHistory} />
    </div>
  );
}

function SimpleCostPanel({ config, actions, liveCount, participantsAvailable = true }) {
  const countValue = simpleCountDisplay({
    simpleUserCount: config.simpleUserCount,
    liveCount,
    participantsAvailable,
  });
  return (
    <section className="panel">
      <h3>Meeting cost estimate</h3>
      <p className="muted small">
        Your best guess of the average hourly opportunity cost per participant × the number of
        participants.
      </p>
      <div className="field-row">
        <label>
          Average hourly opportunity cost
          <NumberInput
            value={config.simpleAverageRate}
            onCommit={(v) => actions.setSimpleAverageRate(v)}
            prefix="$"
          />
        </label>
        <label>
          Number of attendees
          <NumberInput
            value={countValue}
            placeholder="# of attendees"
            onCommit={(v) => actions.setSimpleUserCount(simpleCountCommit(v, liveCount))}
          />
        </label>
      </div>
      <p className="muted small">
        {participantsAvailable
          ? `Prefilled from the live count (${liveCount}); edit to override, clear to track it.`
          : 'Enter the number of attendees — the live count isn’t available to you in this meeting.'}
      </p>
    </section>
  );
}

function RateTableEditor({ config, actions }) {
  const [name, setName] = useState('');
  const [rate, setRate] = useState('');

  // At the cap, only an UPSERT (re-entering a name already in the list, which just
  // updates its rate) is allowed — a genuinely new name is blocked. `isUpsert` uses the
  // same normalization as matching, so "tom cox" resolves to an existing "Tom Cox".
  const atCap = config.rateTable.length >= MAX_RATES;
  const isUpsert = config.rateTable.some((r) => normalizeName(r.name) === normalizeName(name));
  const addDisabled = atCap && !isUpsert;

  const add = () => {
    if (addDisabled) return;
    actions.addRule(name, rate);
    setName('');
    setRate('');
  };

  return (
    <section className="panel">
      <h3>Private per-person values</h3>
      <p className="muted small">
        Your best-guess hourly opportunity cost per person — never shown to participants.
      </p>
      <p className="muted small" role="note">
        ⚠️ Stored server-side (encrypted, but <strong>operator-decryptable</strong> — not
        end-to-end) and included in export/delete. Don&rsquo;t enter anything you wouldn&rsquo;t
        want stored.
      </p>
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
          min="0"
          value={rate}
          onChange={(e) => setRate(e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && add()}
        />
        <button className="btn" onClick={add} disabled={addDisabled}>
          Add
        </button>
      </div>
      {atCap && (
        <p className="muted small" role="note">
          You can save up to {MAX_RATES} people ({config.rateTable.length}/{MAX_RATES}). Remove one
          to add another — or re-enter an existing name to update their value.
        </p>
      )}
    </section>
  );
}

function AliasEditor({ config, actions }) {
  const [alias, setAlias] = useState('');
  const [canonical, setCanonical] = useState('');

  const atCap = config.aliases.length >= MAX_RATES;
  const isUpsert = config.aliases.some((a) => normalizeName(a.alias) === normalizeName(alias));
  const addDisabled = atCap && !isUpsert;

  const add = () => {
    if (addDisabled) return;
    actions.addAlias(alias, canonical);
    setAlias('');
    setCanonical('');
  };

  return (
    <section className="panel">
      <h3>Name aliases</h3>
      <p className="muted small">Map a meeting display name to a name in your private list.</p>
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
        <button className="btn" onClick={add} disabled={addDisabled}>
          Add
        </button>
      </div>
      {atCap && (
        <p className="muted small" role="note">
          You can save up to {MAX_RATES} aliases ({config.aliases.length}/{MAX_RATES}). Remove one to
          add another — or re-enter an existing alias to update it.
        </p>
      )}
    </section>
  );
}

function OverridesEditor({ resolved, overrides, actions, config }) {
  // "＋ Save" always adds a NEW person to the saved list (saveToListTarget is null once
  // they're already saved), so it's subject to the same cap.
  const atCap = config.rateTable.length >= MAX_RATES;
  return (
    <section className="panel">
      <h3>Per-participant overrides</h3>
      <p className="muted small">
        Override the value for someone in this meeting, or save them to your private list.
      </p>
      <table className="edit-table">
        <tbody>
          {resolved.map((p) => {
            // Whether this attendee can be promoted into the saved rate table (null = already
            // saved, by name or alias — regardless of a current override). See lib/saveToList.
            const target = saveToListTarget(p, config);
            return (
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
                    min="0"
                    placeholder="override"
                    value={overrides[p.id] ?? ''}
                    onChange={(e) => actions.setOverride(p.id, e.target.value)}
                  />
                </td>
                <td>
                  {target ? (
                    <button
                      className="btn tiny"
                      disabled={atCap}
                      title={
                        atCap
                          ? `Your saved list is full (${MAX_RATES} max) — remove someone first`
                          : 'Add this attendee to your saved private list at the current value'
                      }
                      onClick={() => {
                        actions.addRule(target.name, target.rate);
                        actions.clearOverride(p.id);
                      }}
                    >
                      ＋ Save
                    </button>
                  ) : (
                    <span className="muted small">in list</span>
                  )}
                </td>
              </tr>
            );
          })}
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

// Past meetings: persisted end-of-meeting summaries (newest-first). Each row is the exact
// one-line text — visible + selectable — with a Copy button (clipboard is best-effort; the
// Zoom webview may block it, so the line itself is the fallback). Aggregate only.
function PastMeetings({ history = [] }) {
  const rows = Array.isArray(history) ? history : [];

  const copy = (s) => {
    try {
      navigator.clipboard?.writeText(formatMeetingSummary(s));
    } catch {
      /* clipboard blocked in the webview — the line is shown for manual selection */
    }
  };

  return (
    <section className="panel">
      <h3>Past meetings</h3>
      <p className="muted small">
        Saved end-of-meeting summaries — aggregate only (no names or per-person values). Copy one
        to paste into chat.
      </p>
      {rows.length === 0 ? (
        <p className="muted small">No past meetings yet — end a session to record one.</p>
      ) : (
        <ul className="past-meetings">
          {rows.map((s) => (
            <li key={s.id ?? s.endedAt}>
              <span className="past-summary">{formatMeetingSummary(s)}</span>
              <button className="btn tiny" onClick={() => copy(s)}>
                Copy
              </button>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

// Number input that commits on blur / Enter so typing isn't fought by clamping.
function NumberInput({ value, onCommit, step = '1', prefix, suffix, placeholder }) {
  // Local draft so typing isn't fought by clamping; re-synced from `value` on
  // focus and committed on blur/Enter.
  const [draft, setDraft] = useState(String(value ?? ''));
  // Explicit focus state drives the draft-resync decision below. Kept SEPARATE from
  // focusedValueRef (which stays purely the original-focus-value guard): making focus
  // real state means a blur (isFocused true→false) re-runs the effect and resyncs the
  // draft from `value` even when `value` itself didn't change — e.g. a committed -1 that
  // clamps back to the same 0. (Codex design review 2026-07-02.)
  const [isFocused, setIsFocused] = useState(false);
  // The value shown at focus time. Commit ONLY when the draft actually changed,
  // so an untouched focus/blur never writes — otherwise, for the attendee-count
  // field, a stray blur (or `value` moving while focused, e.g. the live count)
  // would pin "track the live count" to a fixed number. (Codex review 2026-06-08.)
  const focusedValueRef = useRef(null);

  // Keep the draft in sync with the external value while NOT focused, so an async-loaded
  // (server-hydrated) value replaces the stale mounted default, and a clamped commit shows
  // its clamped result after blur. While focused, the user owns the draft (never clobbered).
  useEffect(() => {
    if (isFocused) return;
    setDraft((cur) => displayDraft({ value, isFocused: false, currentDraft: cur }));
  }, [value, isFocused]);

  const commitIfChanged = () => {
    if (focusedValueRef.current == null) return; // not focused / already committed
    const original = focusedValueRef.current;
    focusedValueRef.current = null;
    if (draft !== original) onCommit(draft);
  };

  return (
    <span className="num-input">
      {prefix && <span className="affix">{prefix}</span>}
      <input
        type="number"
        step={step}
        min="0"
        placeholder={placeholder}
        value={draft}
        onChange={(e) => setDraft(e.target.value)}
        onFocus={() => {
          const s = String(value ?? '');
          setDraft(s);
          focusedValueRef.current = s;
          setIsFocused(true);
        }}
        onBlur={() => {
          commitIfChanged();
          setIsFocused(false);
        }}
        onKeyDown={(e) => {
          if (e.key === 'Enter') {
            commitIfChanged();
            e.currentTarget.blur();
          }
        }}
      />
      {suffix && <span className="affix">{suffix}</span>}
    </span>
  );
}
