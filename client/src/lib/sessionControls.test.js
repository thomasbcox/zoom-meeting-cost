import { describe, it, expect } from 'vitest';
import { sessionControls } from './sessionControls.js';

describe('sessionControls', () => {
  it('idle offers only Start (begin the first session)', () => {
    expect(sessionControls('idle')).toEqual({
      start: true,
      startNew: false,
      resume: false,
      pause: false,
      end: false,
    });
  });

  it('running offers Pause + End', () => {
    expect(sessionControls('running')).toEqual({
      start: false,
      startNew: false,
      resume: false,
      pause: true,
      end: true,
    });
  });

  it('paused offers Resume + End', () => {
    expect(sessionControls('paused')).toEqual({
      start: false,
      startNew: false,
      resume: true,
      pause: false,
      end: true,
    });
  });

  // The fixed dead-end: ended must offer a way out (start new OR resume), not nothing.
  it('ended offers Start new + Resume (no longer a dead-end)', () => {
    expect(sessionControls('ended')).toEqual({
      start: false,
      startNew: true,
      resume: true,
      pause: false,
      end: false,
    });
  });

  it('an unknown status offers no controls (safe default)', () => {
    expect(sessionControls(undefined)).toEqual({
      start: false,
      startNew: false,
      resume: false,
      pause: false,
      end: false,
    });
  });
});
