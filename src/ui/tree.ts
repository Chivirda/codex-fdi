import { installTreeExport } from './tree-export';
import type { InspectorState, UIMessage } from '../shared/contracts';
import { generateCSS } from '../css/generate';
import { parseTreePluginMessage, sameTreeIdentity, TREE_LIMITS, type TreeIdentity, type TreeSnapshot, type TreeNode } from '../shared/tree';

type Phase = 'awaiting' | 'running' | 'ready' | 'cancelled' | 'stale' | 'error';
interface Operation { requestId: number; rootId: string; includeHidden: boolean; phase: Phase;
  identity?: TreeIdentity; progress: number; cancelRequested: boolean; cancelSent: boolean }
/** Local UI selection only. Never writes to the Figma document or changes selection. */
export function installTreeInspector(root: HTMLElement, send: (message: UIMessage) => void): {
  setSelection(state: InspectorState): void;
  receive(message: unknown): boolean;
  useBlockClass(className: string, rootId: string): boolean;
} {
  const make = <K extends keyof HTMLElementTagNameMap>(tag: K, className = '', text?: string): HTMLElementTagNameMap[K] => {
    const node = document.createElement(tag); node.className = className;
    if (text !== undefined) node.textContent = text;
    return node;
  };
  const inspect = make('button', '', 'Inspect subtree'); inspect.type = 'button';
  const cancel = make('button', '', 'Cancel'); cancel.type = 'button';
  const hiddenLabel = make('label', 'tree-hidden-label');
  const includeHidden = make('input', 'tree-include-hidden'); includeHidden.type = 'checkbox';
  hiddenLabel.append(includeHidden, make('span', '', 'Include hidden'));
  const toolbar = make('div', 'tree-toolbar'); toolbar.append(inspect, cancel, hiddenLabel);
  const rootLabel = make('p', 'tree-root-label');
  const status = make('p', 'tree-status'); status.setAttribute('role', 'status'); status.setAttribute('aria-live', 'polite');
  const progress = make('progress', 'tree-progress'); progress.max = TREE_LIMITS.maxNodes; progress.value = 0;
  progress.setAttribute('aria-label', 'Nodes processed (capture budget, not total size)');
  const list = make('div', 'tree-list'); list.setAttribute('role', 'tree'); list.setAttribute('aria-label', 'Captured Figma subtree');
  const selected = make('section', 'tree-selected'); selected.setAttribute('aria-label', 'Local tree node details');
  const notices = make('details', 'tree-diagnostics info-details');
  const noticeTitle = make('summary'); const noticeList = make('ul'); notices.append(noticeTitle, noticeList);
  const info = make('details', 'info-details'); info.append(make('summary', '', 'Scope and controls'),
    make('p', 'tree-help', 'Read-only snapshot of one selected subtree. Click a row to select it locally; click its arrow to expand. Arrow keys, Home and End navigate. Hidden or limited branches remain explicit placeholders. Single-node CSS describes one node. Structure export below generates a separate HTML/CSS draft.'));
  const exportHost = make('section', 'tree-export-host');
  root.replaceChildren(toolbar, rootLabel, status, progress, list, exportHost, selected, notices, info);
  const exporter = installTreeExport(exportHost);

  let selection: { id: string; name: string } | undefined;
  let nextRequestId = 0;
  let operation: Operation | undefined;
  let hostSession: string | undefined;
  let lastRevision = -1;
  let timer: ReturnType<typeof setTimeout> | undefined;
  let snapshot: TreeSnapshot | undefined;
  let activeId: string | undefined;
  let expanded = new Set<string>();
  let visibleIds: string[] = [];
  const rows = new Map<string, HTMLButtonElement>();
  const metadata = new Map<string, { depth: number; position: number; size: number }>();
  const busy = () => operation?.phase === 'awaiting' || operation?.phase === 'running';
  const emit = (message: UIMessage): boolean => { try { send(message); return true; } catch { return false; } };
  const controls = (): void => {
    inspect.disabled = !selection || busy(); cancel.disabled = !busy();
    progress.hidden = !busy(); list.setAttribute('aria-busy', String(busy()));
    rootLabel.textContent = selection ? `Figma root: ${selection.name || '(unnamed layer)'}` : 'Select one layer in Figma to inspect its subtree.';
    rootLabel.title = selection?.name ?? '';
  };
  const clearSnapshot = (): void => {
    exporter.setSnapshot(undefined);
    snapshot = undefined; activeId = undefined; visibleIds = []; rows.clear(); metadata.clear(); expanded.clear();
    list.replaceChildren(); selected.replaceChildren(); noticeList.replaceChildren(); notices.hidden = true; list.hidden = true; selected.hidden = true;
  };
  const sendCancel = (): void => {
    if (operation?.identity && operation.cancelRequested && !operation.cancelSent) {
      operation.cancelSent = true; emit({ type: 'tree-cancel', ...operation.identity });
    }
  };
  const end = (phase: 'cancelled' | 'stale' | 'error', message: string, cancelHost = false): void => {
    clearTimeout(timer); timer = undefined;
    if (operation) { if (cancelHost) operation.cancelRequested = true; operation.phase = phase; sendCancel(); }
    clearSnapshot(); status.textContent = message; controls();
  };
  const watch = (): void => {
    clearTimeout(timer);
    const expected = operation;
    timer = setTimeout(() => {
      if (operation === expected && busy()) end('error', 'Tree inspection timed out. Inspect subtree to retry.', true);
    }, TREE_LIMITS.timeoutMs + 5000);
  };
  const current = (data: TreeSnapshot): boolean => snapshot === data && operation?.phase === 'ready';
  const branchText = (node: TreeNode): string => {
    const branch = node.branch;
    if (branch.status === 'complete') return node.visible === false ? 'hidden · captured' : 'complete';
    const count = branch.omittedChildren === null ? 'unknown' : String(branch.omittedChildren);
    return `${branch.status} · ${branch.reason} · ${count} children not captured`;
  };
  const showNode = (): void => {
    exporter.selectNode(activeId);
    selected.replaceChildren();
    const node = activeId && snapshot?.nodes[activeId];
    selected.hidden = !node;
    if (!node) return;
    const data = node.inspector;
    selected.append(make('h3', '', 'Selected tree node'), make('p', 'tree-help', 'Local selection only. Figma selection stays unchanged.'),
      make('p', 'tree-selected-name', data?.name || node.id));
    const props = make('dl', 'properties');
    const fields: [string, string][] = [['ID', node.id], ['Type', data?.type ?? 'Unavailable'], ['Parent', node.parentId ?? 'Snapshot root'],
      ['Visible', node.visible === undefined ? 'Unknown' : String(node.visible)], ['Locked', node.locked === undefined ? 'Unknown' : String(node.locked)],
      ['Branch', branchText(node)]];
    if (data?.width !== undefined) fields.push(['Width', `${Number(data.width.toFixed(3))} px`]);
    if (data?.height !== undefined) fields.push(['Height', `${Number(data.height.toFixed(3))} px`]);
    for (const [key, value] of fields) { const row = make('div', 'property'); row.append(make('dt', '', key), make('dd', '', value)); props.append(row); }
    selected.append(props);
    const warnings = [...(data?.warnings ?? []), ...(snapshot?.diagnostics.filter(d => d.nodeId === node.id).map(d => `${d.code}: ${d.message}`) ?? [])];
    if (warnings.length) { const ul = make('ul', 'tree-node-warnings'); for (const warning of warnings) ul.append(make('li', '', warning)); selected.append(ul); }
    if (!data) { selected.append(make('p', 'tree-help', 'Properties unavailable for this placeholder.')); return; }
    const css = make('details', 'info-details'); css.append(make('summary', '', 'Single-node CSS'), make('pre', 'tree-node-css', generateCSS(data))); selected.append(css);
    if (typeof data.characters === 'string') {
      const text = make('details', 'info-details'); text.append(make('summary', '', 'Original text content'), make('pre', 'tree-node-text', data.characters)); selected.append(text);
    }
  };
  const select = (id: string, focus = false): void => {
    if (!snapshot || !current(snapshot) || !rows.has(id)) return;
    activeId = id;
    for (const [rowId, row] of rows) { row.tabIndex = rowId === id ? 0 : -1; row.setAttribute('aria-selected', String(rowId === id)); }
    showNode(); if (focus) rows.get(id)?.focus();
  };
  const paintRows = (focusId?: string): void => {
    const data = snapshot; if (!data || !current(data)) return;
    visibleIds = [];
    const pending = [data.rootId];
    while (pending.length) {
      const id = pending.pop()!; visibleIds.push(id);
      if (expanded.has(id)) { const children = data.nodes[id]!.childIds; for (let i = children.length - 1; i >= 0; i--) pending.push(children[i]!); }
    }
    if (!activeId || !visibleIds.includes(activeId)) activeId = focusId && visibleIds.includes(focusId) ? focusId : data.rootId;
    rows.clear();
    const elements: HTMLButtonElement[] = [];
    for (const id of visibleIds) {
      const node = data.nodes[id]!, meta = metadata.get(id)!;
      const row = make('button', 'tree-row'); row.type = 'button';
      row.setAttribute('role', 'treeitem'); row.setAttribute('aria-level', String(meta.depth + 1));
      row.setAttribute('aria-posinset', String(meta.position)); row.setAttribute('aria-setsize', String(meta.size));
      row.setAttribute('aria-selected', String(id === activeId)); row.tabIndex = id === activeId ? 0 : -1;
      row.style.paddingInlineStart = `${6 + Math.min(meta.depth, 6) * 8}px`;
      const name = node.inspector?.name ?? node.id;
      row.title = `${name}\n${node.inspector?.type ?? 'Unavailable'} · ${branchText(node)}`;
      const arrow = make('span', 'tree-arrow', node.childIds.length ? expanded.has(id) ? '▾' : '▸' : '·'); arrow.setAttribute('aria-hidden', 'true');
      const label = make('span', 'tree-node-name', name || '(unnamed layer)');
      const badge = make('span', 'tree-node-badge', `${node.inspector?.type ?? 'Unavailable'}${node.branch.status !== 'complete' ? ` · ${node.branch.status}` : ''}${node.visible === false ? ' · hidden' : ''}${node.locked ? ' · locked' : ''}`);
      row.append(arrow, label, badge);
      if (node.childIds.length) row.setAttribute('aria-expanded', String(expanded.has(id)));
      const toggle = (): void => {
        if (!current(data) || !node.childIds.length) return;
        if (expanded.has(id)) expanded.delete(id); else expanded.add(id);
        activeId = id; paintRows(id); showNode();
      };
      row.addEventListener('click', event => { if (!current(data)) return; select(id); if (event.target === arrow) toggle(); });
      row.addEventListener('dblclick', toggle);
      row.addEventListener('keydown', event => {
        if (!current(data) || event.altKey || event.ctrlKey || event.metaKey) return;
        const index = visibleIds.indexOf(id);
        switch (event.key) {
          case 'ArrowDown': select(visibleIds[Math.min(index + 1, visibleIds.length - 1)]!, true); break;
          case 'ArrowUp': select(visibleIds[Math.max(0, index - 1)]!, true); break;
          case 'Home': select(visibleIds[0]!, true); break;
          case 'End': select(visibleIds[visibleIds.length - 1]!, true); break;
          case 'ArrowRight': if (node.childIds.length) { if (!expanded.has(id)) toggle(); else select(node.childIds[0]!, true); } break;
          case 'ArrowLeft': if (node.childIds.length && expanded.has(id)) toggle(); else if (node.parentId) select(node.parentId, true); break;
          case 'Enter': case ' ': select(id); break;
          default: return;
        }
        event.preventDefault();
      });
      rows.set(id, row); elements.push(row);
    }
    list.replaceChildren(...elements); list.hidden = false;
    if (focusId) rows.get(activeId!)?.focus();
  };
  const showSnapshot = (data: TreeSnapshot): void => {
    snapshot = data; activeId = data.rootId; expanded = new Set([data.rootId]); metadata.clear();
    metadata.set(data.rootId, { depth: 0, position: 1, size: 1 });
    for (const id of data.sourceOrder) {
      const node = data.nodes[id]!, depth = metadata.get(id)!.depth;
      node.childIds.forEach((child, index) => metadata.set(child, { depth: depth + 1, position: index + 1, size: node.childIds.length }));
    }
    exporter.setSnapshot(data);
    paintRows(); showNode();
    noticeTitle.textContent = `${data.diagnostics.length} snapshot diagnostics`;
    noticeList.replaceChildren(); notices.hidden = data.diagnostics.length === 0;
    for (const diagnostic of data.diagnostics) {
      const li = make('li'); const link = make('button', 'tree-diagnostic-link', `${diagnostic.code} · ${diagnostic.nodeId}: ${diagnostic.message}`); link.type = 'button';
      link.addEventListener('click', () => {
        if (!current(data)) return;
        let parent = data.nodes[diagnostic.nodeId]!.parentId;
        while (parent) { expanded.add(parent); parent = data.nodes[parent]!.parentId; }
        paintRows(); select(diagnostic.nodeId, true);
      });
      li.append(link); noticeList.append(li);
    }
    const count = data.sourceOrder.length;
    status.textContent = `Captured ${count} node${count === 1 ? '' : 's'} · ${data.completeness} snapshot.${data.completeness === 'partial' ? ' Some branches or properties were not loaded; review diagnostics.' : ''}`;
  };
  inspect.addEventListener('click', () => {
    if (!selection || busy()) return;
    clearSnapshot();
    operation = { requestId: ++nextRequestId, rootId: selection.id, includeHidden: includeHidden.checked,
      phase: 'awaiting', progress: -1, cancelRequested: false, cancelSent: false };
    status.textContent = 'Requesting subtree…'; progress.value = 0; controls(); watch();
    if (!emit({ type: 'tree-inspect', requestId: operation.requestId, rootId: operation.rootId, includeHidden: operation.includeHidden })) end('error', 'Could not request subtree inspection. Try again.');
  });
  cancel.addEventListener('click', () => { if (busy()) end('cancelled', 'Inspection cancelled. Inspect subtree to retry.', true); });
  includeHidden.addEventListener('change', () => {
    if (operation) end('stale', 'Options changed. Inspect subtree again to include the new hidden-layer policy.', true);
  });
  clearSnapshot(); status.textContent = 'Select one element, then choose Inspect subtree.'; controls();
  return {
    useBlockClass: (className, rootId) => exporter.useBlockClass(className, rootId),
    setSelection(state): void {
      const next = state.status === 'ready' ? { id: state.node.id, name: state.node.name } : undefined;
      const changed = selection?.id !== next?.id;
      selection = next;
      exporter.setRoot(next?.id);
      if (changed && operation) end('stale', 'Selection changed or refreshed. Inspect subtree again.', true);
      controls();
    },
    receive(value): boolean {
      if (!value || typeof value !== 'object') return false;
      const type: unknown = Object.getOwnPropertyDescriptor(value, 'type')?.value;
      if (typeof type !== 'string' || !type.startsWith('tree-')) return false;
      const message = parseTreePluginMessage(value); if (!message) return false;
      const op = operation;
      if (!op || message.requestId !== op.requestId || message.rootId !== op.rootId) return true;
      if (message.type === 'tree-started' || message.type === 'tree-error' && op.phase === 'awaiting') {
        if (op.identity || (op.phase !== 'awaiting' && !op.cancelRequested) || (hostSession !== undefined && hostSession !== message.documentSessionId)
          || message.revision <= lastRevision) return true;
        op.identity = { requestId: message.requestId, rootId: message.rootId, documentSessionId: message.documentSessionId, revision: message.revision };
        hostSession = message.documentSessionId; lastRevision = message.revision;
        if (op.cancelRequested) { sendCancel(); return true; }
        if (message.type === 'tree-error') { end('error', message.message); return true; }
        op.phase = 'running'; status.textContent = 'Reading subtree…'; controls(); watch(); return true;
      }
      if (!op.identity || !sameTreeIdentity(op.identity, message)) return true;
      if (message.type === 'tree-stale' && (op.phase === 'running' || op.phase === 'ready')) { end('stale', `Snapshot is stale (${message.reason}). Inspect subtree again.`); return true; }
      if (op.phase !== 'running') return true;
      if (message.type === 'tree-progress') {
        if (message.processedNodes <= op.progress) return true;
        op.progress = message.processedNodes; progress.value = op.progress;
        status.textContent = `Reading subtree… ${op.progress} nodes processed (budget ${TREE_LIMITS.maxNodes}).`;
      } else if (message.type === 'tree-ready') {
        if (message.snapshot.includeHidden !== op.includeHidden || message.snapshot.sourceOrder.length < op.progress) { end('error', 'Tree response did not match the requested options or progress.', true); return true; }
        clearTimeout(timer); timer = undefined; op.phase = 'ready'; showSnapshot(message.snapshot); controls();
      } else if (message.type === 'tree-cancelled') end('cancelled', 'Inspection cancelled. Inspect subtree to retry.');
      else if (message.type === 'tree-error') end('error', message.message);
      return true;
    },
  };
}
