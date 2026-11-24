import { captureTree, type CaptureTreeResult } from './adapter/tree';
import { parseTreeUIMessage, parseTreePluginMessage, sameTreeIdentity, TREE_LIMITS, type TreeIdentity, type TreePluginMessage } from './shared/tree';
import { normalizeNode } from './adapter/normalize';
import { inspectSpacing } from './adapter/spacing';
import { generateCSS } from './css/generate';
import type { InspectorState, PluginMessage } from './shared/contracts';
import { DEFAULT_WINDOW_SIZE, normalizeWindowSize } from './shared/window-size';
import type { WindowSize } from './shared/window-size';
import { DEFAULT_SECTIONS, parseSectionState } from './shared/sections';
import type { SectionState } from './shared/sections';
import { DEFAULT_STYLES_PROFILE, parseStylesProfile } from './styles/profile';
import type { StylesProfile, StylesRequest } from './shared/project-styles';
import { StylesSession, respondToStyles } from './styles/session';

declare const __html__: string;
figma.showUI(__html__, { ...DEFAULT_WINDOW_SIZE, themeColors: true });

const WINDOW_SIZE_KEY = 'design-inspector-window-size';
let userResized = false;
let availableScreen: WindowSize | undefined;
let currentWindowSize: WindowSize = { ...DEFAULT_WINDOW_SIZE };
let resizeErrorVisible = false;
let saveTimer: ReturnType<typeof setTimeout> | undefined;
// Serialize writes: a slow earlier save must never overwrite the final dimensions.
let saves: Promise<void> = Promise.resolve();
const STYLES_PROFILE_KEY = 'design-inspector-styles-profile-v1';
let stylesProfile: StylesProfile = { ...DEFAULT_STYLES_PROFILE, files: [] };
let stylesProfileChanged = false;
let profileSaves: Promise<void> = Promise.resolve();
const stylesProfileLoaded = figma.clientStorage.getAsync(STYLES_PROFILE_KEY).then((stored: unknown) => {
  if (!stylesProfileChanged) stylesProfile = parseStylesProfile(stored) ?? stylesProfile;
}).catch(() => { /* Local imports remain usable without persistent metadata. */ });
let fallbackStyles: StylesSession | undefined;
let queuedStyleRequests = 0;
const SECTIONS_KEY = 'design-inspector-sections';
let sections: SectionState = { ...DEFAULT_SECTIONS };
let sectionsChanged = false;
let sectionSaves: Promise<void> = Promise.resolve();
const sectionsLoaded = figma.clientStorage.getAsync(SECTIONS_KEY).then((stored: unknown) => {
  if (!sectionsChanged) sections = parseSectionState(stored) ?? { ...DEFAULT_SECTIONS };
}).catch(() => { /* Presentation defaults remain usable without storage. */ });
function saveWindowSize(size: WindowSize): void {
  saves = saves.then(() => figma.clientStorage.setAsync(WINDOW_SIZE_KEY, size)).catch(() => {
    // Storage is optional; resizing and inspection remain available when it fails.
  });
}

function resizeWindow(request: WindowSize): WindowSize | undefined {
  const size = normalizeWindowSize(request, availableScreen);
  if (!size) return undefined;
  try {
    figma.ui.resize(size.width, size.height);
    currentWindowSize = size;
    if (resizeErrorVisible) {
      figma.ui.postMessage({ type: 'resize-error', message: '' } satisfies PluginMessage);
      resizeErrorVisible = false;
    }
    return size;
  } catch {
    resizeErrorVisible = true;
    const message: PluginMessage = { type: 'resize-error', message: 'Figma could not resize this window. Try a smaller size or move the window away from the screen edge.' };
    figma.ui.postMessage(message);
    return undefined;
  }
}

void figma.clientStorage.getAsync(WINDOW_SIZE_KEY).then((stored: unknown) => {
  const size = normalizeWindowSize(stored, availableScreen);
  // A delayed storage read must not undo a resize already requested by the user.
  if (size && !userResized) resizeWindow(size);
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
    node.spacing = inspectSpacing(selected, node);
    send({ status: 'ready', node, css: generateCSS(node) });
  } catch (error) {
    send({ status: 'error', message: error instanceof Error ? error.message : 'Unable to inspect selection.' });
  }
}

