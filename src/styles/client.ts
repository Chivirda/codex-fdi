import type { UIMessage } from '../shared/contracts';
import type { StylesCommand, StylesReply, StylesRequest, StylesResponse } from '../shared/project-styles';

declare const __STYLES_WORKER_SOURCE__: string;
export interface StylesClient { request(command: StylesCommand): Promise<StylesResponse> }

/** Worker first; use the plugin sandbox transport if Blob Workers are blocked by Figma CSP. */
export function createStylesClient(send: (message: UIMessage) => void): StylesClient & { receive(reply: StylesReply): void } {
  let nextId = 0;
  let worker: Worker | undefined;
  let workerReady: Promise<boolean> | undefined;
  let workerUsed = false;
  let broken = false;
  const pending = new Map<number, { resolve: (value: StylesResponse) => void; reject: (error: Error) => void; timer: ReturnType<typeof setTimeout> }>();
  const receive = (reply: StylesReply): void => {
    const entry = pending.get(reply.id);
    if (!entry) return;
    pending.delete(reply.id);
    clearTimeout(entry.timer);
    if ('error' in reply) entry.reject(new Error(reply.error));
    else entry.resolve(reply.response);
  };
  const start = (): Promise<boolean> => {
    if (workerReady) return workerReady;
    workerReady = new Promise(resolve => {
      let done = false;
      let url: string | undefined;
      const finish = (ready: boolean): void => {
        if (done) return;
        done = true;
        clearTimeout(timer);
        if (url) URL.revokeObjectURL(url);
        if (!ready) { worker?.terminate(); worker = undefined; }
        resolve(ready);
      };
      const timer = setTimeout(() => finish(false), 1500);
      try {
        url = URL.createObjectURL(new Blob([__STYLES_WORKER_SOURCE__], { type: 'text/javascript' }));
        worker = new Worker(url);
        worker.onmessage = (event: MessageEvent<StylesReply | { type: 'ready' }>) => {
          if ('type' in event.data && event.data.type === 'ready') finish(true);
          else if ('id' in event.data) receive(event.data);
        };
        worker.onerror = () => {
          if (!done) finish(false);
          else {
            broken = true;
            worker?.terminate();
            for (const [id] of pending) receive({ id, error: 'CSS worker stopped. Reopen Project Styles and reimport your files.' });
          }
        };
      } catch { finish(false); }
    });
    return workerReady;
  };
  return {
    receive,
    async request(command): Promise<StylesResponse> {
      if (broken) throw new Error('CSS worker stopped. Reopen the plugin and reimport CSS.');
      const useWorker = await start();
      if (broken || (!useWorker && workerUsed)) throw new Error('CSS session ended. Reopen the plugin and reimport CSS.');
      return new Promise((resolve, reject) => {
        const id = ++nextId;
        const timer = setTimeout(() => {
          // Never continue with a session whose timed-out import may have applied invisibly.
          broken = true;
          worker?.terminate();
          for (const pendingId of [...pending.keys()]) receive({ id: pendingId, error: 'CSS analysis timed out. Reopen the plugin and reimport a smaller file.' });
        }, 20000);
        pending.set(id, { resolve, reject, timer });
        const request: StylesRequest = { id, command };
        try {
          if (useWorker && worker) { workerUsed = true; worker.postMessage(request); }
          else send({ type: 'styles-request', request });
        } catch {
          receive({ id, error: 'Could not send the CSS analysis request. Reopen the plugin and try again.' });
        }
      });
    },
  };
}
