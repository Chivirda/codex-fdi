import { describe, expect, it, vi } from 'vitest';
import { installWindowResize } from '../src/ui/resize';

class Handle extends EventTarget {
  setPointerCapture = vi.fn();
  releasePointerCapture = vi.fn();
}
function setup() {
  const handle = new Handle();
  const host = Object.assign(new EventTarget(), { innerWidth: 380, innerHeight: 640 });
  const send = vi.fn();
  const dispose = installWindowResize(handle as unknown as HTMLElement, send, host as unknown as Window);
  const pointer = (target: EventTarget, type: string, extra: Record<string, unknown> = {}): void => {
    target.dispatchEvent(Object.assign(new Event(type, { cancelable: true }), {
      pointerId: 1, isPrimary: true, button: 0, screenX: 100, screenY: 100, ...extra,
    }));
  };
  return { handle, host, send, dispose, pointer };
}

describe('window resize interaction', () => {
  it('uses initial viewport dimensions and screen deltas even when host size changes mid-drag', () => {
    const { handle, host, send, pointer } = setup();
    pointer(handle, 'pointerdown');
    expect(handle.setPointerCapture).toHaveBeenCalledWith(1);
    pointer(host, 'pointermove', { screenX: 140, screenY: 160, clientX: -500 });
    expect(send).toHaveBeenLastCalledWith({ type: 'resize', width: 420, height: 700, finished: false });
    host.innerWidth = 420;
    host.innerHeight = 700;
    pointer(host, 'pointermove', { screenX: 150, screenY: 170 });
    expect(send).toHaveBeenLastCalledWith({ type: 'resize', width: 430, height: 710, finished: false });
    pointer(host, 'pointerup', { screenX: 155, screenY: 175 });
    expect(send).toHaveBeenLastCalledWith({ type: 'resize', width: 435, height: 715, finished: true });
    expect(handle.releasePointerCapture).toHaveBeenCalledWith(1);
  });
  it('clamps dimensions to both limits and rounds fractional pointer movement', () => {
    const { handle, host, send, pointer } = setup();
    pointer(handle, 'pointerdown');
    pointer(host, 'pointermove', { screenX: -10000, screenY: -10000 });
    expect(send).toHaveBeenLastCalledWith({ type: 'resize', width: 320, height: 400, finished: false });
    pointer(host, 'pointermove', { screenX: 10000, screenY: 10000 });
    expect(send).toHaveBeenLastCalledWith({ type: 'resize', width: 900, height: 1000, finished: false });
    pointer(host, 'pointerup', { screenX: 100.6, screenY: 100.4 });
    expect(send).toHaveBeenLastCalledWith({ type: 'resize', width: 381, height: 640, finished: true });
  });
  for (const termination of ['pointerup', 'pointercancel', 'lostpointercapture', 'blur']) {
    it(`finalizes once and releases capture on ${termination}`, () => {
      const { handle, host, send, pointer } = setup();
      pointer(handle, 'pointerdown');
      pointer(host, 'pointermove', { screenX: 120, screenY: 130 });
      const target = termination === 'lostpointercapture' ? handle : host;
      pointer(target, termination, { screenX: 120, screenY: 130 });
      pointer(target, termination);
      pointer(host, 'pointercancel');
      pointer(host, 'pointermove', { screenX: 200 });
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
    for (const type of ['pointermove', 'pointerup', 'pointercancel']) pointer(host, type, { pointerId: 2, screenX: 200 });
    expect(send).not.toHaveBeenCalled();
    pointer(host, 'pointerup');
    expect(send).toHaveBeenCalledOnce();
  });
  it('starts repeated drags from the latest host dimensions and removes listeners on disposal', () => {
    const { handle, host, send, pointer, dispose } = setup();
    pointer(handle, 'pointerdown');
    pointer(host, 'pointerup', { screenX: 120, screenY: 130 });
    host.innerWidth = 400;
    host.innerHeight = 670;
    pointer(handle, 'pointerdown');
    pointer(host, 'pointermove', { screenX: 150, screenY: 150 });
    dispose();
    expect(send).toHaveBeenLastCalledWith({ type: 'resize', width: 450, height: 720, finished: true });
    const count = send.mock.calls.length;
    pointer(handle, 'pointerdown');
    pointer(host, 'pointermove', { screenX: 180 });
    expect(send).toHaveBeenCalledTimes(count);
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
