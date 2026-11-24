import { describe, expect, it, vi } from 'vitest';
import { captureTree, type CaptureTreeOptions } from '../src/adapter/tree';
import { TREE_LIMITS, parseTreePluginMessage, parseTreeSnapshot } from '../src/shared/tree';
import type { Matrix } from '../src/shared/spacing';

interface Source {
  id: string; name: string; type: string; parent: Source | null; children?: Source[];
  visible: boolean; locked: boolean; removed: boolean; width: number; height: number;
  absoluteTransform: Matrix; [key: string]: unknown;
}
function source(id: string, children?: Source[], type = children ? 'FRAME' : 'RECTANGLE'): Source {
  const node: Source = { id, name: id, type, parent: null, visible: true, locked: false, removed: false,
    width: 100, height: 50, absoluteTransform: [[1, 0, 0], [0, 1, 0]] };
  if (children) { node.children = children; for (const child of children) child.parent = node; }
  return node;
}
const options = (root: Source, overrides: Partial<CaptureTreeOptions> = {}): CaptureTreeOptions => ({
  identity: { requestId: 1, documentSessionId: 'session', revision: 2, rootId: root.id }, includeHidden: false,
  isStale: () => false, isCancelled: () => false, yieldControl: async () => {}, now: () => 0, ...overrides,
});
async function run(root: Source, overrides: Partial<CaptureTreeOptions> = {}) {
  return captureTree(root as unknown as SceneNode, options(root, overrides));
}
async function ready(root: Source, overrides: Partial<CaptureTreeOptions> = {}) {
  const result = await run(root, overrides);
  expect(result.status).toBe('ready');
  if (result.status !== 'ready') throw new Error(JSON.stringify(result));
  expect(parseTreeSnapshot(JSON.parse(JSON.stringify(result.snapshot)))).toEqual(result.snapshot);
  expect(parseTreePluginMessage({ type: 'tree-ready', ...options(root).identity, snapshot: result.snapshot })).toBeDefined();
  return result.snapshot;
}
const wide = (count: number) => source('root', Array.from({ length: count }, (_, i) => source(`child${i}`)));

