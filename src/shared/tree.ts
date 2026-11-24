import type { InspectorNode } from './contracts';
import type { Matrix } from './spacing';

/** Application budgets, not Figma API limits. Tune only after host measurements. */
export const TREE_LIMITS = Object.freeze({ maxNodes: 1000, maxDepth: 64, maxMessageBytes: 2 * 1024 * 1024,
  maxStringLength: 65536, maxStringUnits: 512 * 1024, maxDiagnostics: 2000,
  maxWorkItems: 100000, chunkNodes: 50, chunkMs: 8, timeoutMs: 10000 });
export interface TreeIdentity { requestId: number; documentSessionId: string; revision: number; rootId: string }
export type TreeBranch = { status: 'complete' }
  | { status: 'omitted'; reason: 'hidden' | 'unavailable'; omittedChildren: number | null }
  | { status: 'truncated'; reason: 'node-limit' | 'depth-limit' | 'time-limit' | 'byte-limit' | 'string-limit'; omittedChildren: number | null }
  | { status: 'unsupported'; reason: string; omittedChildren: number | null };
export interface TreeNode {
  id: string; parentId: string | null; childIds: string[];
  /** Reuse existing normalized dimensions/typography; do not redefine width/height. */
  inspector?: InspectorNode;
  /** Omit inaccessible API fields rather than inventing visibility/lock state. */
  visible?: boolean; locked?: boolean;
  branch: TreeBranch;
  /** Captured by adapter; parentLocal = inverse(parent absolute) × node absolute.
   * Root has no parentLocalTransform. No relativeTransform, AABB or inferred layout. */
  geometry?: { absoluteTransform: Matrix; parentLocalTransform?: Matrix };
}
export interface TreeDiagnostic {
  code: 'TREE_TRUNCATED' | 'HIDDEN_BRANCH_UNREAD' | 'NODE_UNAVAILABLE' | 'NODE_UNSUPPORTED' | 'GEOMETRY_UNSTABLE';
  severity: 'info' | 'warning' | 'blocker'; nodeId: string; message: string; revision: number;
}
export interface TreeSnapshot extends TreeIdentity {
  schemaVersion: 1; includeHidden: boolean;
  nodes: Record<string, TreeNode>;
  /** Iterative depth-first preorder in Figma child order; includes placeholders. */
  sourceOrder: string[]; completeness: 'complete' | 'partial';
  limits: typeof TREE_LIMITS; diagnostics: TreeDiagnostic[];
}
/** Main owns revisions and captures only the selected root of the current page. */
export type TreeUIMessage = { type: 'tree-inspect'; requestId: number; rootId: string; includeHidden: boolean }
  | ({ type: 'tree-cancel' } & TreeIdentity);
export type TreePluginMessage = TreeIdentity & (
  { type: 'tree-started' }
  | { type: 'tree-progress'; processedNodes: number }
  | { type: 'tree-ready'; snapshot: TreeSnapshot }
  | { type: 'tree-cancelled' }
  | { type: 'tree-stale'; reason: 'selection' | 'page' | 'document' | 'refresh' | 'replaced' }
  | { type: 'tree-error'; message: string });

type Guard = (value: unknown) => boolean;
const own = (value: object, key: PropertyKey): boolean => Object.prototype.hasOwnProperty.call(value, key);
const object = (v: unknown): v is Record<string, unknown> => !!v && typeof v === 'object' && !Array.isArray(v);
const text: Guard = v => typeof v === 'string';
const finite: Guard = v => typeof v === 'number' && Number.isFinite(v);
const nonnegative: Guard = v => finite(v) && (v as number) >= 0;
const integer: Guard = v => Number.isSafeInteger(v) && (v as number) >= 0;
const bool: Guard = v => typeof v === 'boolean';
const one = (...values: unknown[]): Guard => v => values.includes(v);
const array = (guard: Guard): Guard => v => Array.isArray(v) && v.every(guard);
const tuple = (guard: Guard, count: number): Guard => v => Array.isArray(v) && v.length === count && v.every(guard);
const shape = (required: Record<string, Guard>, optional: Record<string, Guard> = {}): Guard => v => object(v)
  && Object.keys(v).every(key => own(required, key) || own(optional, key))
  && Object.entries(required).every(([key, guard]) => own(v, key) && guard(v[key]))
  && Object.entries(optional).every(([key, guard]) => !own(v, key) || guard(v[key]));
const id: Guard = v => typeof v === 'string' && v.length > 0 && v.length <= 255 && !['__proto__', 'prototype', 'constructor'].includes(v);
const unit: Guard = v => nonnegative(v) && (v as number) <= 1;
const rgba = shape({ r: unit, g: unit, b: unit, a: unit });
const matrix = tuple(tuple(finite, 3), 2);
const spacingValues = shape(Object.fromEntries(['top', 'right', 'bottom', 'left', 'x', 'y', 'width', 'height'].map(key => [key, key === 'width' || key === 'height' ? nonnegative : finite])));
const spacing: Guard = v => shape({ status: one('unsupported'), message: text })(v)
  || shape({ status: one('ready'), parentName: text, parentType: text, values: spacingValues, warnings: array(text) })(v);
