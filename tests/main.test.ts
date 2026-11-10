import { afterEach, describe, expect, it, vi } from 'vitest';

vi.mock('../src/adapter/normalize', () => ({
  normalizeNode: () => ({ id: '1', name: 'Frame', type: 'FRAME', width: 120, warnings: [] }),
}));

const settle = async (): Promise<void> => { for (let i = 0; i < 8; i++) await Promise.resolve(); };
function setup(storage: Promise<unknown> = Promise.resolve(undefined)) {
  const events = new Map<string, () => void>();
  const page = { selection: [{ id: '1' }], on: vi.fn(), off: vi.fn() };
  const host = {
    showUI: vi.fn(), currentPage: page,
    ui: { postMessage: vi.fn(), resize: vi.fn(), onmessage: undefined as undefined | ((message: unknown) => void) },
    clientStorage: { getAsync: vi.fn(() => storage), setAsync: vi.fn(async (_key: string, _value: unknown): Promise<void> => {}) },
    on: (event: string, callback: () => void) => events.set(event, callback),
  };
  vi.stubGlobal('figma', host);
  vi.stubGlobal('__html__', '<html></html>');
  return { host, events, page };
}

afterEach(() => { vi.clearAllTimers(); vi.useRealTimers(); vi.unstubAllGlobals(); vi.resetModules(); });

describe('Figma host transport', () => {
  it('responds to UI readiness, refresh, and selection changes', async () => {
    const { host, events, page } = setup();
    await import('../src/main');
    host.ui.postMessage.mockClear();
    host.ui.onmessage?.({ type: 'ready' });
    expect(host.ui.postMessage).toHaveBeenLastCalledWith(expect.objectContaining({
      type: 'inspector-state', state: expect.objectContaining({ status: 'ready', css: expect.stringContaining('width: 120px;') }),
    }));
    page.selection = [];
    events.get('selectionchange')?.();
    expect(host.ui.postMessage).toHaveBeenLastCalledWith({ type: 'inspector-state', state: { status: 'empty' } });
    host.ui.postMessage.mockClear();
    host.ui.onmessage?.({ type: 'refresh' });
    expect(host.ui.postMessage).toHaveBeenCalledOnce();
  });
});

