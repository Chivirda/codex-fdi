import { normalizeNode } from './normalize';
import { isStableTransform, parentLocalTransform } from '../geometry/spacing';
import type { Matrix } from '../shared/spacing';
import { TREE_LIMITS, parseTreePluginMessage, type TreeIdentity, type TreeSnapshot, type TreeNode, type TreeDiagnostic } from '../shared/tree';

export interface CaptureTreeOptions {
  identity: TreeIdentity; includeHidden: boolean;
  /** Main must invalidate on selection/page/nodechange, including external ancestors. */
  isStale(): boolean; isCancelled(): boolean;
  onProgress?(processedNodes: number): void;
  /** Scheduler/clock injection for deterministic tests; defaults yield to host events. */
  yieldControl?(): Promise<void>; now?(): number;
}
export type CaptureTreeResult = { status: 'ready'; snapshot: TreeSnapshot }
  | { status: 'cancelled' | 'stale' } | { status: 'error'; message: string };
type LimitReason = 'node-limit' | 'depth-limit' | 'time-limit' | 'byte-limit' | 'string-limit';
interface Frame { source: SceneNode; node: TreeNode; children: readonly SceneNode[]; next: number; depth: number }
interface Cost { bytes: number; strings: number; work: number; long: boolean }
const containers = new Set(['FRAME', 'GROUP', 'COMPONENT', 'INSTANCE', 'COMPONENT_SET', 'SECTION', 'BOOLEAN_OPERATION']);
const leaves = new Set(['TEXT', 'RECTANGLE']);
const safeId = (value: unknown): value is string => typeof value === 'string' && value.length > 0 && value.length <= 255
  && !['__proto__', 'constructor', 'prototype'].includes(value);
const bytes = (value: string): number => {
  let total = 0;
  for (const char of value) { const code = char.codePointAt(0)!; total += code <= 127 ? 1 : code <= 2047 ? 2 : code <= 65535 ? 3 : 4; }
  return total;
};
/** Only call on freshly captured plain data; never enumerate a Figma node. */
function cost(value: unknown): Cost {
  const pending = [value]; let work = 0, strings = 0, long = false;
  while (pending.length) {
    const item = pending.pop(); work++;
    if (typeof item === 'string') { strings += item.length; long ||= item.length > TREE_LIMITS.maxStringLength; }
    else if (item && typeof item === 'object') for (const [key, child] of Object.entries(item)) { strings += key.length; pending.push(child); }
  }
  return { bytes: long ? 0 : bytes(JSON.stringify(value)), strings, work, long };
}
const cloneMatrix = (value: Matrix): Matrix => [[...value[0]], [...value[1]]];

/** Read-only iterative DFS. No Figma globals, component resolution, detach or document scan.
 * A ready result is still revision-scoped: main must recheck before publishing. */