const inspector = shape({ id, name: text, type: id, warnings: array(text) }, {
  characters: text, width: nonnegative, height: nonnegative, opacity: unit, spacing,
  backgroundColor: rgba, color: rgba, border: shape({ width: nonnegative, color: rgba }),
  borderRadius: v => nonnegative(v) || tuple(nonnegative, 4)(v),
  layout: shape({ direction: one('row', 'column') }, { alignItems: one('flex-start', 'center', 'flex-end', 'baseline'),
    justifyContent: one('flex-start', 'center', 'flex-end', 'space-between'), gap: nonnegative, padding: tuple(nonnegative, 4) }),
  typography: shape({}, { fontFamily: text, fontSize: nonnegative, fontWeight: nonnegative,
    lineHeight: shape({ unit: one('px', '%'), value: nonnegative }), letterSpacing: shape({ unit: one('px', 'em'), value: finite }) }),
});
const unknownCount: Guard = v => v === null || integer(v);
const branch: Guard = v => shape({ status: one('complete') })(v)
  || shape({ status: one('omitted'), reason: one('hidden', 'unavailable'), omittedChildren: unknownCount })(v)
  || shape({ status: one('truncated'), reason: one('node-limit', 'depth-limit', 'time-limit', 'byte-limit', 'string-limit'), omittedChildren: v => v === null || integer(v) && (v as number) > 0 })(v)
  || shape({ status: one('unsupported'), reason: id, omittedChildren: unknownCount })(v);
const treeNode = shape({ id, parentId: v => v === null || id(v), childIds: array(id), branch },
  { inspector, visible: bool, locked: bool, geometry: shape({ absoluteTransform: matrix }, { parentLocalTransform: matrix }) });
const identity = { requestId: integer, documentSessionId: id, revision: integer, rootId: id };
const diagnostic = shape({ code: one('TREE_TRUNCATED', 'HIDDEN_BRANCH_UNREAD', 'NODE_UNAVAILABLE', 'NODE_UNSUPPORTED', 'GEOMETRY_UNSTABLE'),
  severity: one('info', 'warning', 'blocker'), nodeId: id, message: text, revision: integer });
const limits = shape(Object.fromEntries(Object.entries(TREE_LIMITS).map(([key, value]) => [key, one(value)])));

/** Bounded JSON-tree preflight. Reject getters, cycles/shared objects, symbols,
 * prototype keys and non-finite data before serialization or schema traversal. */
function jsonSafe(value: unknown): boolean {
  try {
    const pending: unknown[] = [value], seen = new Set<object>();
    let work = 0, strings = 0;
    while (pending.length) {
      if (++work > TREE_LIMITS.maxWorkItems) return false;
      const current = pending.pop();
      if (typeof current === 'string') {
        strings += current.length;
        if (current.length > TREE_LIMITS.maxStringLength || strings > TREE_LIMITS.maxStringUnits) return false;
      } else if (typeof current === 'number') { if (!Number.isFinite(current)) return false; }
      else if (current !== null && typeof current === 'object') {
        if (seen.has(current)) return false;
        seen.add(current);
        const proto: unknown = Object.getPrototypeOf(current);
        if (Array.isArray(current) ? proto !== Array.prototype : proto !== Object.prototype && proto !== null) return false;
        const keys = Reflect.ownKeys(current);
        if (Array.isArray(current) && keys.length !== current.length + 1) return false;
        if (keys.length + work + pending.length > TREE_LIMITS.maxWorkItems) return false;
        for (const key of keys) {
          if (Array.isArray(current) && key === 'length') continue;
          if (typeof key !== 'string' || !id(key)) return false;
          if (Array.isArray(current) && (!/^\d+$/.test(key) || Number(key) >= current.length)) return false;
          const descriptor = Object.getOwnPropertyDescriptor(current, key)!;
          if (!('value' in descriptor) || !descriptor.enumerable) return false;
          strings += key.length;
          if (strings > TREE_LIMITS.maxStringUnits) return false;
          pending.push(descriptor.value);
        }
      } else if (current !== null && typeof current !== 'boolean') return false;
    }
    // Preflight bounded both work and strings; stringify cannot expand aliases.
    const json = JSON.stringify(value);
    let bytes = 0;
    for (const char of json) {
      const code = char.codePointAt(0)!;
      bytes += code <= 127 ? 1 : code <= 2047 ? 2 : code <= 65535 ? 3 : 4;
      if (bytes > TREE_LIMITS.maxMessageBytes) return false;
    }
    return true;
  } catch { return false; }
}