describe('window resize and persistence', () => {
  it('keeps the original default on first launch or invalid stored data', async () => {
    for (const stored of [undefined, { width: '500', height: 600 }, { width: NaN, height: 600 }]) {
      vi.resetModules();
      const { host } = setup(Promise.resolve(stored));
      await import('../src/main');
      await settle();
      expect(host.showUI).toHaveBeenCalledWith('<html></html>', { width: 380, height: 640, themeColors: true });
      expect(host.ui.resize).not.toHaveBeenCalled();
    }
  });

  it('clamps dimensions in the host and saves at drag completion', async () => {
    const { host } = setup();
    await import('../src/main');
    host.ui.onmessage?.({ type: 'resize', width: 100, height: 5000, finished: true });
    expect(host.ui.resize).toHaveBeenLastCalledWith(320, 1000);
    await settle();
    expect(host.clientStorage.setAsync).toHaveBeenCalledWith('design-inspector-window-size', { width: 320, height: 1000 });
    host.ui.onmessage?.({ type: 'resize', width: 5000, height: 10, finished: true });
    expect(host.ui.resize).toHaveBeenLastCalledWith(900, 400);
  });

  it('debounces movement and cancels the pending save when drag ends', async () => {
    vi.useFakeTimers();
    const { host } = setup();
    await import('../src/main');
    for (let width = 400; width <= 600; width += 100) {
      host.ui.onmessage?.({ type: 'resize', width, height: 700, finished: false });
      vi.advanceTimersByTime(100);
    }
    await settle();
    expect(host.clientStorage.setAsync).not.toHaveBeenCalled();
    vi.advanceTimersByTime(300);
    await settle();
    expect(host.clientStorage.setAsync).toHaveBeenCalledTimes(1);
    expect(host.clientStorage.setAsync).toHaveBeenLastCalledWith('design-inspector-window-size', { width: 600, height: 700 });
    host.ui.onmessage?.({ type: 'resize', width: 650, height: 750, finished: false });
    host.ui.onmessage?.({ type: 'resize', width: 680, height: 780, finished: true });
    vi.advanceTimersByTime(1000);
    await settle();
    expect(host.clientStorage.setAsync).toHaveBeenCalledTimes(2);
    expect(host.clientStorage.setAsync).toHaveBeenLastCalledWith('design-inspector-window-size', { width: 680, height: 780 });
  });

  it('restores saved dimensions on the next independent plugin launch', async () => {
    const first = setup();
    await import('../src/main');
    first.host.ui.onmessage?.({ type: 'resize', width: 720, height: 820, finished: true });
    await settle();
    const saved = first.host.clientStorage.setAsync.mock.calls[0]?.[1];
    vi.resetModules();
    const second = setup(Promise.resolve(saved));
    await import('../src/main');
    await settle();
    expect(second.host.ui.resize).toHaveBeenCalledWith(720, 820);
    expect(second.host.clientStorage.setAsync).not.toHaveBeenCalled();
  });

  it('serializes slow storage writes so the final size is saved last', async () => {
    const { host } = setup();
    let finishFirst: (() => void) | undefined;
    host.clientStorage.setAsync.mockImplementationOnce(() => new Promise<void>(resolve => { finishFirst = resolve; }));
    await import('../src/main');
    host.ui.onmessage?.({ type: 'resize', width: 500, height: 700, finished: true });
    await settle();
    host.ui.onmessage?.({ type: 'resize', width: 600, height: 800, finished: true });
    await settle();
    expect(host.clientStorage.setAsync).toHaveBeenCalledTimes(1);
    finishFirst?.();
    await settle();
    expect(host.clientStorage.setAsync).toHaveBeenCalledTimes(2);
    expect(host.clientStorage.setAsync).toHaveBeenLastCalledWith('design-inspector-window-size', { width: 600, height: 800 });
  });

  it('clamps stored sizes and ignores a delayed restore after user interaction', async () => {
    const first = setup(Promise.resolve({ width: 10000, height: 0 }));
    await import('../src/main');
    await settle();
    expect(first.host.ui.resize).toHaveBeenCalledWith(900, 400);
    vi.resetModules();
    let resolve: ((value: unknown) => void) | undefined;
    const second = setup(new Promise(value => { resolve = value; }));
    await import('../src/main');
    second.host.ui.onmessage?.({ type: 'resize', width: 500, height: 600, finished: true });
    resolve?.({ width: 800, height: 900 });
    await settle();
    expect(second.host.ui.resize).toHaveBeenCalledTimes(1);
    expect(second.host.ui.resize).toHaveBeenLastCalledWith(500, 600);
  });

  it('rejects malformed resize requests without disrupting inspection', async () => {
    const { host } = setup();
    await import('../src/main');
    for (const message of [null, {}, { type: 'resize', width: NaN, height: 500, finished: true },
      { type: 'resize', width: 500, height: Infinity, finished: true },
      { type: 'resize', width: 500, height: 600 }, { type: 'resize', width: 500, height: 600, finished: 'yes' }]) host.ui.onmessage?.(message);
    expect(host.ui.resize).not.toHaveBeenCalled();
    host.ui.onmessage?.({ type: 'ready' });
    expect(host.ui.postMessage).toHaveBeenLastCalledWith(expect.objectContaining({ state: expect.objectContaining({ status: 'ready' }) }));
  });

  it('keeps resizing and inspection available if storage reads or writes fail', async () => {
    const { host } = setup(Promise.reject(new Error('Unavailable')));
    host.clientStorage.setAsync.mockRejectedValue(new Error('Quota'));
    await import('../src/main');
    host.ui.onmessage?.({ type: 'resize', width: 500, height: 700, finished: true });
    await settle();
    host.ui.onmessage?.({ type: 'resize', width: 520, height: 720, finished: true });
    await settle();
    expect(host.ui.resize).toHaveBeenLastCalledWith(520, 720);
    expect(host.clientStorage.setAsync).toHaveBeenCalledTimes(2);
  });
});