// Tree transport is independent of the existing inspector and never recaptures
// automatically on edits. Main owns revision and lifecycle; adapter owns API data.
type TreePhase = 'running' | 'ready' | 'cancelled' | 'stale' | 'error';
type StaleReason = Extract<TreePluginMessage, { type: 'tree-stale' }>['reason'];
interface TreeOperation { identity: TreeIdentity; pageId: string; phase: TreePhase; progress: number }
const documentSessionId = `tree-${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`;
let treeRevision = 0;
let lastTreeRequestId = -1;
let activeTree: TreeOperation | undefined;
let pendingTreeStale: Extract<TreePluginMessage, { type: 'tree-stale' }> | undefined;
let treeStaleTimer: ReturnType<typeof setTimeout> | undefined;
function postTree(message: TreePluginMessage): boolean {
  if (!parseTreePluginMessage(message)) return false;
  try { figma.ui.postMessage(message satisfies PluginMessage); return true; } catch { return false; }
}
function flushTreeInvalidation(): void {
  clearTimeout(treeStaleTimer); treeStaleTimer = undefined;
  const message = pendingTreeStale; pendingTreeStale = undefined;
  if (message) postTree(message);
}
function invalidateTree(reason: StaleReason, coalesce = false): void {
  // Revoke synchronously, even if UI notification is coalesced. An async result
  // must never become ready in the gap before the queued stale notification.
  treeRevision++;
  if (activeTree && (activeTree.phase === 'running' || activeTree.phase === 'ready')) {
    activeTree.phase = 'stale';
    pendingTreeStale = { type: 'tree-stale', ...activeTree.identity, reason };
  }
  if (!coalesce) flushTreeInvalidation();
  else if (pendingTreeStale && treeStaleTimer === undefined) treeStaleTimer = setTimeout(flushTreeInvalidation, 0);
}
function treeStaleReason(operation: TreeOperation): StaleReason | undefined {
  if (activeTree !== operation) return 'replaced';
  try {
    if (figma.currentPage.id !== operation.pageId) return 'page';
    const selection = figma.currentPage.selection;
    if (selection.length !== 1 || selection[0]?.id !== operation.identity.rootId) return 'selection';
  } catch { return 'document'; }
  if (operation.phase === 'stale' || operation.identity.revision !== treeRevision) return 'document';
  return undefined;
}
function runningTree(operation: TreeOperation): boolean {
  if (activeTree !== operation || operation.phase !== 'running') return false;
  const reason = treeStaleReason(operation);
  if (reason) { invalidateTree(reason); return false; }
  return true;
}
function finishTree(operation: TreeOperation, result: CaptureTreeResult): void {
  if (!runningTree(operation)) return;
  if (result.status === 'stale') { invalidateTree('document'); return; }
  if (result.status === 'cancelled') {
    operation.phase = 'cancelled'; postTree({ type: 'tree-cancelled', ...operation.identity }); return;
  }
  if (result.status === 'ready') {
    const message = { type: 'tree-ready', ...operation.identity, snapshot: result.snapshot } as const;
    if (parseTreePluginMessage(message) && result.snapshot.sourceOrder.length >= operation.progress) {
      operation.phase = 'ready'; postTree(message); return;
    }
  }
  operation.phase = 'error';
  const message = result.status === 'error' ? result.message : 'Tree adapter returned an invalid or mismatched snapshot.';
  if (!postTree({ type: 'tree-error', ...operation.identity, message })) {
    postTree({ type: 'tree-error', ...operation.identity, message: 'Tree capture failed.' });
  }
}
function handleTreeMessage(value: unknown): void {
  const message = parseTreeUIMessage(value);
  if (!message) return;
  // A queued notification for a previous revision precedes any new command.
  flushTreeInvalidation();
  if (message.type === 'tree-cancel') {
    if (activeTree?.phase === 'running' && sameTreeIdentity(activeTree.identity, message)) {
      activeTree.phase = 'cancelled'; postTree({ type: 'tree-cancelled', ...activeTree.identity });
    }
    return;
  }
  // IDs are monotonic for this UI/plugin session. Replays cannot replace work.
  if (message.requestId <= lastTreeRequestId) return;
  lastTreeRequestId = message.requestId;
  invalidateTree('replaced');
  const identity: TreeIdentity = { requestId: message.requestId, documentSessionId, revision: treeRevision, rootId: message.rootId };
  try {
    const page = figma.currentPage, selection = page.selection;
    if (selection.length !== 1 || selection[0]?.id !== message.rootId) {
      postTree({ type: 'tree-error', ...identity, message: 'Select exactly one matching root on the current page.' }); return;
    }
    const root = selection[0];
    const operation: TreeOperation = { identity, pageId: page.id, phase: 'running', progress: -1 };
    activeTree = operation;
    if (!postTree({ type: 'tree-started', ...identity })) { operation.phase = 'error'; return; }
    // Defer the first chunk so immediate cancellation/replacement can prevent reads.
    void Promise.resolve().then(() => {
      if (!runningTree(operation)) return undefined;
      return captureTree(root, {
        identity, includeHidden: message.includeHidden,
        isStale: () => treeStaleReason(operation) !== undefined,
        isCancelled: () => operation.phase === 'cancelled',
        onProgress: processedNodes => {
          if (!runningTree(operation) || !Number.isSafeInteger(processedNodes) || processedNodes < 0
            || processedNodes > TREE_LIMITS.maxNodes || processedNodes <= operation.progress) return;
          if (postTree({ type: 'tree-progress', ...identity, processedNodes })) operation.progress = processedNodes;
        },
      });
    }).then(result => { if (result) finishTree(operation, result); }).catch(() => {
      finishTree(operation, { status: 'error', message: 'Tree capture failed. Refresh the selection and try again.' });
    });
  } catch { postTree({ type: 'tree-error', ...identity, message: 'Current page or selection is unavailable.' }); }
}

