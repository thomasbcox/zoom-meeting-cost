import { useEffect, useRef, useState } from 'react';
import { displayDraft } from '../lib/numberInputDraft.js';
import { sessionControls } from '../lib/sessionControls.js';
import { DISPLAY_INTERVALS, DISPLAY_INTERVAL_LABELS } from '../lib/displayCadence.js';
import CostOverlay from './CostOverlay.jsx';

// Presenter-only panel. Everything here is private to the presenter; only the aggregate
// overlay state (total, $/min, stepped clock, head-count) is composited on the camera feed.

export default function PresenterControls({
  config,
  actions,
  session,
  sessionActions,
  overlayOn,
  startOverlay,
  stopOverlay,
  previewDisplay,
}) {
  // Which session controls to show for the current status. `ended` now offers a
  // way out (start new / resume) instead of being a dead-end. Overlay Show/Hide is
  // independent of session status and always available.
  const c = sessionControls(session.status);
  const ended = session.status === 'ended';

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

      {/* --- Dead-simple cost inputs: one rate × a manual attendee count -- */}
      <section className="panel">
        <h3>Meeting cost estimate</h3>
        <p className="muted small">
          Your best guess of the average hourly opportunity cost per attendee × the number of
          attendees.
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
              value={config.simpleUserCount}
              placeholder="# of attendees"
              onCommit={(v) => actions.setSimpleUserCount(v)}
            />
          </label>
        </div>
      </section>
    </div>
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
  // field, a stray blur (or `value` moving while focused) would pin a fixed number.
  const focusedValueRef = useRef(null);

  // Keep the draft in sync with the external value while NOT focused, so a clamped commit
  // shows its clamped result after blur. While focused, the user owns the draft.
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
