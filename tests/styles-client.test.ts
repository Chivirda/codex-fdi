import { afterEach, describe, expect, it, vi } from 'vitest';
import { createStylesClient } from '../src/styles/client';
import type { UIMessage } from '../src/shared/contracts';

afterEach(() => { vi.unstubAllGlobals(); vi.useRealTimers(); });
const response = { snapshot: { files: [], classes: 0, variables: 0, rules: 0, warnings: [] } };
describe('worker transport and Figma fallback', () => {
  it('uses host transport when Blob workers are unavailable', async () => {
    vi.stubGlobal('Worker', undefined);
    const messages: UIMessage[] = [];
    const client = createStylesClient(message => { messages.push(message); });
    const result = client.request({ type: 'refresh' });
    await Promise.resolve(); await Promise.resolve();
    const request = messages[0];
    expect(request?.type).toBe('styles-request');
    if (request?.type !== 'styles-request') throw new Error('Missing fallback request');
    client.receive({ id: request.request.id, response });
    expect(await result).toEqual(response);
  });
  it('uses only static worker source and correlates success/error responses', async () => {
    let instance: FakeWorker | undefined;
    class FakeWorker {
      onmessage?: (event: { data: unknown }) => void;
      onerror?: () => void;
      terminate = vi.fn();
      postMessage = vi.fn((request: { id: number }) => {
        this.onmessage?.({ data: request.id === 1 ? { id: request.id, response } : { id: request.id, error: 'Invalid CSS' } });
      });
      constructor() { instance = this; queueMicrotask(() => this.onmessage?.({ data: { type: 'ready' } })); }
    }
    vi.stubGlobal('__STYLES_WORKER_SOURCE__', '/* bundled static parser */');
    vi.stubGlobal('Worker', FakeWorker);
    const send = vi.fn();
    const client = createStylesClient(send);
    expect(await client.request({ type: 'refresh' })).toEqual(response);
    await expect(client.request({ type: 'import', id: 'bad', name: 'bad.css', css: 'arbitrary css' })).rejects.toThrow('Invalid CSS');
    expect(instance?.postMessage).toHaveBeenCalledTimes(2);
    expect(send).not.toHaveBeenCalled();
  });
  it('falls back after a blocked worker readiness handshake', async () => {
    vi.useFakeTimers();
    const terminate = vi.fn();
    class SilentWorker { terminate = terminate; }
    vi.stubGlobal('__STYLES_WORKER_SOURCE__', '/* static */');
    vi.stubGlobal('Worker', SilentWorker);
    const send = vi.fn();
    const client = createStylesClient(send);
    const result = client.request({ type: 'refresh' });
    await vi.advanceTimersByTimeAsync(1500);
    expect(terminate).toHaveBeenCalled();
    const message = send.mock.calls[0]?.[0] as UIMessage;
    if (message.type !== 'styles-request') throw new Error('No fallback');
    client.receive({ id: message.request.id, response });
    await expect(result).resolves.toEqual(response);
  });
  it('invalidates a timed-out session and cannot be revived by a late import reply', async () => {
    vi.useFakeTimers();
    vi.stubGlobal('Worker', undefined);
    const send = vi.fn();
    const client = createStylesClient(send);
    const operation = client.request({ type: 'refresh' });
    const rejected = expect(operation).rejects.toThrow('timed out');
    await vi.advanceTimersByTimeAsync(20000);
    await rejected;
    const message = send.mock.calls[0]?.[0] as UIMessage;
    if (message.type !== 'styles-request') throw new Error('No fallback');
    client.receive({ id: message.request.id, response });
    await expect(client.request({ type: 'refresh' })).rejects.toThrow('Reopen');
    expect(send).toHaveBeenCalledOnce();
  });
  it('rejects pending work after a live worker error without silently switching to an empty session', async () => {
    let instance: FailingWorker | undefined;
    class FailingWorker {
      onmessage?: (event: { data: unknown }) => void;
      onerror?: () => void;
      postMessage = vi.fn();
      terminate = vi.fn();
      constructor() { instance = this; queueMicrotask(() => this.onmessage?.({ data: { type: 'ready' } })); }
    }
    vi.stubGlobal('__STYLES_WORKER_SOURCE__', '/* static */');
    vi.stubGlobal('Worker', FailingWorker);
    const send = vi.fn();
    const client = createStylesClient(send);
    const operation = client.request({ type: 'refresh' });
    const rejected = expect(operation).rejects.toThrow('worker stopped');
    await Promise.resolve(); await Promise.resolve(); await Promise.resolve();
    instance?.onerror?.();
    await rejected;
    expect(instance?.terminate).toHaveBeenCalled();
    await expect(client.request({ type: 'refresh' })).rejects.toThrow('Reopen');
    expect(send).not.toHaveBeenCalled();
  });
});
