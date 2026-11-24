import { TREE_LIMITS, type TreeNode, type TreeSnapshot } from '../../../src/shared/tree';
export function treeNode(id: string, parentId: string | null = null, childIds: string[] = []): TreeNode {
  return { id, parentId, childIds, inspector: { id, name: id, type: 'FRAME', width: 100, height: 50, warnings: [] },
    visible: true, locked: false, branch: { status: 'complete' } };
}
export function minimalTree(): TreeSnapshot {
  return { schemaVersion: 1, requestId: 1, documentSessionId: 'session', revision: 2, rootId: 'root', includeHidden: false,
    nodes: { root: treeNode('root', null, ['child']), child: treeNode('child', 'root') },
    sourceOrder: ['root', 'child'], completeness: 'complete', limits: { ...TREE_LIMITS }, diagnostics: [] };
}
