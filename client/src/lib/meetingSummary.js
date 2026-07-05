// Pure helpers for the end-of-meeting summary (see reviews/meeting-summary-history.md).
// A summary is AGGREGATE ONLY — no names or per-person rates.
//
//   summary = { id, endedAt, totalCost, durationSeconds, headcount, costPerMinute, costModel }
//
// ("rate"/"cost" here = opportunity cost — see dev-docs/opportunity-cost-rate.md.)

export const MEETING_HISTORY_MAX = 20;

// Assemble a summary record from the live session state at End. `endedAt` (epoch ms) is passed
// in so this stays pure/testable (App supplies Date.now()). No `id` yet — the store assigns it.
export function buildMeetingSummary({
  endedAt,
  totalCost,
  elapsedSeconds,
  headcount,
  costPerSecond,
  costModel,
}) {
  return {
    endedAt,
    totalCost: Number(totalCost) || 0,
    durationSeconds: Math.round(Number(elapsedSeconds) || 0),
    headcount: Number(headcount) || 0,
    costPerMinute: (Number(costPerSecond) || 0) * 60,
    costModel: costModel === 'simple' ? 'simple' : 'perParticipant',
  };
}

// Only record sessions that actually ran — a bare End with no elapsed time saves nothing.
export function isRecordable(summary) {
  return (summary?.durationSeconds || 0) > 0;
}

// Prepend the newest summary and cap the list. Newest-first.
export function appendSummary(history = [], summary, max = MEETING_HISTORY_MAX) {
  return [summary, ...(Array.isArray(history) ? history : [])].slice(0, max);
}

// One-line, copy-into-chat text. Aggregate only. `now`-free: derives the date from endedAt.
export function formatMeetingSummary(s) {
  const when = new Date(s.endedAt).toLocaleString();
  const model = s.costModel === 'simple' ? 'simple' : 'per-participant';
  return (
    `Meeting Cost · ${when} — $${round2(s.totalCost)} over ${formatDuration(s.durationSeconds)}, ` +
    `${s.headcount} ${s.headcount === 1 ? 'attendee' : 'attendees'}, ` +
    `~$${round2(s.costPerMinute)}/min (${model})`
  );
}

// h:mm:ss or m:ss.
export function formatDuration(totalSeconds) {
  const s = Math.max(0, Math.round(Number(totalSeconds) || 0));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = s % 60;
  const pad = (n) => String(n).padStart(2, '0');
  return h > 0 ? `${h}:${pad(m)}:${pad(sec)}` : `${m}:${pad(sec)}`;
}

function round2(n) {
  return (Math.round((Number(n) || 0) * 100) / 100).toLocaleString(undefined, {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
}
