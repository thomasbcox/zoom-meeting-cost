import { describe, it, expect, vi } from 'vitest';
import { logLifecycle } from './lifecycleLog.js';
import { instanceId } from './instanceId.js';

describe('instanceId', () => {
  it('is a stable, prefixed alphanumeric id', () => {
    expect(instanceId).toMatch(/^i_[a-z0-9]+$/);
    // Module const: same value on every read within a load.
    expect(instanceId).toBe(instanceId);
  });
});

describe('logLifecycle', () => {
  it('shapes the entry with kind, event, instanceId, and merged extras', () => {
    const sink = vi.fn();
    logLifecycle('boot', { mode: 'real', runningContext: 'inCamera' }, sink);
    expect(sink).toHaveBeenCalledTimes(1);
    expect(sink).toHaveBeenCalledWith({
      kind: 'lifecycle',
      event: 'boot',
      instanceId,
      mode: 'real',
      runningContext: 'inCamera',
    });
  });

  it('defaults extra to empty', () => {
    const sink = vi.fn();
    logLifecycle('panel-mounted', undefined, sink);
    expect(sink).toHaveBeenCalledWith({ kind: 'lifecycle', event: 'panel-mounted', instanceId });
  });

  it('never throws even if the sink throws', () => {
    const boom = () => {
      throw new Error('sink down');
    };
    expect(() => logLifecycle('overlay-message', { status: 'running' }, boom)).not.toThrow();
  });
});

