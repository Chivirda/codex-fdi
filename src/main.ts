import { normalizeNode } from './adapter/normalize';
import { generateCSS } from './css/generate';
import type { InspectorState, PluginMessage } from './shared/contracts';

declare const __html__: string;
figma.showUI(__html__, { width: 380, height: 640, themeColors: true });

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