describe('bounded read-only subtree capture', () => {
  it('captures preorder, reciprocal hierarchy, and existing normalized dimensions/Auto Layout', async () => {
    const text = source('text', undefined, 'TEXT'); Object.assign(text, { characters: '  Hello\n世界 👋 ', fontName: { family: 'Averta CY' }, fontSize: 16,
      fontWeight: 400, lineHeight: { unit: 'PERCENT', value: 145 }, letterSpacing: { unit: 'PERCENT', value: -1 } });
    const nested = source('nested', [text]);
    const root = source('root', [nested, source('rectangle')]);
    Object.assign(root, { layoutMode: 'HORIZONTAL', primaryAxisAlignItems: 'MIN', counterAxisAlignItems: 'CENTER', itemSpacing: 8,
      paddingTop: 4, paddingRight: 5, paddingBottom: 6, paddingLeft: 7 });
    const result = await ready(root);
    expect(result.sourceOrder).toEqual(['root', 'nested', 'text', 'rectangle']);
    expect(result.nodes.text?.parentId).toBe('nested');
    expect(result.nodes.root?.inspector?.layout).toEqual({ direction: 'row', justifyContent: 'flex-start', alignItems: 'center', gap: 8, padding: [4, 5, 6, 7] });
    expect(result.nodes.text?.inspector?.characters).toBe('  Hello\n世界 👋 ');
    expect(result.nodes.text?.inspector?.typography?.letterSpacing).toEqual({ unit: 'em', value: -0.01 });
    expect(result.nodes.root?.geometry?.parentLocalTransform).toBeUndefined();
    expect(result.completeness).toBe('complete');
    expect(JSON.stringify(result)).not.toContain('absoluteTransform":"');
  });
  it('keeps empty TEXT and mixed values without inventing typography', async () => {
    const text = source('text', undefined, 'TEXT'); Object.assign(text, { characters: '', fontName: Symbol('mixed'), fontSize: Symbol('mixed') });
    const result = await ready(text);
    expect(result.nodes.text?.inspector?.characters).toBe('');
    expect(result.nodes.text?.inspector?.typography).toBeUndefined();
    expect(result.nodes.text?.inspector?.warnings.length).toBeGreaterThan(0);
  });
  it('does not read hidden branch properties/children by default and treats locked as visible', async () => {
    const hidden = source('hidden', [source('secret')]); hidden.visible = false;
    const forbidden = vi.fn(() => { throw new Error('must not read'); });
    Object.defineProperty(hidden, 'children', { get: forbidden });
    Object.defineProperty(hidden, 'fills', { get: forbidden });
    const locked = source('locked', [source('visible-child')]); locked.locked = true;
    const result = await ready(source('root', [hidden, locked]));
    expect(forbidden).not.toHaveBeenCalled();
    expect(result.sourceOrder).toEqual(['root', 'hidden', 'locked', 'visible-child']);
    expect(result.nodes.hidden?.branch).toEqual({ status: 'omitted', reason: 'hidden', omittedChildren: null });
    expect(result.completeness).toBe('partial');
  });
  it('includes hidden descendants only in a new includeHidden capture', async () => {
    const hidden = source('hidden', [source('secret')]); hidden.visible = false;
    const root = source('root', [hidden]);
    expect((await ready(root)).sourceOrder).toEqual(['root', 'hidden']);
    expect((await ready(root, { includeHidden: true })).sourceOrder).toEqual(['root', 'hidden', 'secret']);
  });
  it.each(['INSTANCE', 'COMPONENT', 'COMPONENT_SET', 'GROUP', 'BOOLEAN_OPERATION'])('preserves %s source hierarchy without component lookup or detach', async type => {
    const root = source('root', [source('child')], type);
    const forbidden = vi.fn(() => { throw new Error('must not call'); });
    root.detachInstance = forbidden; Object.defineProperty(root, 'mainComponent', { get: forbidden });
    const result = await ready(root);
    expect(result.sourceOrder).toEqual(['root', 'child']); expect(forbidden).not.toHaveBeenCalled();
  });
  it('preserves unsupported shapes and masks as explicit placeholders', async () => {
    const mask = source('mask', [source('masked')]); mask.isMask = true;
    const forbidden = vi.fn(() => { throw new Error('mask children'); }); Object.defineProperty(mask, 'children', { get: forbidden });
    const result = await ready(source('root', [source('vector', undefined, 'VECTOR'), mask, source('after')]));
    expect(result.sourceOrder).toEqual(['root', 'vector', 'mask', 'after']);
    expect(result.nodes.vector?.branch.status).toBe('unsupported');
    expect(result.nodes.mask?.branch).toMatchObject({ status: 'unsupported', reason: 'mask' });
    expect(forbidden).not.toHaveBeenCalled();
  });
  it('keeps removed or throwing nodes as unavailable placeholders and never fabricates data', async () => {
    const unavailable = source('unavailable'); Object.defineProperty(unavailable, 'name', { get() { throw new Error('removed'); } });
    const removed = source('removed'); removed.removed = true;
    const unread = source('unread', []); Object.defineProperty(unread, 'children', { get() { throw new Error('API unavailable'); } });
    const result = await ready(source('root', [unavailable, removed, unread, source('after')]));
    expect(result.sourceOrder).toEqual(['root', 'unavailable', 'removed', 'unread', 'after']);
    expect(result.nodes.unavailable?.inspector).toBeUndefined();
    expect(result.nodes.removed?.inspector).toBeUndefined();
    for (const id of ['unavailable', 'removed', 'unread']) expect(result.nodes[id]?.branch).toMatchObject({ status: 'omitted', reason: 'unavailable' });
  });
  it('uses immediate Group axes and ignores relativeTransform, including rotated ancestors', async () => {
    const child = source('child'); child.absoluteTransform = [[0, -1, 70], [1, 0, 70]];
    const group = source('group', [child], 'GROUP'); group.absoluteTransform = [[0, -1, 100], [1, 0, 50]];
    const forbidden = vi.fn(() => { throw new Error('relativeTransform skips group'); }); Object.defineProperty(child, 'relativeTransform', { get: forbidden });
    const result = await ready(group);
    expect(result.nodes.child?.geometry?.parentLocalTransform).toEqual([[1, 0, 20], [0, 1, 30]]);
    expect(result.nodes.child?.inspector?.width).toBe(100); // no AABB redefinition
    expect(forbidden).not.toHaveBeenCalled();
    child.absoluteTransform[0][2] = 999;
    expect(result.nodes.child?.geometry?.absoluteTransform[0][2]).toBe(70); // detached data
  });
  it('preserves reflection/skew and negative parent-local coordinates', async () => {
    const child = source('child'); child.absoluteTransform = [[-2, 0.5, -10], [0, 3, -20]];
    const result = await ready(source('root', [child]));
    expect(result.nodes.child?.geometry?.parentLocalTransform).toEqual([[-2, 0.5, -10], [0, 3, -20]]);
  });
  it.each(([[[0, 0, 0], [0, 0, 0]], [[1, 0, 0], [0, 1, Infinity]]] as Matrix[]).map(transform => ({ transform })))('omits unstable or nonfinite geometry: $transform', async ({ transform }) => {
    const root = source('root', [source('child')]); root.absoluteTransform = transform;
    const result = await ready(root);
    expect(result.nodes.root?.geometry).toBeUndefined();
    expect(result.nodes.child?.geometry?.parentLocalTransform).toBeUndefined();
    expect(result.diagnostics.some(d => d.code === 'GEOMETRY_UNSTABLE')).toBe(true);
  });
  it('caps a very wide tree at 1000 nodes and marks the unvisited sibling suffix', async () => {
    const root = wide(1500); const yields = vi.fn(async () => {}), progress: number[] = [];
    const result = await ready(root, { yieldControl: yields, onProgress: count => progress.push(count) });
    expect(result.sourceOrder).toHaveLength(1000);
    expect(result.sourceOrder[result.sourceOrder.length - 1]).toBe('child998');
    expect(result.nodes.root?.branch).toEqual({ status: 'truncated', reason: 'node-limit', omittedChildren: 501 });
    expect(result.nodes.child999).toBeUndefined(); expect(yields).toHaveBeenCalled();
    expect(progress[progress.length - 1]).toBe(1000); expect(progress).toEqual([...progress].sort((a, b) => a - b));
  });
  it('caps depth at 64 without recursive traversal and preserves a reason on the terminal frame', async () => {
    let root = source('n100'); for (let i = 99; i >= 0; i--) root = source(`n${i}`, [root]);
    const result = await ready(root);
    expect(result.sourceOrder).toHaveLength(65);
    expect(result.nodes.n64?.branch).toEqual({ status: 'truncated', reason: 'depth-limit', omittedChildren: 1 });
  });
  it('records oversized node properties rather than silently truncating source text', async () => {
    const text = source('text', undefined, 'TEXT'); text.characters = 'x'.repeat(TREE_LIMITS.maxStringLength + 1);
    const result = await ready(source('root', [text, source('after')]));
    expect(result.nodes.text?.inspector).toBeUndefined();
    expect(result.nodes.text?.branch).toMatchObject({ status: 'truncated', reason: 'string-limit', omittedChildren: 0 });
    expect(result.nodes.after).toBeDefined();
    expect(JSON.stringify(result)).not.toContain('x'.repeat(100));
  });
  it.each(['string', 'byte'])('bounds aggregate %s budgets while leaving valid partial ancestry', async limit => {
    const root = source('root', Array.from({ length: 150 }, (_, i) => {
      const child = source(`t${i}`, undefined, 'TEXT'); child.characters = limit === 'byte' ? '\u0000'.repeat(12000) : 'a'.repeat(12000); return child;
    }));
    const result = await ready(root);
    expect(result.sourceOrder.length).toBeLessThan(151);
    expect(result.nodes.root?.branch).toMatchObject({ status: 'truncated', reason: `${limit}-limit` });
    expect(result.sourceOrder.slice(1)).toEqual(Array.from({ length: result.sourceOrder.length - 1 }, (_, i) => `t${i}`));
  });
  it('stops at the time budget and marks every pending ancestor, without dropping existing children', async () => {
    const root = source('root', [wide(100), source('after')]); root.children![0]!.id = 'nested';
    let ticks = 0;
    const result = await ready(root, { now: () => (ticks++ < 10 ? 0 : TREE_LIMITS.timeoutMs + 1) });
    expect(result.completeness).toBe('partial');
    expect(result.nodes.root?.branch).toMatchObject({ status: 'truncated', reason: 'time-limit' });
    expect(result.diagnostics.some(d => d.code === 'TREE_TRUNCATED')).toBe(true);
  });
  it.each(['cancelled', 'stale'] as const)('checks %s both before capture and immediately after yielding', async status => {
    const root = wide(100); let stop = false;
    const opts = { isCancelled: () => status === 'cancelled' && stop, isStale: () => status === 'stale' && stop,
      yieldControl: async () => { stop = true; } };
    const progress = vi.fn();
    expect((await run(root, { ...opts, onProgress: progress })).status).toBe(status);
    expect(progress).toHaveBeenCalledTimes(1);
    expect((await run(root, opts)).status).toBe(status);
  });
  it('does not return ready when removed or reparented during a yield', async () => {
    const root = wide(100);
    expect((await run(root, { yieldControl: async () => { root.removed = true; } })).status).toBe('stale');
    root.removed = false;
    expect((await run(root, { yieldControl: async () => { root.children![50]!.parent = source('other'); } })).status).toBe('stale');
  });
  it('accepts distinct API wrappers for the same parent identity', async () => {
    const root = source('root', [source('child')]);
    root.children![0]!.parent = source('root');
    expect((await ready(root)).sourceOrder).toEqual(['root', 'child']);
  });
  it('yields by elapsed chunk time even before the node-count limit', async () => {
    const root = wide(4); let ticks = 0;
    const yields = vi.fn(async () => {});
    await ready(root, { now: () => ticks++ * 4, yieldControl: yields });
    expect(yields).toHaveBeenCalled();
  });
  it('does not publish a completed leaf after timeout or cancellation in final progress', async () => {
    const root = source('root'); let ticks = 0;
    expect((await run(root, { now: () => ticks++ ? TREE_LIMITS.timeoutMs + 1 : 0 })).status).toBe('error');
    let cancelled = false;
    expect((await run(root, { isCancelled: () => cancelled, onProgress: () => { cancelled = true; } })).status).toBe('cancelled');
  });
  it('returns errors for invalid identity, bad root, scheduler failures and inaccessible child ids', async () => {
    const root = source('root');
    expect((await run(root, { identity: { ...options(root).identity, rootId: 'different' } })).status).toBe('error');
    expect((await run(root, { identity: { ...options(root).identity, requestId: NaN } })).status).toBe('error');
    expect((await run(wide(100), { yieldControl: async () => { throw new Error('scheduler failed'); } })).status).toBe('error');
    const child = source('child'); Object.defineProperty(child, 'id', { get() { throw new Error('unavailable id'); } });
    expect((await run(source('root', [child]))).status).toBe('error');
  });
  it('is deterministic and never mutates source properties, hierarchy or document state', async () => {
    const root = source('root', [source('child')]);
    const before = Object.getOwnPropertyDescriptors(root), children = root.children;
    const first = await ready(root), second = await ready(root);
    expect(first).toEqual(second); expect(root.children).toBe(children);
    expect(Object.getOwnPropertyDescriptors(root)).toEqual(before); expect(root.children![0]!.parent).toBe(root);
  });
});
