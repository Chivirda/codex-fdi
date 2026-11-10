import { normalizeNode } from './adapter/normalize';
import { generateCSS } from './css/generate';
import type { InspectorState, PluginMessage } from './shared/contracts';
import { DEFAULT_WINDOW_SIZE, normalizeWindowSize } from './shared/window-size';
import type { WindowSize } from './shared/window-size';

declare const __html__: string;
figma.showUI(__html__, { ...DEFAULT_WINDOW_SIZE, themeColors: true });

const WINDOW_SIZE_KEY = 'design-inspector-window-size';
let userResized = false;
let saveTimer: ReturnType<typeof setTimeout> | undefined;
// Serialize writes: a slow earlier save must never overwrite the final dimensions.
let saves: Promise<void> = Promise.resolve();
function saveWindowSize(size: WindowSize): void {
  saves = saves.then(() => figma.clientStorage.setAsync(WINDOW_SIZE_KEY, size)).catch(() => {
    // Storage is optional; resizing and inspection remain available when it fails.
  });
}

void figma.clientStorage.getAsync(WINDOW_SIZE_KEY).then((stored: unknown) => {
  const size = normalizeWindowSize(stored);
  // A delayed storage read must not undo a resize already requested by the user.
  if (size && !userResized) figma.ui.resize(size.width, size.height);
}).catch(() => { /* Keep the default size when storage is unavailable. */ });

function send(state: InspectorState): void {
  const message: PluginMessage = { type: 'inspector-state', state };
  figma.ui.postMessage(message);
}

function inspect(): void {
  try {
    const selection = figma.currentPage.selection;
    if (selection.length === 0) return send({ status: 'empty' });
    if (selection.length > 1) return send({ status: 'multiple', count: selection.length });
    const selected = selection[0];
    if (!selected) return send({ status: 'empty' });
    const node = normalizeNode(selected);
    send({ status: 'ready', node, css: generateCSS(node) });
  } catch (error) {
    send({ status: 'error', message: error instanceof Error ? error.message : 'Unable to inspect selection.' });
  }
}

figma.ui.onmessage = (message: unknown) => {
  if (!message || typeof message !== 'object' || !('type' in message)) return;
  if (message.type === 'ready' || message.type === 'refresh') inspect();
  if (message.type === 'resize' && 'finished' in message && typeof message.finished === 'boolean') {
    const size = normalizeWindowSize(message);
    if (!size) return;
    userResized = true;
    figma.ui.resize(size.width, size.height);
    clearTimeout(saveTimer);
    if (message.finished) saveWindowSize(size);
    else saveTimer = setTimeout(() => saveWindowSize(size), 400);
  }
};
figma.on('selectionchange', inspect);
let observedPage = figma.currentPage;
observedPage.on('nodechange', inspect);
figma.on('currentpagechange', () => {
  observedPage.off('nodechange', inspect);
  observedPage = figma.currentPage;
  observedPage.on('nodechange', inspect);
  inspect();
});
inspect();
