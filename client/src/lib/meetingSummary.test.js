import { describe, it, expect } from 'vitest';
import {
  buildMeetingSummary,
  isRecordable,
  appendSummary,
  formatMeetingSummary,
  formatDuration,
  MEETING_HISTORY_MAX,
} from './meetingSummary.js';

describe('buildMeetingSummary', () => {
  it('derives durationSeconds (rounded) and costPerMinute (costPerSecond*60)', () => {
    const s = buildMeetingSummary({
      endedAt: 1_700_000_000_000,
      totalCost: 12.5,
      elapsedSeconds: 90.6,
      headcount: 3,
      costPerSecond: 0.25,
      costModel: 'perParticipant',
    });
    expect(s).toEqual({
      endedAt: 1_700_000_000_000,
      totalCost: 12.5,
      durationSeconds: 91,
      headcount: 3,
      costPerMinute: 15,
      costModel: 'perParticipant',
    });
  });

  it('coerces junk to safe numbers and normalizes costModel', () => {
    const s = buildMeetingSummary({ endedAt: 1, totalCost: undefined, elapsedSeconds: NaN, headcount: null, costPerSecond: 'x', costModel: 'simple' });
    expect(s).toEqual({ endedAt: 1, totalCost: 0, durationSeconds: 0, headcount: 0, costPerMinute: 0, costModel: 'simple' });
  });
});

describe('isRecordable', () => {
  it('is true only when the session accrued time', () => {
    expect(isRecordable({ durationSeconds: 1 })).toBe(true);
    expect(isRecordable({ durationSeconds: 0 })).toBe(false);
    expect(isRecordable(null)).toBe(false);
  });
});

describe('appendSummary', () => {
  it('prepends newest-first and caps at the max', () => {
    let hist = [];
    for (let i = 1; i <= MEETING_HISTORY_MAX + 1; i++) hist = appendSummary(hist, { id: i });
    expect(hist).toHaveLength(MEETING_HISTORY_MAX);
    expect(hist[0].id).toBe(MEETING_HISTORY_MAX + 1); // newest first
    expect(hist.at(-1).id).toBe(2); // the very first (id 1) fell off
  });

  it('tolerates a non-array history', () => {
    expect(appendSummary(undefined, { id: 'a' })).toEqual([{ id: 'a' }]);
  });
});

describe('formatMeetingSummary', () => {
  it('produces a one-line aggregate string (no names/rates)', () => {
    const line = formatMeetingSummary({
      endedAt: 1_700_000_000_000,
      totalCost: 1240.5,
      durationSeconds: 2535,
      headcount: 2,
      costPerMinute: 18,
      costModel: 'perParticipant',
    });
    expect(line).toContain('Meeting Cost');
    expect(line).toContain('$1,240.50');
    expect(line).toContain('42:15'); // 2535s
    expect(line).toContain('2 attendees');
    expect(line).toContain('$18.00/min');
    expect(line).toContain('per-participant');
  });

  it('singularizes one attendee', () => {
    expect(formatMeetingSummary({ endedAt: 1, totalCost: 0, durationSeconds: 5, headcount: 1, costPerMinute: 0, costModel: 'simple' })).toContain('1 attendee,');
  });
});

describe('formatDuration', () => {
  it('formats m:ss and h:mm:ss', () => {
    expect(formatDuration(5)).toBe('0:05');
    expect(formatDuration(2535)).toBe('42:15');
    expect(formatDuration(3661)).toBe('1:01:01');
  });
});
