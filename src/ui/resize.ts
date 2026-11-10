import type { UIMessage } from '../shared/contracts';
import { normalizeWindowSize, type WindowSize } from '../shared/window-size';

type ResizeHost = Pick<Window, 'innerWidth' | 'innerHeight' | 'addEventListener' | 'removeEventListener'>
  & { readonly screen?: Pick<Screen, 'availWidth' | 'availHeight'> };
interface Drag { pointerId: number; x: number; y: number; start: WindowSize; size: WindowSize }

/** Resize requests stay in the UI transport; only the plugin host can resize Figma's panel. */
export function installWindowResize(handle: HTMLElement, send: (message: UIMessage) => void, host: ResizeHost = window): () => void {
  let drag: Drag | undefined;
  let available: WindowSize | undefined;
  const readBounds = (): void => {
    // Some iframe hosts omit Screen or restrict its getters. Bounds are optional.
    try {
      const width = host.screen?.availWidth, height = host.screen?.availHeight;
      if (typeof width !== 'number' || typeof height !== 'number'
        || !Number.isFinite(width) || !Number.isFinite(height) || width <= 0 || height <= 0) return;
      available = { width, height };
      send({ type: 'window-bounds', availableWidth: width, availableHeight: height });
    } catch { /* Keep resizing available without screen information. */ }
  };
  const emit = (size: WindowSize, finished: boolean): void => send({ type: 'resize', ...size, finished });
  // Measure against the drag-start viewport rather than host Screen API relays.
  // Client coordinates are independent of content scrolling inside that viewport.
  const sizeAt = (event: PointerEvent, current: Drag): WindowSize | undefined => normalizeWindowSize({
    width: current.start.width + event.clientX - current.x,
    height: current.start.height + event.clientY - current.y,
  }, available);
  const finish = (): void => {
    if (!drag) return;
    const current = drag;
    drag = undefined; // releasePointerCapture can synchronously trigger lostpointercapture.
    try { handle.releasePointerCapture(current.pointerId); } catch { /* Already released by browser. */ }
    emit(current.size, true);
  };
  const down = (event: PointerEvent): void => {
    if (drag || !event.isPrimary || event.button !== 0 || !Number.isFinite(event.clientX) || !Number.isFinite(event.clientY)) return;
    readBounds();
    const start = { width: host.innerWidth, height: host.innerHeight };
    const size = normalizeWindowSize(start, available);
    if (!size || start.width <= 0 || start.height <= 0) return;
    event.preventDefault();
    drag = { pointerId: event.pointerId, x: event.clientX, y: event.clientY, start, size };
    try { handle.setPointerCapture(event.pointerId); } catch { finish(); }
  };
  const move = (event: PointerEvent): void => {
    if (!drag || event.pointerId !== drag.pointerId) return;
    const size = sizeAt(event, drag);
    if (!size) return;
    event.preventDefault();
    if (size.width === drag.size.width && size.height === drag.size.height) return;
    drag.size = size;
    emit(size, false);
  };
  const up = (event: PointerEvent): void => {
    if (!drag || event.pointerId !== drag.pointerId) return;
    // Persist the last measured move; relayed/synthetic termination coordinates may be zero.
    finish();
  };
  const cancel = (event: PointerEvent): void => { if (drag?.pointerId === event.pointerId) finish(); };
  const key = (event: KeyboardEvent): void => {
    if (drag) return;
    const step = event.shiftKey ? 50 : 10;
    const delta: Record<string, [number, number]> = { ArrowRight: [step, 0], ArrowLeft: [-step, 0], ArrowDown: [0, step], ArrowUp: [0, -step] };
    const change = delta[event.key];
    if (!change) return;
    readBounds();
    const size = normalizeWindowSize({ width: host.innerWidth + change[0], height: host.innerHeight + change[1] }, available);
    if (!size) return;
    event.preventDefault();
    emit(size, true);
  };
  readBounds();
  handle.addEventListener('pointerdown', down);
  handle.addEventListener('lostpointercapture', cancel);
  handle.addEventListener('keydown', key);
  host.addEventListener('pointermove', move);
  host.addEventListener('pointerup', up);
  host.addEventListener('pointercancel', cancel);
  host.addEventListener('blur', finish);
  return () => {
    finish();
    handle.removeEventListener('pointerdown', down);
    handle.removeEventListener('lostpointercapture', cancel);
    handle.removeEventListener('keydown', key);
    host.removeEventListener('pointermove', move);
    host.removeEventListener('pointerup', up);
    host.removeEventListener('pointercancel', cancel);
    host.removeEventListener('blur', finish);
  };
}
