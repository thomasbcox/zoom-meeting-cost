import { describe, it, expect } from 'vitest';
import BuildBadge from './BuildBadge.jsx';
import { buildInfo, envKind, shortCommit } from '../lib/buildInfo.js';

// Hook-free component: call it directly and inspect the returned element (same approach
// as CostOverlay.test.js — node env, no jsdom).

const flatten = (children) => (Array.isArray(children) ? children.join('') : String(children));

describe('BuildBadge', () => {
  it('renders in every environment (never hidden) — so prod shows too, just styled muted', () => {
    const el = BuildBadge();
    expect(el).not.toBe(null);
    expect(el.type).toBe('span');
  });

  it('uses a fixed, normalized env class (not the raw env string)', () => {
    const el = BuildBadge();
    expect(el.props.className).toBe(`build-badge build-badge-${envKind}`);
    // The class token is always one of the fixed vocabulary — never a raw 'production' etc.
    expect(['prod', 'dev', 'other']).toContain(envKind);
  });

  it('shows a compact env label and the short commit', () => {
    const el = BuildBadge();
    const text = flatten(el.props.children);
    expect(text).toContain(shortCommit);
    const label = envKind === 'other' ? buildInfo.env : envKind;
    expect(text).toContain(label);
  });

  it('carries the full commit in the title tooltip for support/matching', () => {
    const el = BuildBadge();
    expect(el.props.title).toContain(buildInfo.commit);
  });
});