figma.ui.onmessage = (message: unknown) => {
  if (!message || typeof message !== 'object' || !('type' in message)) return;
  const transportType: unknown = Object.getOwnPropertyDescriptor(message, 'type')?.value;
  if (typeof transportType !== 'string') return;
  if (transportType === 'tree-inspect' || transportType === 'tree-cancel') { handleTreeMessage(message); return; }
  if (message.type === 'refresh') invalidateTree('refresh');
  if (message.type === 'ready' || message.type === 'refresh') inspect();
  if (message.type === 'styles-profile-ready') {
    void stylesProfileLoaded.then(() => figma.ui.postMessage({ type: 'styles-profile', profile: stylesProfile } satisfies PluginMessage));
  }
  if (message.type === 'save-styles-profile' && 'profile' in message) {
    const profile = parseStylesProfile(message.profile);
    if (!profile) return;
    stylesProfile = profile;
    stylesProfileChanged = true;
    profileSaves = profileSaves.then(() => figma.clientStorage.setAsync(STYLES_PROFILE_KEY, profile)).catch(() => { /* CSS is not stored. */ });
  }
  if (message.type === 'styles-request' && 'request' in message && message.request && typeof message.request === 'object') {
    const request = message.request as StylesRequest;
    if (!Number.isSafeInteger(request.id) || !request.command || typeof request.command !== 'object') return;
    if (queuedStyleRequests >= 16) {
      figma.ui.postMessage({ type: 'styles-reply', reply: { id: request.id, error: 'CSS analysis is busy. Try again shortly.' } } satisfies PluginMessage);
      return;
    }
    queuedStyleRequests++;
    // Fallback runs in the plugin sandbox, never by synchronous parsing inside the UI iframe.
    setTimeout(() => {
      queuedStyleRequests--;
      try {
        fallbackStyles ??= new StylesSession();
        figma.ui.postMessage({ type: 'styles-reply', reply: respondToStyles(fallbackStyles, request) } satisfies PluginMessage);
      } catch {
        figma.ui.postMessage({ type: 'styles-reply', reply: { id: request.id, error: 'CSS analysis failed. Try a smaller file.' } } satisfies PluginMessage);
      }
    }, 0);
  }
  if (message.type === 'sections-ready') {
    void sectionsLoaded.then(() => {
      figma.ui.postMessage({ type: 'section-state', sections: { ...sections } } satisfies PluginMessage);
    });
  }
  if (message.type === 'set-sections' && 'sections' in message) {
    const state = parseSectionState(message.sections);
    if (!state) return;
    sectionsChanged = true;
    sections = state;
    sectionSaves = sectionSaves.then(() => figma.clientStorage.setAsync(SECTIONS_KEY, state)).catch(() => {
      // A rejected preferences write must not break copying, inspection or resizing.
    });
  }
  if (message.type === 'window-bounds' && 'availableWidth' in message && 'availableHeight' in message) {
    const width = message.availableWidth, height = message.availableHeight;
    if (typeof width !== 'number' || typeof height !== 'number' || !Number.isFinite(width) || !Number.isFinite(height) || width <= 0 || height <= 0) return;
    availableScreen = { width, height };
    const limited = normalizeWindowSize(currentWindowSize, availableScreen);
    if (limited && (limited.width !== currentWindowSize.width || limited.height !== currentWindowSize.height)) {
      clearTimeout(saveTimer);
      const size = resizeWindow(limited);
      if (size && userResized) saveWindowSize(size);
    }
  }
  if (message.type === 'resize' && 'finished' in message && typeof message.finished === 'boolean') {
    const request = normalizeWindowSize(message, availableScreen);
    if (!request) return;
    userResized = true;
    clearTimeout(saveTimer);
    const size = resizeWindow(request);
    if (!size) return;
    if (message.finished) saveWindowSize(size);
    else saveTimer = setTimeout(() => saveWindowSize(size), 400);
  }
};
figma.on('selectionchange', () => { invalidateTree('selection', true); inspect(); });
let observedPage = figma.currentPage;
const pageChanged = (): void => { invalidateTree('document', true); inspect(); };
observedPage.on('nodechange', pageChanged);
figma.on('currentpagechange', () => {
  invalidateTree('page', true);
  observedPage.off('nodechange', pageChanged);
  observedPage = figma.currentPage;
  observedPage.on('nodechange', pageChanged);
  inspect();
});
figma.on('close', () => {
  clearTimeout(treeStaleTimer); treeStaleTimer = undefined; pendingTreeStale = undefined;
  if (activeTree) activeTree.phase = 'cancelled';
  activeTree = undefined;
});
inspect();
