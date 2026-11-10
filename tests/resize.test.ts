import { describe, expect, it, vi } from 'vitest';
import { installWindowResize } from '../src/ui/resize';
import { WINDOW_LIMITS } from '../src/shared/window-size';

class Handle extends EventTarget {
  setPointerCapture = vi.fn();
  releasePointerCapture = vi.fn();
}
function setup(screen?: { availWidth: number; availHeight: number }) {
  const handle = new Handle();
  const host = Object.assign(new EventTarget(), { innerWidth: 380, innerHeight: 640, screen });
  const send = vi.fn();
  const dispose = installWindowResize(handle as unknown as HTMLElement, send, host as unknown as Window);
  const pointer = (target: EventTarget, type: string, extra: Record<string, unknown> = {}): void => {
    target.dispatchEvent(Object.assign(new Event(type, { cancelable: true }), {
      pointerId: 1, isPrimary: true, button: 0, screenX: 0, screenY: 0, clientX: 100, clientY: 100, ...extra,
    }));
  };
  return { handle, host, send, dispose, pointer };
}

describe('window resize interaction', () => {
  it('changes height when host screenY stays zero but clientY moves', () => {
    const { handle, host, send, pointer } = setup();
    pointer(handle, 'pointerdown', { screenX: 0, screenY: 0, clientX: 360, clientY: 620 });
    pointer(host, 'pointermove', { screenX: 0, screenY: 0, clientX: 360, clientY: 700 });
    expect(send).toHaveBeenLastCalledWith({ type: 'resize', width: 380, height: 720, finished: false });
  });
  it('keeps vertical drag independent of content scroll, horizontal screen movement and viewport feedback', () => {
    const { handle, host, send, pointer } = setup();
    pointer(handle, 'pointerdown', { clientX: 360, clientY: 620 });
    pointer(host, 'pointermove', { clientX: 360, clientY: 660, screenX: 900, pageY: 2000 });
    expect(send).toHaveBeenLastCalledWith({ type: 'resize', width: 380, height: 680, finished: false });
    host.innerHeight = 680;
    pointer(host, 'pointermove', { clientX: 360, clientY: 700, pageY: 5000 });
    expect(send).toHaveBeenLastCalledWith({ type: 'resize', width: 380, height: 720, finished: false });
    pointer(host, 'pointerup', { clientX: 0, clientY: 0 });
    expect(send).toHaveBeenLastCalledWith({ type: 'resize', width: 380, height: 720, finished: true });
  });
  it('reports available screen bounds at install/down and applies the reserved screen margins', () => {
    const { handle, host, send, pointer } = setup({ availWidth: 800, availHeight: 700 });
    expect(send).toHaveBeenLastCalledWith({ type: 'window-bounds', availableWidth: 800, availableHeight: 700 });
    pointer(handle, 'pointerdown');
    expect(send.mock.calls.filter(([message]) => message.type === 'window-bounds')).toHaveLength(2);
    pointer(host, 'pointermove', { clientX: 10000, clientY: 10000 });
    expect(send).toHaveBeenLastCalledWith({ type: 'resize', width: 768, height: 604, finished: false });
    pointer(host, 'pointerup');
    expect(send).toHaveBeenLastCalledWith({ type: 'resize', width: 768, height: 604, finished: true });
  });
  it('retains minimum usable dimensions on a very small screen', () => {
    const { handle, host, send, pointer } = setup({ availWidth: 200, availHeight: 200 });
    pointer(handle, 'pointerdown');
    pointer(host, 'pointermove', { clientX: 0, clientY: 0 });
    pointer(host, 'pointerup');
    expect(send).toHaveBeenLastCalledWith({ type: 'resize', width: 320, height: 300, finished: true });
  });
  it('uses normal limits if screen information is invalid or inaccessible', () => {
    for (const screen of [{ availWidth: NaN, availHeight: 700 }, { availWidth: 800, availHeight: 0 }]) {
      const { handle, host, send, pointer } = setup(screen);
      expect(send).not.toHaveBeenCalled();
      pointer(handle, 'pointerdown');
      pointer(host, 'pointermove', { clientX: 10000, clientY: 10000 });
      expect(send).toHaveBeenLastCalledWith({ type: 'resize', width: 900, height: WINDOW_LIMITS.maxHeight, finished: false });
    }
    const { handle, host, send, pointer } = setup();
    Object.defineProperty(host, 'screen', { get: () => { throw new Error('Screen unavailable'); } });
    pointer(handle, 'pointerdown');
    pointer(host, 'pointermove', { clientX: 120, clientY: 140 });
    expect(send).toHaveBeenLastCalledWith({ type: 'resize', width: 400, height: 680, finished: false });
  });
  it('uses initial viewport dimensions and client deltas even when host size changes mid-drag', () => {
    const { handle, host, send, pointer } = setup();
    pointer(handle, 'pointerdown');
    expect(handle.setPointerCapture).toHaveBeenCalledWith(1);
    pointer(host, 'pointermove', { clientX: 140, clientY: 160, screenX: -500 });
    expect(send).toHaveBeenLastCalledWith({ type: 'resize', width: 420, height: 700, finished: false });
    host.innerWidth = 420;
    host.innerHeight = 700;
    pointer(host, 'pointermove', { clientX: 150, clientY: 170 });
    expect(send).toHaveBeenLastCalledWith({ type: 'resize', width: 430, height: 710, finished: false });
    pointer(host, 'pointerup', { clientX: 0, clientY: 0 });
    expect(send).toHaveBeenLastCalledWith({ type: 'resize', width: 430, height: 710, finished: true });
    expect(handle.releasePointerCapture).toHaveBeenCalledWith(1);
  });
  it('clamps dimensions to both limits and rounds fractional pointer movement', () => {
    const { handle, host, send, pointer } = setup();
    pointer(handle, 'pointerdown');
    pointer(host, 'pointermove', { clientX: -10000, clientY: -10000 });
    expect(send).toHaveBeenLastCalledWith({ type: 'resize', width: 320, height: 300, finished: false });
    pointer(host, 'pointermove', { clientX: 10000, clientY: 10000 });
    expect(send).toHaveBeenLastCalledWith({ type: 'resize', width: 900, height: WINDOW_LIMITS.maxHeight, finished: false });
    pointer(host, 'pointermove', { clientX: 100.6, clientY: 100.4 });
    pointer(host, 'pointerup', { clientX: 0, clientY: 0 });
    expect(send).toHaveBeenLastCalledWith({ type: 'resize', width: 381, height: 640, finished: true });
  });
  for (const termination of ['pointerup', 'pointercancel', 'lostpointercapture', 'blur']) {
    it(`finalizes once and releases capture on ${termination}`, () => {
      const { handle, host, send, pointer } = setup();
      pointer(handle, 'pointerdown');
      pointer(host, 'pointermove', { clientX: 120, clientY: 130 });
      const target = termination === 'lostpointercapture' ? handle : host;
      pointer(target, termination, { clientX: 120, clientY: 130 });
      pointer(target, termination);
      pointer(host, 'pointercancel');
      pointer(host, 'pointermove', { clientX: 200 });
      expect(send.mock.calls.filter(([message]) => message.finished)).toEqual([[{ type: 'resize', width: 400, height: 670, finished: true }]]);
      expect(handle.releasePointerCapture).toHaveBeenCalledOnce();
    });
  }
  it('ignores secondary mouse/nonprimary pointers and mismatched move/up/cancel events', () => {
    const { handle, host, send, pointer } = setup();
    pointer(handle, 'pointerdown', { button: 2 });
    pointer(handle, 'pointerdown', { isPrimary: false });
    expect(handle.setPointerCapture).not.toHaveBeenCalled();
    pointer(handle, 'pointerdown');
    pointer(handle, 'pointerdown', { pointerId: 2 });
    for (const type of ['pointermove', 'pointerup', 'pointercancel']) pointer(host, type, { pointerId: 2, clientX: 200 });
    expect(send).not.toHaveBeenCalled();
    pointer(host, 'pointerup');
    expect(send).toHaveBeenCalledOnce();
  });
  it('starts repeated drags from the latest host dimensions and removes listeners on disposal', () => {
    const { handle, host, send, pointer, dispose } = setup();
    pointer(handle, 'pointerdown');
    pointer(host, 'pointermove', { clientX: 120, clientY: 130 });
    pointer(host, 'pointerup', { clientX: 120, clientY: 130 });
    host.innerWidth = 400;
    host.innerHeight = 670;
    pointer(handle, 'pointerdown');
    pointer(host, 'pointermove', { clientX: 150, clientY: 150 });
    dispose();
    expect(send).toHaveBeenLastCalledWith({ type: 'resize', width: 450, height: 720, finished: true });
    const count = send.mock.calls.length;
    pointer(handle, 'pointerdown');
    pointer(host, 'pointermove', { clientX: 180 });
    expect(send).toHaveBeenCalledTimes(count);
  });
  it('rejects nonfinite client positions and completes safely if pointer capture is unavailable', () => {
    const { handle, host, send, pointer } = setup();
    pointer(handle, 'pointerdown', { clientY: NaN });
    expect(handle.setPointerCapture).not.toHaveBeenCalled();
    pointer(handle, 'pointerdown');
    pointer(host, 'pointermove', { clientY: Infinity });
    expect(send).not.toHaveBeenCalled();
    pointer(host, 'pointercancel');
    send.mockClear();
    handle.setPointerCapture.mockImplementation(() => { throw new Error('Capture unavailable'); });
    pointer(handle, 'pointerdown');
    expect(send).toHaveBeenCalledExactlyOnceWith({ type: 'resize', width: 380, height: 640, finished: true });
    pointer(host, 'pointermove', { clientY: 200 });
    expect(send).toHaveBeenCalledOnce();
  });
  it('supports keyboard arrow resizing without preventing unrelated keyboard use', () => {
    const { handle, send } = setup();
    const key = new Event('keydown', { cancelable: true });
    handle.dispatchEvent(Object.assign(key, { key: 'ArrowRight', shiftKey: true }));
    expect(key.defaultPrevented).toBe(true);
    expect(send).toHaveBeenLastCalledWith({ type: 'resize', width: 430, height: 640, finished: true });
    const unrelated = new Event('keydown', { cancelable: true });
    handle.dispatchEvent(Object.assign(unrelated, { key: 'Enter', shiftKey: false }));
    expect(unrelated.defaultPrevented).toBe(false);
    expect(send).toHaveBeenCalledOnce();
  });
});