export async function captureTree(root: SceneNode, options: CaptureTreeOptions): Promise<CaptureTreeResult> {
  const { identity, includeHidden } = options;
  if (!parseTreePluginMessage({ type: 'tree-started', ...identity }) || typeof includeHidden !== 'boolean') return { status: 'error', message: 'Invalid tree capture request.' };
  const now = options.now ?? Date.now;
  const yieldControl = options.yieldControl ?? (() => new Promise<void>(resolve => setTimeout(resolve, 0)));
  const start = now();
  let chunkStart = start, chunkCount = 0;
  const snapshot: TreeSnapshot = { ...identity, schemaVersion: 1, includeHidden,
    nodes: Object.create(null) as Record<string, TreeNode>, sourceOrder: [], completeness: 'complete', limits: { ...TREE_LIMITS }, diagnostics: [] };
  const stack: Frame[] = [];
  let used = cost(snapshot);
  const diagnostic = (nodeId: string, code: TreeDiagnostic['code'], message: string): TreeDiagnostic => ({
    nodeId, code, message, severity: code === 'HIDDEN_BRANCH_UNREAD' ? 'info' : 'warning', revision: identity.revision,
  });
  const state = (): 'cancelled' | 'stale' | undefined => options.isStale() ? 'stale' : options.isCancelled() ? 'cancelled' : undefined;
  const markPending = (reason: LimitReason): void => {
    for (const frame of stack) if (frame.next < frame.children.length) {
      frame.node.branch = { status: 'truncated', reason, omittedChildren: frame.children.length - frame.next };
      snapshot.diagnostics.push(diagnostic(frame.node.id, 'TREE_TRUNCATED', `Remaining children were not captured: ${reason}.`));
    }
    stack.length = 0;
  };
  const readNode = (source: SceneNode, parent: Frame | undefined, depth: number): { node: TreeNode; children: readonly SceneNode[]; diagnostics: TreeDiagnostic[] } => {
    const id = source.id;
    if (!safeId(id) || Object.prototype.hasOwnProperty.call(snapshot.nodes, id)) throw new Error('A source node identity is invalid or duplicated. Refresh the selection.');
    const node: TreeNode = { id, parentId: parent?.node.id ?? null, childIds: [], branch: { status: 'complete' } };
    let children: readonly SceneNode[] = [];
    const diagnostics: TreeDiagnostic[] = [];
    const fail = (): void => {
      node.branch = { status: 'omitted', reason: 'unavailable', omittedChildren: null };
      diagnostics.push(diagnostic(id, 'NODE_UNAVAILABLE', 'Node properties or children are unavailable.'));
    };
    // Hidden branch contents (including the children getter) must stay unread.
    try { if (typeof source.visible === 'boolean') node.visible = source.visible; } catch { /* Unknown visibility is not false. */ }
    try { if (typeof source.locked === 'boolean') node.locked = source.locked; } catch { /* Unknown lock state is omitted. */ }
    if (node.visible === false && !includeHidden) {
      node.branch = { status: 'omitted', reason: 'hidden', omittedChildren: null };
      diagnostics.push(diagnostic(id, 'HIDDEN_BRANCH_UNREAD', 'Hidden branch was not loaded.'));
      return { node, children, diagnostics };
    }
    try {
      if (source.removed) { fail(); return { node, children, diagnostics }; }
      node.inspector = normalizeNode(source);
      const mask = 'isMask' in source && source.isMask === true;
      if (mask) {
        node.branch = { status: 'unsupported', reason: 'mask', omittedChildren: null };
        diagnostics.push(diagnostic(id, 'NODE_UNSUPPORTED', 'Mask composition is not interpreted.'));
      } else if (containers.has(source.type)) {
        const value = (source as SceneNode & { children: readonly SceneNode[] }).children;
        if (!Array.isArray(value)) { fail(); return { node, children, diagnostics }; }
        children = value;
        if (['GROUP', 'BOOLEAN_OPERATION', 'COMPONENT_SET'].includes(source.type)) node.inspector.warnings.push('This source hierarchy/composition is preserved; it does not establish an ordinary CSS container.');
      } else if (!leaves.has(source.type)) {
        node.branch = { status: 'unsupported', reason: 'unsupported-node-type', omittedChildren: null };
        diagnostics.push(diagnostic(id, 'NODE_UNSUPPORTED', 'Unsupported source node retained as a placeholder.'));
      }
      try {
        const absolute = source.absoluteTransform;
        if (!isStableTransform(absolute)) throw new Error('unstable');
        node.geometry = { absoluteTransform: cloneMatrix(absolute) };
        if (parent) {
          const parentAbsolute = parent.node.geometry?.absoluteTransform;
          const local = parentAbsolute && parentLocalTransform(absolute, parentAbsolute);
          if (!local) throw new Error('parent geometry unavailable');
          node.geometry.parentLocalTransform = local;
        }
      } catch {
        // Source absolute transform may still be valid, even if local geometry is not.
        diagnostics.push(diagnostic(id, 'GEOMETRY_UNSTABLE', 'Reliable parent-local geometry is unavailable; no derived coordinates were invented.'));
      }
      if (depth === TREE_LIMITS.maxDepth && children.length) {
        node.branch = { status: 'truncated', reason: 'depth-limit', omittedChildren: children.length };
        diagnostics.push(diagnostic(id, 'TREE_TRUNCATED', 'Descendants exceed the depth budget.')); children = [];
      }
    } catch { delete node.inspector; delete node.geometry; children = []; fail(); }
    return { node, children, diagnostics };
  };
  const add = (source: SceneNode, parent: Frame | undefined, depth: number): LimitReason | undefined => {
    const entry = readNode(source, parent, depth);
    let measured = cost({ node: entry.node, diagnostics: entry.diagnostics });
    if (measured.long) {
      // A property limit is explicit; do not truncate original text or fabricate a name.
      const omittedChildren = entry.node.branch.status === 'complete' ? entry.children.length : entry.node.branch.omittedChildren;
      delete entry.node.inspector; delete entry.node.geometry;
      if (entry.node.branch.status !== 'omitted' || entry.node.branch.reason !== 'hidden') entry.node.branch = { status: 'truncated', reason: 'string-limit', omittedChildren };
      entry.children = [];
      entry.diagnostics = [diagnostic(entry.node.id, entry.node.branch.status === 'omitted' ? 'HIDDEN_BRANCH_UNREAD' : 'TREE_TRUNCATED', 'Source data exceeds the per-string budget; properties and descendants were not loaded.')];
      measured = cost({ node: entry.node, diagnostics: entry.diagnostics });
    }
    // Reserve space/work for <=65 pending-ancestor truncation diagnostics and envelope.
    const extraId = bytes(JSON.stringify(entry.node.id));
    const proposed = { bytes: used.bytes + measured.bytes + extraId * 4 + 128,
      strings: used.strings + measured.strings + entry.node.id.length * 4 + 128,
      work: used.work + measured.work + 32, long: false };
    if (proposed.strings > TREE_LIMITS.maxStringUnits - 32768) return 'string-limit';
    if (proposed.bytes > TREE_LIMITS.maxMessageBytes - 131072 || proposed.work > TREE_LIMITS.maxWorkItems - 10000) return 'byte-limit';
    used = proposed;
    snapshot.nodes[entry.node.id] = entry.node; snapshot.sourceOrder.push(entry.node.id);
    snapshot.diagnostics.push(...entry.diagnostics);
    if (parent) { parent.node.childIds.push(entry.node.id); parent.next++; }
    if (entry.children.length) stack.push({ source, node: entry.node, children: entry.children, next: 0, depth });
    chunkCount++;
    return undefined;
  };
  try {
    const initialState = state(); if (initialState) return { status: initialState };
    if (root.removed || root.id !== identity.rootId) return { status: 'error', message: 'Selected root is unavailable or no longer matches the request.' };
    const rootParentId = root.parent?.id ?? null;
    if (add(root, undefined, 0)) return { status: 'error', message: 'The root cannot fit within the snapshot budget.' };
    while (stack.length) {
      const interrupted = state(); if (interrupted) return { status: interrupted };
      if (root.removed || (root.parent?.id ?? null) !== rootParentId) return { status: 'stale' };
      const frame = stack[stack.length - 1]!;
      if (frame.source.removed) return { status: 'stale' };
      if (frame.next >= frame.children.length) { stack.pop(); continue; }
      if (snapshot.sourceOrder.length >= TREE_LIMITS.maxNodes) { markPending('node-limit'); break; }
      if (now() - start >= TREE_LIMITS.timeoutMs) { markPending('time-limit'); break; }
      if (chunkCount >= TREE_LIMITS.chunkNodes || now() - chunkStart >= TREE_LIMITS.chunkMs) {
        options.onProgress?.(snapshot.sourceOrder.length);
        await yieldControl();
        const afterYield = state(); if (afterYield) return { status: afterYield };
        chunkCount = 0; chunkStart = now(); continue;
      }
      const child = frame.children[frame.next];
      if (!child) throw new Error('A child is unavailable. Refresh the selection.');
      // Never silently combine hierarchy revisions after a reparent/removal.
      if (!child.removed && child.parent?.id !== frame.node.id) return { status: 'stale' };
      const stopped = add(child, frame, frame.depth + 1);
      if (stopped) { markPending(stopped); break; }
    }
    const interrupted = state(); if (interrupted) return { status: interrupted };
    if (root.removed || (root.parent?.id ?? null) !== rootParentId) return { status: 'stale' };
    snapshot.completeness = Object.values(snapshot.nodes).some(node => node.branch.status !== 'complete') ? 'partial' : 'complete';
    if (!parseTreePluginMessage({ type: 'tree-ready', ...identity, snapshot })) return { status: 'error', message: 'Snapshot could not be safely serialized within the tree contract.' };
    if (snapshot.completeness === 'complete' && now() - start >= TREE_LIMITS.timeoutMs) return { status: 'error', message: 'Tree capture exceeded its time budget. Try a smaller subtree.' };
    const beforeProgress = state(); if (beforeProgress) return { status: beforeProgress };
    options.onProgress?.(snapshot.sourceOrder.length);
    const afterProgress = state(); if (afterProgress) return { status: afterProgress };
    if (root.removed || (root.parent?.id ?? null) !== rootParentId) return { status: 'stale' };
    return { status: 'ready', snapshot };
  } catch { return { status: 'error', message: 'Tree capture failed. Refresh the selection and try a smaller subtree.' }; }
}
