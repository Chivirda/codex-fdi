import { afterEach, describe, expect, it, vi } from 'vitest';

vi.mock('../src/adapter/normalize', () => ({
  normalizeNode: () => ({ id: '1', name: 'Frame', type: 'FRAME', width: 120, warnings: [] }),
}));

afterEach(() => { vi.unstubAllGlobals(); vi.resetModules(); });

describe('Figma host transport', () => {
  it('responds to UI readiness, refresh, and selection changes', async () => {
    const events = new Map<string, () => void>();
    const postMessage = vi.fn();
    const page = { selection: [{ id: '1' }], on: vi.fn(), off: vi.fn() };
    const host = {
      showUI: vi.fn(), currentPage: page,
      ui: { postMessage, onmessage: undefined as undefined | ((message: unknown) => void) },
      on: (event: string, callback: () => void) => events.set(event, callback),
    };
    vi.stubGlobal('figma', host);
    vi.stubGlobal('__html__', '<html></html>');
    await import('../src/main');
    postMessage.mockClear();
    host.ui.onmessage?.({ type: 'ready' });
    expect(postMessage).toHaveBeenLastCalledWith(expect.objectContaining({
      type: 'inspector-state', state: expect.objectContaining({ status: 'ready', css: expect.stringContaining('width: 120px;') }),
    }));
    page.selection = [];
    events.get('selectionchange')?.();
    expect(postMessage).toHaveBeenLastCalledWith({ type: 'inspector-state', state: { status: 'empty' } });
    postMessage.mockClear();
    host.ui.onmessage?.({ type: 'refresh' });
    expect(postMessage).toHaveBeenCalledOnce();
  });
});
