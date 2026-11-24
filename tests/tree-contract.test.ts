import { describe, expect, it } from 'vitest';
import { minimalTree, treeNode } from './fixtures/tree/minimal';
import { TREE_LIMITS, parseTreePluginMessage, parseTreeSnapshot, parseTreeUIMessage, sameTreeIdentity } from '../src/shared/tree';

describe('Tree MVP A contract (no Figma or DOM)', () => {
  it('round-trips a flat snapshot and reuses inspector fields without mutations', () => {
    const input = minimalTree(), before = JSON.stringify(input);
    expect(parseTreeSnapshot(JSON.parse(before))).toEqual(input);
    expect(JSON.stringify(input)).toBe(before);
    expect(parseTreeSnapshot(input)?.nodes.child?.inspector?.width).toBe(100);
  });
  it('distinguishes hidden unloaded branches from empty containers and locked nodes', () => {
    const input = minimalTree(), child = input.nodes.child!;
    child.visible = false; child.locked = true;
    expect(parseTreeSnapshot(input)).toBeUndefined();
    child.branch = { status: 'omitted', reason: 'hidden', omittedChildren: 4 };
    input.completeness = 'partial';
    input.diagnostics = [{ code: 'HIDDEN_BRANCH_UNREAD', severity: 'info', nodeId: 'child', revision: 2, message: 'Hidden branch unread.' }];
    expect(parseTreeSnapshot(input)).toEqual(input);
    input.includeHidden = true;
    expect(parseTreeSnapshot(input)).toBeUndefined();
    child.visible = true; child.branch = { status: 'complete' }; input.completeness = 'complete'; input.diagnostics = [];
    expect(parseTreeSnapshot(input)).toEqual(input); // locked does not mean hidden
  });
  it.each(['node-limit', 'depth-limit', 'time-limit', 'byte-limit', 'string-limit'] as const)('preserves explicit truncation: %s', reason => {
    const input = minimalTree(); input.nodes.root!.branch = { status: 'truncated', reason, omittedChildren: 3 };
    input.completeness = 'partial';
    expect(parseTreeSnapshot(input)).toBeUndefined(); // missing diagnostic
    input.diagnostics = [{ code: 'TREE_TRUNCATED', severity: 'warning', nodeId: 'root', revision: 2, message: reason }];
    expect(parseTreeSnapshot(input)).toEqual(input);
    input.completeness = 'complete';
    expect(parseTreeSnapshot(input)).toBeUndefined();
  });
  it('keeps property-budget placeholders without inventing inspector data or descendant counts', () => {
    const input = minimalTree();
    input.nodes.child = { id: 'child', parentId: 'root', childIds: [], branch: { status: 'truncated', reason: 'string-limit', omittedChildren: 0 } };
    input.completeness = 'partial';
    input.diagnostics = [{ code: 'TREE_TRUNCATED', severity: 'warning', nodeId: 'child', revision: 2, message: 'Properties too large.' }];
    expect(parseTreeSnapshot(input)).toEqual(input);
    input.nodes.child.branch = { status: 'truncated', reason: 'node-limit', omittedChildren: 0 };
    expect(parseTreeSnapshot(input)).toBeUndefined();
  });
  it('represents inaccessible nodes without inventing names, metrics or visibility', () => {
    const input = minimalTree();
    input.nodes.child = { id: 'child', parentId: 'root', childIds: [], branch: { status: 'omitted', reason: 'unavailable', omittedChildren: null } };
    input.completeness = 'partial';
    input.diagnostics = [{ code: 'NODE_UNAVAILABLE', severity: 'warning', nodeId: 'child', revision: 2, message: 'Source unavailable.' }];
    expect(parseTreeSnapshot(input)).toEqual(input);
    input.nodes.child.branch = { status: 'complete' };
    expect(parseTreeSnapshot(input)).toBeUndefined();
  });
  it('retains unsupported visible placeholders rather than dropping them', () => {
    const input = minimalTree(); input.nodes.child!.branch = { status: 'unsupported', reason: 'mask', omittedChildren: 2 };
    input.completeness = 'partial';
    input.diagnostics = [{ code: 'NODE_UNSUPPORTED', severity: 'warning', nodeId: 'child', revision: 2, message: 'Unsupported mask.' }];
    expect(parseTreeSnapshot(input)).toEqual(input);
  });
  it.each(['duplicate', 'orphan', 'cycle', 'wrong-parent', 'wrong-order', 'wrong-id', 'root-parent'])( 'rejects inconsistent tree: %s', kind => {
    const input = minimalTree();
    if (kind === 'duplicate') input.nodes.root!.childIds.push('child');
    if (kind === 'orphan') { input.nodes.orphan = treeNode('orphan'); input.sourceOrder.push('orphan'); }
    if (kind === 'cycle') input.nodes.child!.childIds = ['root'];
    if (kind === 'wrong-parent') input.nodes.child!.parentId = 'unknown';
    if (kind === 'wrong-order') input.sourceOrder.reverse();
    if (kind === 'wrong-id') input.nodes.child!.inspector!.id = 'wrong';
    if (kind === 'root-parent') input.nodes.root!.parentId = 'child';
    expect(parseTreeSnapshot(input)).toBeUndefined();
  });
  it('bounds node count and depth using iterative traversal', () => {
    const wide = minimalTree(); wide.nodes = { root: treeNode('root') }; wide.sourceOrder = ['root'];
    for (let i = 1; i < TREE_LIMITS.maxNodes; i++) {
      const id = `n${i}`; wide.nodes[id] = treeNode(id, 'root'); wide.nodes.root!.childIds.push(id); wide.sourceOrder.push(id);
    }
    expect(parseTreeSnapshot(wide)).toEqual(wide);
    wide.nodes.extra = treeNode('extra', 'root'); wide.nodes.root!.childIds.push('extra'); wide.sourceOrder.push('extra');
    expect(parseTreeSnapshot(wide)).toBeUndefined();
    const deep = minimalTree(); deep.nodes = { root: treeNode('root') }; deep.sourceOrder = ['root'];
    let parent = 'root';
    for (let i = 1; i <= TREE_LIMITS.maxDepth; i++) {
      const id = `n${i}`; deep.nodes[id] = treeNode(id, parent); deep.nodes[parent]!.childIds.push(id); deep.sourceOrder.push(id); parent = id;
    }
    expect(parseTreeSnapshot(deep)).toEqual(deep);
    deep.nodes.extra = treeNode('extra', parent); deep.nodes[parent]!.childIds.push('extra'); deep.sourceOrder.push('extra');
    expect(parseTreeSnapshot(deep)).toBeUndefined();
  });
  it('rejects invalid inspector metrics, symbols, unsupported fields and malformed matrices', () => {
    for (const value of [NaN, Infinity, -1]) {
      const input = minimalTree(); input.nodes.child!.inspector!.width = value;
      expect(parseTreeSnapshot(input)).toBeUndefined();
    }
    const input = minimalTree(); input.nodes.child!.geometry = { absoluteTransform: [[1, 0, 0], [0, 1, NaN]] };
    expect(parseTreeSnapshot(input)).toBeUndefined();
    expect(parseTreeSnapshot({ ...minimalTree(), unknown: true })).toBeUndefined();
    expect(parseTreeSnapshot({ ...minimalTree(), secret: Symbol('mixed') })).toBeUndefined();
    input.nodes.child!.geometry = { absoluteTransform: [[1, 0, 0], [0, 1, 0]], parentLocalTransform: [[1, 0, 20], [0, 1, 30]] };
    expect(parseTreeSnapshot(input)).toBeDefined();
  });
  it('bounds strings, aggregate JSON bytes, sparse arrays, cycles and getters without invoking them', () => {
    const input = minimalTree(); input.nodes.child!.inspector!.characters = 'x'.repeat(TREE_LIMITS.maxStringLength + 1);
    expect(parseTreeSnapshot(input)).toBeUndefined();
    const large = minimalTree(); large.nodes.child!.inspector!.warnings = Array.from({ length: 8 }, () => '\u0000'.repeat(64000));
    expect(parseTreeSnapshot(large)).toBeUndefined(); // escaped JSON > 2MiB
    const read = { count: 0 }; const accessor = minimalTree();
    Object.defineProperty(accessor, 'extra', { enumerable: true, get() { read.count++; return 1; } });
    expect(parseTreeSnapshot(accessor)).toBeUndefined(); expect(read.count).toBe(0);
    const cyclic: Record<string, unknown> = {}; cyclic.self = cyclic;
    expect(parseTreeSnapshot(cyclic)).toBeUndefined();
    const sparse = minimalTree(); sparse.nodes.child!.inspector!.warnings = new Array(2) as string[];
    expect(parseTreeSnapshot(sparse)).toBeUndefined();
    expect(parseTreeSnapshot(JSON.parse('{"__proto__":{}}'))).toBeUndefined();
  });
  it('rejects altered limits, stale diagnostics and undeclared geometry origins', () => {
    const input = minimalTree(); input.limits = { ...TREE_LIMITS, maxNodes: 999 } as unknown as typeof TREE_LIMITS;
    expect(parseTreeSnapshot(input)).toBeUndefined();
    input.limits = { ...TREE_LIMITS }; input.diagnostics = [{ code: 'GEOMETRY_UNSTABLE', severity: 'warning', nodeId: 'missing', revision: 2, message: 'Unknown' }];
    expect(parseTreeSnapshot(input)).toBeUndefined();
    input.diagnostics[0]!.nodeId = 'root'; input.diagnostics[0]!.revision = 1;
    expect(parseTreeSnapshot(input)).toBeUndefined();
    input.diagnostics = []; input.nodes.root!.geometry = { absoluteTransform: [[1, 0, 0], [0, 1, 0]], parentLocalTransform: [[1, 0, 0], [0, 1, 0]] };
    expect(parseTreeSnapshot(input)).toBeUndefined();
  });
  it('validates inspect/cancel separately from the existing inspector protocol', () => {
    expect(parseTreeUIMessage({ type: 'tree-inspect', requestId: 1, rootId: 'root', includeHidden: false })).toBeDefined();
    const identity = { requestId: 1, documentSessionId: 'session', revision: 2, rootId: 'root' };
    expect(parseTreeUIMessage({ type: 'tree-cancel', ...identity })).toBeDefined();
    for (const value of [{ type: 'tree-inspect', requestId: -1, rootId: 'root', includeHidden: false }, { type: 'tree-cancel', requestId: 1 },
      { type: 'tree-inspect', requestId: 1, rootId: 'root', includeHidden: 'false' }, { type: 'ready' }]) expect(parseTreeUIMessage(value)).toBeUndefined();
  });
  it('correlates ready/progress/terminal responses by all four identity fields', () => {
    const snapshot = minimalTree();
    const identity = { requestId: 1, documentSessionId: 'session', revision: 2, rootId: 'root' };
    expect(parseTreePluginMessage({ ...identity, type: 'tree-ready', snapshot })).toBeDefined();
    for (const type of ['tree-started', 'tree-cancelled']) expect(parseTreePluginMessage({ ...identity, type })).toBeDefined();
    expect(parseTreePluginMessage({ ...identity, type: 'tree-progress', processedNodes: 3 })).toBeDefined();
    expect(parseTreePluginMessage({ ...identity, type: 'tree-progress', processedNodes: 1001 })).toBeUndefined();
    expect(parseTreePluginMessage({ ...identity, type: 'tree-stale', reason: 'document' })).toBeDefined();
    expect(parseTreePluginMessage({ ...identity, type: 'tree-error', message: 'Unavailable root' })).toBeDefined();
    for (const changed of [{ requestId: 9 }, { revision: 9 }, { documentSessionId: 'other' }, { rootId: 'other' }]) {
      const stale = { ...identity, ...changed };
      expect(sameTreeIdentity(identity, stale)).toBe(false);
      expect(parseTreePluginMessage({ ...stale, type: 'tree-ready', snapshot })).toBeUndefined();
    }
    expect(sameTreeIdentity(identity, identity)).toBe(true);
    expect(parseTreePluginMessage({ ...identity, type: 'unknown' })).toBeUndefined();
  });
});