function snapshotValid(value: unknown): value is TreeSnapshot {
  if (!shape({ ...identity, schemaVersion: one(1), includeHidden: bool, nodes: object, sourceOrder: array(id),
    completeness: one('complete', 'partial'), limits, diagnostics: array(diagnostic) })(value)) return false;
  const snapshot = value as TreeSnapshot;
  const entries = Object.entries(snapshot.nodes);
  if (!entries.length || entries.length > TREE_LIMITS.maxNodes || snapshot.sourceOrder.length !== entries.length
    || snapshot.diagnostics.length > TREE_LIMITS.maxDiagnostics || !own(snapshot.nodes, snapshot.rootId)) return false;
  for (const [key, node] of entries) {
    if (!treeNode(node) || key !== node.id || (node.inspector && node.inspector.id !== key) || node.childIds.length > TREE_LIMITS.maxNodes
      || (node.inspector?.characters !== undefined && node.inspector.type !== 'TEXT')) return false;
    if (!node.inspector && !(node.branch.status === 'omitted' && node.branch.reason === 'unavailable')) return false;
    if (node.branch.status === 'omitted' && (node.childIds.length || (node.branch.reason === 'hidden' && (node.visible !== false || snapshot.includeHidden)))) return false;
    if (!snapshot.includeHidden && node.visible === false && !(node.branch.status === 'omitted' && node.branch.reason === 'hidden')) return false;
    if (node.branch.status === 'unsupported' && node.childIds.length) return false;
  }
  const root = snapshot.nodes[snapshot.rootId]!;
  if (root.parentId !== null || root.geometry?.parentLocalTransform !== undefined) return false;
  const stack = [{ id: root.id, depth: 0 }], visited = new Set<string>();
  let order = 0, partial = false;
  while (stack.length) {
    const item = stack.pop()!, node = snapshot.nodes[item.id];
    if (!node || visited.has(item.id) || item.depth > TREE_LIMITS.maxDepth || snapshot.sourceOrder[order++] !== item.id) return false;
    visited.add(item.id);
    if (node.branch.status !== 'complete') partial = true;
    for (let i = node.childIds.length - 1; i >= 0; i--) {
      const childId = node.childIds[i]!;
      if (snapshot.nodes[childId]?.parentId !== node.id) return false;
      stack.push({ id: childId, depth: item.depth + 1 });
      if (stack.length + visited.size > TREE_LIMITS.maxNodes) return false;
    }
  }
  return visited.size === entries.length && snapshot.completeness === (partial ? 'partial' : 'complete')
    && snapshot.diagnostics.every(d => own(snapshot.nodes, d.nodeId) && d.revision === snapshot.revision)
    && entries.every(([, node]) => node.branch.status === 'complete' || snapshot.diagnostics.some(d => d.nodeId === node.id && d.code === (
      node.branch.status === 'truncated' ? 'TREE_TRUNCATED' : node.branch.status === 'unsupported' ? 'NODE_UNSUPPORTED'
        : node.branch.status === 'omitted' && node.branch.reason === 'hidden' ? 'HIDDEN_BRANCH_UNREAD' : 'NODE_UNAVAILABLE')));
}
export function parseTreeSnapshot(value: unknown): TreeSnapshot | undefined {
  return jsonSafe(value) && snapshotValid(value) ? value : undefined;
}
export function parseTreeUIMessage(value: unknown): TreeUIMessage | undefined {
  if (!jsonSafe(value)) return undefined;
  return shape({ type: one('tree-inspect'), requestId: integer, rootId: id, includeHidden: bool })(value)
    || shape({ type: one('tree-cancel'), ...identity })(value) ? value as TreeUIMessage : undefined;
}
export function parseTreePluginMessage(value: unknown): TreePluginMessage | undefined {
  if (!jsonSafe(value) || !object(value)) return undefined;
  const base = { ...identity, type: one(value.type) };
  const simple = ['tree-started', 'tree-cancelled'].includes(String(value.type)) && shape(base)(value);
  const progress = value.type === 'tree-progress' && shape({ ...base, processedNodes: v => integer(v) && (v as number) <= TREE_LIMITS.maxNodes })(value);
  const stale = value.type === 'tree-stale' && shape({ ...base, reason: one('selection', 'page', 'document', 'refresh', 'replaced') })(value);
  const error = value.type === 'tree-error' && shape({ ...base, message: text })(value);
  if (value.type === 'tree-ready' && shape({ ...base, snapshot: snapshotValid })(value)) {
    const message = value as unknown as TreePluginMessage & { type: 'tree-ready' };
    return sameTreeIdentity(message, message.snapshot) ? message : undefined;
  }
  return simple || progress || stale || error ? value as unknown as TreePluginMessage : undefined;
}
/** Both host and UI must discard non-current identities. Ordering progress and
 * terminal states additionally requires the future session state machine. */
export function sameTreeIdentity(a: TreeIdentity, b: TreeIdentity): boolean {
  return a.requestId === b.requestId && a.documentSessionId === b.documentSessionId && a.revision === b.revision && a.rootId === b.rootId;
}
