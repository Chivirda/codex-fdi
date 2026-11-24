import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { CaptureTreeOptions, CaptureTreeResult } from '../src/adapter/tree';
import type { TreeIdentity, TreePluginMessage } from '../src/shared/tree';
import { parseTreePluginMessage } from '../src/shared/tree';
import { minimalTree } from './fixtures/tree/minimal';
const { capture } = vi.hoisted(() => ({ capture: vi.fn() }));
vi.mock('../src/adapter/tree', () => ({ captureTree: capture }));
vi.mock('../src/adapter/normalize', () => ({ normalizeNode: (node: SceneNode) => ({ id: node.id, name: node.name, type: node.type, width: 100, height: 50, warnings: [] }) }));
const settle = async () => { for (let i = 0; i < 15; i++) await Promise.resolve(); };
function page(id: string) {
  return { id, selection: [{ id: 'root', name: 'Root', type: 'RECTANGLE', visible: true, locked: false, removed: false,
    width: 100, height: 50, absoluteTransform: [[1, 0, 0], [0, 1, 0]],
    parent: { id: 'parent', type: 'FRAME', name: 'Parent', width: 500, height: 400, absoluteTransform: [[1, 0, 0], [0, 1, 0]] },
  }], handlers: new Map<string, () => void>(),
    on: vi.fn(function (this: { handlers: Map<string, () => void> }, type: string, callback: () => void) { this.handlers.set(type, callback); }),
    off: vi.fn(function (this: { handlers: Map<string, () => void> }, type: string) { this.handlers.delete(type); }),
  };
}
interface Pending {
  options: CaptureTreeOptions; resolve(result: CaptureTreeResult): void; reject(error: Error): void;
}
async function setup() {
  const pending: Pending[] = [];
  capture.mockImplementation((_node: SceneNode, options: CaptureTreeOptions) => new Promise<CaptureTreeResult>((resolve, reject) => pending.push({ options, resolve, reject })));
  const events = new Map<string, () => void>();
  const host = { currentPage: page('page-1'), showUI: vi.fn(),
    ui: { onmessage: undefined as ((data: unknown) => void) | undefined, postMessage: vi.fn(), resize: vi.fn() },
    clientStorage: { getAsync: vi.fn(async () => undefined), setAsync: vi.fn(async () => {}) },
    on: vi.fn((type: string, callback: () => void) => events.set(type, callback)),
  };
  vi.stubGlobal('figma', host); vi.stubGlobal('__html__', '<html></html>');
  await import('../src/main'); await settle();
  const send = (data: unknown) => host.ui.onmessage?.(data);
  const inspect = (requestId = 1, rootId = 'root', includeHidden = false) => send({ type: 'tree-inspect', requestId, rootId, includeHidden });
  const messages = () => host.ui.postMessage.mock.calls.map(([m]) => m as TreePluginMessage).filter(m => m.type.startsWith('tree-'));
  const ready = (operation: Pending) => {
    const snapshot = { ...minimalTree(), ...operation.options.identity };
    operation.resolve({ status: 'ready', snapshot });
  };
  return { host, events, pending, send, inspect, messages, ready };
}
const identity = (s: Awaited<ReturnType<typeof setup>>, index = 0): TreeIdentity => {
  const message = s.messages().filter(m => m.type === 'tree-started')[index]!;
  return { requestId: message.requestId, documentSessionId: message.documentSessionId, revision: message.revision, rootId: message.rootId };
};

beforeEach(() => { vi.useFakeTimers(); capture.mockReset(); });
afterEach(() => { vi.clearAllTimers(); vi.useRealTimers(); vi.unstubAllGlobals(); vi.resetModules(); });

