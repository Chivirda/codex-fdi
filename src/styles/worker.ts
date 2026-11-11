import type { StylesRequest } from '../shared/project-styles';
import { StylesSession, respondToStyles } from './session';

const session = new StylesSession();
const scope = globalThis as unknown as { onmessage: (event: MessageEvent<StylesRequest>) => void; postMessage: (value: unknown) => void };
scope.onmessage = (event) => {
  if (!event.data || typeof event.data.id !== 'number') return;
  scope.postMessage(respondToStyles(session, event.data));
};
scope.postMessage({ type: 'ready' });
