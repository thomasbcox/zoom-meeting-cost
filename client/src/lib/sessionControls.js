// Which session controls the presenter sees for a given session status.
//
// Pure so the status→controls contract is unit-testable without jsdom. Fixes the
// dead-end where `ended` exposed NO controls (Pause/Resume/End all gated on
// running/paused/active), leaving no way to start or continue a session after
// "End session". The transition semantics are unchanged and live in App's
// sessionActions — `start` resets elapsed+total, `resume` continues the frozen
// total; this only decides which buttons are offered, and when.
//
//   start    — begin the first session from idle (no prior total)
//   startNew — from ended: reset elapsed+total to $0 and count fresh (→ start)
//   resume   — continue the frozen total (from paused, or from ended) (→ resume)
//   pause    — pause a running session
//   end      — end a running/paused session
export function sessionControls(status) {
  return {
    start: status === 'idle',
    startNew: status === 'ended',
    resume: status === 'paused' || status === 'ended',
    pause: status === 'running',
    end: status === 'running' || status === 'paused',
  };
}
