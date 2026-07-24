import { describe, it, expect, vi } from 'vitest';
import { attemptStartOverlay, CAMERA_OFF_NOTICE } from './App.jsx';

// attemptStartOverlay is the extracted, node-testable orchestrator behind the "Show cost on
// video" button (no jsdom needed). Deps are injected; we assert the result and exactly which
// state-mutating deps ran, per the camera-off-guard ACs.

function makeDeps(adapter, { status = 'idle' } = {}) {
  const logs = [];
  return {
    adapter,
    status,
    startSession: vi.fn(),
    seedBaseline: vi.fn(),
    post: vi.fn(),
    log: (event) => logs.push(event),
    _logs: logs,
  };
}

describe('attemptStartOverlay', () => {
  it('camera off: blocks before any mutation, no throw (AC1, AC3)', async () => {
    const startCameraOverlay = vi.fn(async () => {});
    const deps = makeDeps({ getVideoState: async () => false, startCameraOverlay });
    const result = await attemptStartOverlay(deps);
    expect(result).toBe('blocked-camera-off');
    expect(startCameraOverlay).not.toHaveBeenCalled(); // never reached the SDK
    expect(deps.startSession).not.toHaveBeenCalled(); // session did NOT auto-start
    expect(deps.seedBaseline).not.toHaveBeenCalled(); // recovery baseline NOT seeded
    expect(deps.post).not.toHaveBeenCalled();
    expect(deps._logs).toEqual(['start-overlay:begin', 'start-overlay:blocked-camera-off']);
  });

  it('camera on + idle: starts the session, seeds, posts, full breadcrumbs (AC4)', async () => {
    const startCameraOverlay = vi.fn(async () => {});
    const deps = makeDeps({ getVideoState: async () => true, startCameraOverlay }, { status: 'idle' });
    const result = await attemptStartOverlay(deps);
    expect(result).toBe('started');
    expect(startCameraOverlay).toHaveBeenCalledTimes(1);
    expect(deps.startSession).toHaveBeenCalledTimes(1);
    expect(deps.seedBaseline).toHaveBeenCalledTimes(1);
    expect(deps.post).toHaveBeenCalledTimes(1);
    expect(deps._logs).toEqual([
      'start-overlay:begin',
      'start-overlay:context-started',
      'start-overlay:posted',
    ]);
  });

  it('camera on + not idle: starts the overlay but does not re-start the session (AC4)', async () => {
    const deps = makeDeps(
      { getVideoState: async () => true, startCameraOverlay: async () => {} },
      { status: 'running' }
    );
    expect(await attemptStartOverlay(deps)).toBe('started');
    expect(deps.startSession).not.toHaveBeenCalled(); // only 'idle' auto-starts
    expect(deps.seedBaseline).toHaveBeenCalledTimes(1);
    expect(deps.post).toHaveBeenCalledTimes(1);
  });

  it('SDK rejects: caught, returns error, mutates nothing (AC5)', async () => {
    const deps = makeDeps({
      getVideoState: async () => true, // probe said "on"...
      startCameraOverlay: async () => {
        throw new Error('Video is not sending.'); // ...but the start still failed
      },
    });
    const result = await attemptStartOverlay(deps);
    expect(result).toBe('error');
    expect(deps.startSession).not.toHaveBeenCalled();
    expect(deps.seedBaseline).not.toHaveBeenCalled();
    expect(deps.post).not.toHaveBeenCalled();
    expect(deps._logs).toContain('start-overlay:error');
  });

  it('unknown camera state (probe missing or throwing) proceeds to start', async () => {
    const startA = vi.fn(async () => {});
    expect(await attemptStartOverlay(makeDeps({ startCameraOverlay: startA }))).toBe('started');
    expect(startA).toHaveBeenCalled(); // no getVideoState → unknown → proceed

    const startB = vi.fn(async () => {});
    const depsThrow = makeDeps({
      getVideoState: async () => {
        throw new Error('probe unavailable');
      },
      startCameraOverlay: startB,
    });
    expect(await attemptStartOverlay(depsThrow)).toBe('started'); // throwing probe → proceed
    expect(startB).toHaveBeenCalled();
  });

  it('the warning names both steps (turn camera on AND click show)', () => {
    expect(CAMERA_OFF_NOTICE).toContain('camera on');
    expect(CAMERA_OFF_NOTICE).toContain('Show cost on video');
  });
});
