import { describe, it, expect } from 'vitest';
import { normalizeIncomingMessage } from './overlayMessage.js';

describe('normalizeIncomingMessage', () => {
  const snap = { status: 'running', totalCost: 1.5, attendees: 2 };

  it('returns evt.payload when present (object payload)', () => {
    expect(normalizeIncomingMessage({ timestamp: 1, payload: snap })).toEqual(snap);
  });

  it('JSON-parses a string payload under evt.payload', () => {
    expect(normalizeIncomingMessage({ payload: JSON.stringify(snap) })).toEqual(snap);
  });

  it('JSON-parses a bare string event', () => {
    expect(normalizeIncomingMessage(JSON.stringify(snap))).toEqual(snap);
  });

  it('passes a plain object (no payload key) straight through', () => {
    expect(normalizeIncomingMessage(snap)).toEqual(snap);
  });

  it('returns an invalid JSON string unchanged (never throws)', () => {
    expect(normalizeIncomingMessage('not json')).toBe('not json');
    expect(normalizeIncomingMessage({ payload: 'nope {' })).toBe('nope {');
  });

  it('passes null/undefined through', () => {
    expect(normalizeIncomingMessage(null)).toBe(null);
    expect(normalizeIncomingMessage(undefined)).toBe(undefined);
  });
});
