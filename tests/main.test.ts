import { afterEach, describe, expect, it, vi } from 'vitest';
import { WINDOW_LIMITS } from '../src/shared/window-size';

vi.mock('../src/adapter/normalize', () => ({
  normalizeNode: () => ({ id: '1', name: 'Frame', type: 'FRAME', width: 120, height: 80, warnings: [] }),
}));

const settle = async (): Promise<void> => { for (let i = 0; i < 8; i++) await Promise.resolve(); };
function setup(storage: Promise<unknown> = Promise.resolve(undefined)) {
  const events = new Map<string, () => void>();
  const page = { selection: [{ id: '1', type: 'RECTANGLE', absoluteTransform: [[1, 0, 10], [0, 1, 20]],
    parent: { type: 'FRAME', name: 'Parent', width: 500, height: 400, absoluteTransform: [[1, 0, 0], [0, 1, 0]] },
  }], on: vi.fn(), off: vi.fn() };
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
    expect(host.ui.postMessage.mock.lastCall?.[0].state.node.spacing).toEqual(expect.objectContaining({
      status: 'ready', parentName: 'Parent',
      values: { top: 20, right: 370, bottom: 300, left: 10, x: 10, y: 20, width: 120, height: 80 },
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
    expect(host.ui.resize).toHaveBeenLastCalledWith(320, WINDOW_LIMITS.maxHeight);
    await settle();
    expect(host.clientStorage.setAsync).toHaveBeenCalledWith('design-inspector-window-size', { width: 320, height: WINDOW_LIMITS.maxHeight });
    host.ui.onmessage?.({ type: 'resize', width: 5000, height: 10, finished: true });
    expect(host.ui.resize).toHaveBeenLastCalledWith(900, 300);
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
    expect(first.host.ui.resize).toHaveBeenCalledWith(900, 300);
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

  it('limits restored and requested dimensions to the available screen with window chrome space', async () => {
    const { host } = setup(Promise.resolve({ width: 900, height: 1000 }));
    await import('../src/main');
    await settle();
    host.ui.onmessage?.({ type: 'window-bounds', availableWidth: 800, availableHeight: 700 });
    expect(host.ui.resize).toHaveBeenLastCalledWith(768, 604);
    host.ui.onmessage?.({ type: 'resize', width: 10000, height: 10000, finished: true });
    await settle();
    expect(host.ui.resize).toHaveBeenLastCalledWith(768, 604);
    expect(host.clientStorage.setAsync).toHaveBeenLastCalledWith('design-inspector-window-size', { width: 768, height: 604 });
    // Switching to a very small screen cannot lower the explicit application minimum.
    host.ui.onmessage?.({ type: 'window-bounds', availableWidth: 200, availableHeight: 200 });
    expect(host.ui.resize).toHaveBeenLastCalledWith(320, 300);
  });

  it('clamps a delayed restored size after screen information arrives', async () => {
    let restore: ((value: unknown) => void) | undefined;
    const { host } = setup(new Promise(resolve => { restore = resolve; }));
    await import('../src/main');
    host.ui.onmessage?.({ type: 'window-bounds', availableWidth: 600, availableHeight: 600 });
    restore?.({ width: 900, height: 1000 });
    await settle();
    expect(host.ui.resize).toHaveBeenLastCalledWith(568, 504);
  });

  it('reports Figma resize rejection without saving failed requests or breaking inspection', async () => {
    const { host } = setup();
    await import('../src/main');
    host.ui.resize.mockImplementation(() => { throw new Error('Host rejected'); });
    host.ui.onmessage?.({ type: 'resize', width: 800, height: 900, finished: true });
    await settle();
    expect(host.clientStorage.setAsync).not.toHaveBeenCalled();
    expect(host.ui.postMessage).toHaveBeenLastCalledWith(expect.objectContaining({ type: 'resize-error', message: expect.stringContaining('Figma') }));
    host.ui.onmessage?.({ type: 'refresh' });
    expect(host.ui.postMessage).toHaveBeenLastCalledWith(expect.objectContaining({ type: 'inspector-state' }));
    host.ui.resize.mockReset();
    host.ui.onmessage?.({ type: 'resize', width: 500, height: 600, finished: true });
    await settle();
    expect(host.ui.postMessage).toHaveBeenLastCalledWith({ type: 'resize-error', message: '' });
    expect(host.clientStorage.setAsync).toHaveBeenLastCalledWith('design-inspector-window-size', { width: 500, height: 600 });
  });

  it('ignores invalid screen dimensions', async () => {
    const { host } = setup();
    await import('../src/main');
    for (const availableHeight of [NaN, Infinity, 0, -1, '600']) {
      host.ui.onmessage?.({ type: 'window-bounds', availableWidth: 600, availableHeight });
    }
    host.ui.onmessage?.({ type: 'resize', width: 900, height: 1000, finished: true });
    expect(host.ui.resize).toHaveBeenLastCalledWith(900, 1000);
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

describe('section presentation preferences', () => {
  const state = { properties: false, spacing: true, css: false };
  it('restores all independent sections on UI handshake', async () => {
    const { host } = setup(Promise.resolve(state));
    await import('../src/main');
    host.ui.onmessage?.({ type: 'sections-ready' });
    await settle();
    expect(host.ui.postMessage).toHaveBeenLastCalledWith({ type: 'section-state', sections: state });
    expect(host.clientStorage.setAsync).not.toHaveBeenCalled();
  });
  it('persists a full validated snapshot and restores it on the next launch', async () => {
    const first = setup();
    await import('../src/main');
    first.host.ui.onmessage?.({ type: 'set-sections', sections: state });
    await settle();
    expect(first.host.clientStorage.setAsync).toHaveBeenCalledWith('design-inspector-sections', state);
    vi.resetModules();
    const second = setup(Promise.resolve(first.host.clientStorage.setAsync.mock.calls[0]?.[1]));
    await import('../src/main');
    second.host.ui.onmessage?.({ type: 'sections-ready' });
    await settle();
    expect(second.host.ui.postMessage).toHaveBeenLastCalledWith({ type: 'section-state', sections: state });
  });
  it('does not undo a user toggle when the stored snapshot arrives late', async () => {
    let resolve: ((value: unknown) => void) | undefined;
    const { host } = setup(new Promise(done => { resolve = done; }));
    await import('../src/main');
    host.ui.onmessage?.({ type: 'sections-ready' });
    host.ui.onmessage?.({ type: 'set-sections', sections: state });
    resolve?.({ properties: true, spacing: false, css: true });
    await settle();
    expect(host.ui.postMessage).toHaveBeenLastCalledWith({ type: 'section-state', sections: state });
  });
  it('keeps defaults for invalid data and still inspects if preferences cannot be saved', async () => {
    const { host } = setup(Promise.resolve({ properties: 'closed', spacing: true, css: true }));
    host.clientStorage.setAsync.mockRejectedValue(new Error('Unavailable'));
    await import('../src/main');
    host.ui.onmessage?.({ type: 'set-sections', sections: { properties: false } });
    host.ui.onmessage?.({ type: 'sections-ready' });
    await settle();
    expect(host.ui.postMessage).toHaveBeenLastCalledWith({ type: 'section-state', sections: { properties: true, spacing: true, css: true } });
    expect(host.clientStorage.setAsync).not.toHaveBeenCalled();
    host.ui.onmessage?.({ type: 'set-sections', sections: state });
    await settle();
    host.ui.onmessage?.({ type: 'refresh' });
    expect(host.ui.postMessage).toHaveBeenLastCalledWith(expect.objectContaining({ type: 'inspector-state' }));
  });
});

describe('Project Styles host bridge', () => {
  const profile = { version: 1, name: 'Egispro', remBase: 10, files: [] };
  it('restores and saves only whitelisted metadata, preserving inspector transport', async () => {
    const { host } = setup(Promise.resolve(profile));
    await import('../src/main');
    host.ui.onmessage?.({ type: 'styles-profile-ready' });
    await settle();
    expect(host.ui.postMessage).toHaveBeenLastCalledWith({ type: 'styles-profile', profile });
    host.ui.onmessage?.({ type: 'save-styles-profile', profile: { ...profile, name: 'Updated', css: 'PRIVATE CSS', index: {} } });
    await settle();
    expect(host.clientStorage.setAsync).toHaveBeenLastCalledWith('design-inspector-styles-profile-v1', { ...profile, name: 'Updated' });
    host.ui.onmessage?.({ type: 'ready' });
    expect(host.ui.postMessage).toHaveBeenLastCalledWith(expect.objectContaining({ type: 'inspector-state' }));
  });
  it('does not undo edits when profile metadata loads late', async () => {
    let restore: ((value: unknown) => void) | undefined;
    const { host } = setup(new Promise(resolve => { restore = resolve; }));
    await import('../src/main');
    host.ui.onmessage?.({ type: 'save-styles-profile', profile });
    host.ui.onmessage?.({ type: 'styles-profile-ready' });
    restore?.({ ...profile, name: 'Old profile' });
    await settle();
    expect(host.ui.postMessage).toHaveBeenLastCalledWith({ type: 'styles-profile', profile });
  });
  it('handles parsing in the plugin sandbox when workers are unavailable without persisting CSS', async () => {
    vi.useFakeTimers();
    const { host } = setup();
    await import('../src/main');
    host.ui.onmessage?.({ type: 'styles-request', request: { id: 10, command: { type: 'import', id: 'main', name: 'main.css', css: '.card{width:100px;height:50px}' } } });
    expect(host.ui.postMessage).not.toHaveBeenCalledWith(expect.objectContaining({ type: 'styles-reply' }));
    vi.runOnlyPendingTimers();
    expect(host.ui.postMessage).toHaveBeenLastCalledWith(expect.objectContaining({ type: 'styles-reply', reply: { id: 10, response: expect.objectContaining({ snapshot: expect.objectContaining({ classes: 1 }) }) } }));
    expect(host.clientStorage.setAsync).not.toHaveBeenCalled();
    host.ui.onmessage?.({ type: 'styles-request', request: { id: 11, command: { type: 'import', id: 'bad', name: 'bad.css', css: '.bad{' } } });
    vi.runOnlyPendingTimers();
    expect(host.ui.postMessage).toHaveBeenLastCalledWith(expect.objectContaining({ type: 'styles-reply', reply: { id: 11, error: expect.any(String) } }));
  });
});