describe('main tree state machine and transport', () => {
  it('starts only the selected root and emits validated monotonic progress then ready', async () => {
    const s = await setup(); s.inspect(1, 'root', true); await settle();
    expect(capture).toHaveBeenCalledTimes(1);
    expect(capture.mock.calls[0]?.[0]).toBe(s.host.currentPage.selection[0]);
    const op = s.pending[0]!;
    expect(op.options.includeHidden).toBe(true);
    for (const count of [0, 1, 1, 0, -1, NaN, Infinity, 1001, 2]) op.options.onProgress?.(count);
    s.ready(op); await settle();
    expect(s.messages().map(m => m.type)).toEqual(['tree-started', 'tree-progress', 'tree-progress', 'tree-progress', 'tree-ready']);
    expect(s.messages().filter(m => m.type === 'tree-progress').map(m => m.processedNodes)).toEqual([0, 1, 2]);
    for (const message of s.messages()) expect(parseTreePluginMessage(message)).toBeDefined();
    op.options.onProgress?.(3);
    expect(s.messages().filter(m => m.type === 'tree-progress')).toHaveLength(3);
  });
  it('cancels immediately before the first adapter read and does not cancel twice', async () => {
    const s = await setup(); s.inspect();
    s.send({ type: 'tree-cancel', ...identity(s) }); s.send({ type: 'tree-cancel', ...identity(s) });
    await settle();
    expect(capture).not.toHaveBeenCalled();
    expect(s.messages().map(m => m.type)).toEqual(['tree-started', 'tree-cancelled']);
  });
  it('cancels running work cooperatively and suppresses late progress/ready', async () => {
    const s = await setup(); s.inspect(); await settle(); const op = s.pending[0]!;
    s.send({ type: 'tree-cancel', ...identity(s) });
    expect(op.options.isCancelled()).toBe(true);
    op.options.onProgress?.(10); s.ready(op); await settle();
    expect(s.messages().map(m => m.type)).toEqual(['tree-started', 'tree-cancelled']);
  });
  it('rejects malformed, foreign-session and stale cancellation identities', async () => {
    const s = await setup(); s.inspect(); await settle(); const current = identity(s);
    for (const changed of [{ requestId: 99 }, { revision: current.revision + 1 }, { rootId: 'other' }, { documentSessionId: 'other' }]) s.send({ type: 'tree-cancel', ...current, ...changed });
    s.send({ type: 'tree-cancel', requestId: 1 });
    expect(s.pending[0]!.options.isCancelled()).toBe(false);
    s.ready(s.pending[0]!); await settle();
    s.send({ type: 'tree-cancel', ...current }); // late cancel after ready is ignored
    expect(s.messages().map(m => m.type)).toEqual(['tree-started', 'tree-ready']);
  });
  it('replaces a request without accepting old completions or replayed IDs', async () => {
    const s = await setup(); s.inspect(10); await settle(); const first = s.pending[0]!;
    s.inspect(11); await settle(); const second = s.pending[1]!;
    expect(first.options.isStale()).toBe(true);
    expect(second.options.identity.revision).toBeGreaterThan(first.options.identity.revision);
    s.inspect(10); s.inspect(11); await settle(); expect(capture).toHaveBeenCalledTimes(2);
    first.options.onProgress?.(100); s.ready(first); s.ready(second); await settle();
    expect(s.messages().map(m => m.type)).toEqual(['tree-started', 'tree-stale', 'tree-started', 'tree-ready']);
    expect(s.messages().filter(m => m.type === 'tree-ready')[0]?.requestId).toBe(11);
    expect(s.messages().find(m => m.type === 'tree-stale')).toMatchObject({ reason: 'replaced', requestId: 10 });
  });
  it('coalesces an edit storm while revoking the operation synchronously', async () => {
    const s = await setup(); s.inspect(); await settle(); const op = s.pending[0]!;
    for (let i = 0; i < 100; i++) s.host.currentPage.handlers.get('nodechange')?.();
    expect(op.options.isStale()).toBe(true);
    op.options.onProgress?.(100); s.ready(op); await settle();
    expect(s.messages().map(m => m.type)).toEqual(['tree-started']); // UI notice queued; no ready race
    vi.runOnlyPendingTimers();
    expect(s.messages().map(m => m.type)).toEqual(['tree-started', 'tree-stale']);
    expect(s.messages()[1]).toMatchObject({ reason: 'document' });
    expect(capture).toHaveBeenCalledTimes(1); // no automatic subtree recapture
  });
  it('invalidates an already ready snapshot on document edits without late progress', async () => {
    const s = await setup(); s.inspect(); await settle(); s.ready(s.pending[0]!); await settle();
    s.host.currentPage.handlers.get('nodechange')?.(); vi.runOnlyPendingTimers();
    s.pending[0]!.options.onProgress?.(20);
    expect(s.messages().map(m => m.type)).toEqual(['tree-started', 'tree-ready', 'tree-stale']);
  });
  it('invalidates selection and page changes and rebinds only the current page listener', async () => {
    const s = await setup(); s.inspect(); await settle(); const oldPage = s.host.currentPage;
    oldPage.selection = []; s.events.get('selectionchange')?.(); vi.runOnlyPendingTimers();
    expect(s.messages()[1]).toMatchObject({ type: 'tree-stale', reason: 'selection' });
    oldPage.selection = page('unused').selection; s.inspect(2); await settle();
    const newPage = page('page-2'); s.host.currentPage = newPage; s.events.get('currentpagechange')?.(); vi.runOnlyPendingTimers();
    expect(s.messages().filter(m => m.type === 'tree-stale')[1]).toMatchObject({ reason: 'page', requestId: 2 });
    expect(oldPage.handlers.has('nodechange')).toBe(false); expect(newPage.handlers.has('nodechange')).toBe(true);
    for (const op of s.pending) s.ready(op); await settle();
    expect(s.messages().some(m => m.type === 'tree-ready')).toBe(false);
    s.inspect(3); await settle(); s.ready(s.pending[2]!); await settle();
    expect(s.messages()[s.messages().length - 1]).toMatchObject({ type: 'tree-ready', requestId: 3 });
  });
  it('flushes queued stale notification before starting a new request', async () => {
    const s = await setup(); s.inspect(); await settle();
    s.host.currentPage.handlers.get('nodechange')?.(); s.inspect(2); await settle(); vi.runOnlyPendingTimers();
    expect(s.messages().map(m => m.type)).toEqual(['tree-started', 'tree-stale', 'tree-started']);
  });
  it('Refresh invalidates tree state and still returns ordinary inspector data', async () => {
    const s = await setup(); s.inspect(); await settle(); s.send({ type: 'refresh' });
    expect(s.messages()[1]).toMatchObject({ type: 'tree-stale', reason: 'refresh' });
    expect(s.host.ui.postMessage).toHaveBeenLastCalledWith(expect.objectContaining({ type: 'inspector-state', state: expect.objectContaining({ status: 'ready' }) }));
    s.ready(s.pending[0]!); await settle(); expect(s.messages().some(m => m.type === 'tree-ready')).toBe(false);
  });
  it('rejects stale selection/page even if an expected host event was missed', async () => {
    const s = await setup(); s.inspect(); await settle(); s.host.currentPage.selection = [];
    s.ready(s.pending[0]!); await settle(); expect(s.messages()[1]).toMatchObject({ type: 'tree-stale', reason: 'selection' });
    s.host.currentPage = page('page-1'); s.inspect(2); await settle(); s.host.currentPage = page('page-2');
    s.pending[1]!.options.onProgress?.(1);
    expect(s.messages()[s.messages().length - 1]).toMatchObject({ type: 'tree-stale', reason: 'page' });
  });
  it('rejects unknown roots and empty/multiple selection without document scanning', async () => {
    const s = await setup(); s.inspect(1, 'different');
    s.host.currentPage.selection = []; s.inspect(2);
    s.host.currentPage.selection = [page('a').selection[0]!, page('b').selection[0]!]; s.inspect(3);
    await settle(); expect(capture).not.toHaveBeenCalled();
    expect(s.messages().map(m => m.type)).toEqual(['tree-error', 'tree-error', 'tree-error']);
    for (const message of s.messages()) expect(parseTreePluginMessage(message)).toBeDefined();
  });
  it('ignores malformed messages without invalidating current work or invoking getters', async () => {
    const s = await setup(); s.inspect(); await settle(); const getter = vi.fn();
    for (const data of [null, [], { type: 'tree-inspect', requestId: NaN, rootId: 'root', includeHidden: false },
      { type: 'tree-inspect', requestId: 2, rootId: 'root', includeHidden: 'false' },
      { type: 'tree-inspect', requestId: 2, rootId: 'root', includeHidden: false, extra: 1 },
      Object.defineProperty({}, 'type', { enumerable: true, get: getter })]) s.send(data);
    expect(getter).not.toHaveBeenCalled(); expect(capture).toHaveBeenCalledTimes(1);
    expect(s.pending[0]!.options.isStale()).toBe(false);
    s.ready(s.pending[0]!); await settle(); expect(s.messages().map(m => m.type)).toEqual(['tree-started', 'tree-ready']);
  });
  it.each(['error', 'reject', 'wrong-identity', 'malformed'] as const)('reports adapter %s and ignores progress after error', async kind => {
    const s = await setup(); s.inspect(); await settle(); const op = s.pending[0]!;
    if (kind === 'reject') op.reject(new Error('adapter threw'));
    else if (kind === 'error') op.resolve({ status: 'error', message: 'Source unavailable' });
    else { const snapshot = { ...minimalTree(), ...op.options.identity }; if (kind === 'wrong-identity') snapshot.revision++;
      else snapshot.nodes.root!.childIds.push('missing'); op.resolve({ status: 'ready', snapshot }); }
    await settle(); op.options.onProgress?.(10);
    expect(s.messages().map(m => m.type)).toEqual(['tree-started', 'tree-error']);
    s.inspect(2); await settle(); s.ready(s.pending[1]!); await settle();
    expect(s.messages()[s.messages().length - 1]?.type).toBe('tree-ready');
  });
  it('rejects a final snapshot that goes backwards from published progress', async () => {
    const s = await setup(); s.inspect(); await settle();
    s.pending[0]!.options.onProgress?.(3); // fixture snapshot has only 2 represented nodes
    s.ready(s.pending[0]!); await settle();
    expect(s.messages().map(m => m.type)).toEqual(['tree-started', 'tree-progress', 'tree-error']);
  });
  it('maps adapter stale/cancelled terminal results and suppresses late rejection from replaced work', async () => {
    const s = await setup(); s.inspect(); await settle(); s.pending[0]!.resolve({ status: 'stale' }); await settle();
    expect(s.messages()[1]).toMatchObject({ type: 'tree-stale' });
    s.inspect(2); await settle(); s.pending[1]!.resolve({ status: 'cancelled' }); await settle();
    expect(s.messages()[s.messages().length - 1]?.type).toBe('tree-cancelled');
    s.inspect(3); await settle(); s.inspect(4); await settle(); s.pending[2]!.reject(new Error('late'));
    s.ready(s.pending[3]!); await settle();
    expect(s.messages().some(m => m.type === 'tree-error')).toBe(false);
  });
  it('clears pending notifications and ignores async completions when plugin closes', async () => {
    const s = await setup(); s.inspect(); await settle(); s.host.currentPage.handlers.get('nodechange')?.();
    s.events.get('close')?.(); vi.runOnlyPendingTimers(); s.ready(s.pending[0]!); await settle();
    expect(s.messages().map(m => m.type)).toEqual(['tree-started']);
  });
  it('runs the real adapter through the host without changing the single-node response', async () => {
    const s = await setup();
    const actual = await vi.importActual<typeof import('../src/adapter/tree')>('../src/adapter/tree');
    capture.mockImplementation(actual.captureTree);
    s.inspect(); await settle();
    const ready = s.messages().find(m => m.type === 'tree-ready');
    expect(ready?.type === 'tree-ready' && ready.snapshot.sourceOrder).toEqual(['root']);
    s.send({ type: 'ready' });
    expect(s.host.ui.postMessage).toHaveBeenLastCalledWith(expect.objectContaining({ type: 'inspector-state', state: expect.objectContaining({ status: 'ready' }) }));
  });
});
