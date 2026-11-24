import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { installTreeInspector } from '../src/ui/tree';
import type { InspectorState, UIMessage } from '../src/shared/contracts';
import { TREE_LIMITS, type TreeIdentity, type TreeSnapshot } from '../src/shared/tree';
import { minimalTree, treeNode } from './fixtures/tree/minimal';

let focused: Element | undefined;
class Element {
  tagName: string; constructor(tag = 'div') { this.tagName = tag.toUpperCase(); }
  className = ''; textContent = ''; title = ''; type = ''; hidden = false; disabled = false; checked = false;
  tabIndex = -1; value = 0; max = 0; isConnected = true;
  style: Record<string, string> = {}; attributes = new Map<string, string>(); children: Element[] = [];
  listeners = new Map<string, (event: Event) => void>();
  append(...nodes: Element[]) { this.children.push(...nodes); }
  replaceChildren(...nodes: Element[]) { const detach = (node: Element) => { node.isConnected = false; node.children.forEach(detach); }; this.children.forEach(detach); this.children = nodes; }
  setAttribute(key: string, value: string) { this.attributes.set(key, value); }
  addEventListener(type: string, callback: (event: Event) => void) { this.listeners.set(type, callback); }
  focus() { focused = this; }
  click(target: Element = this) { if (!this.disabled) this.listeners.get('click')?.({ target } as unknown as Event); }
  change() { this.listeners.get('change')?.({ target: this } as unknown as Event); }
  key(key: string, modifiers = {}) { const preventDefault = vi.fn(); this.listeners.get('keydown')?.({ key, preventDefault, ...modifiers } as unknown as Event); return preventDefault; }
}
const descendants = (root: Element): Element[] => root.children.flatMap(child => [child, ...descendants(child)]);
const selection = (id = 'root', name = 'Root'): InspectorState => ({ status: 'ready', node: { id, name, type: 'FRAME', warnings: [] }, css: '.inspected-element{}' });
function nestedTree(): TreeSnapshot {
  return { ...minimalTree(), nodes: { root: treeNode('root', null, ['a', 'b']), a: treeNode('a', 'root', ['a1']),
    a1: treeNode('a1', 'a'), b: treeNode('b', 'root') }, sourceOrder: ['root', 'a', 'a1', 'b'] };
}

describe('read-only Tree UI', () => {
  let root: Element, controller: ReturnType<typeof installTreeInspector>, send: ReturnType<typeof vi.fn<(message: UIMessage) => void>>;
  let currentIdentity: TreeIdentity;
  const all = () => descendants(root);
  const byClass = (name: string) => all().find(node => node.className.split(' ').includes(name))!;
  const byText = (text: string) => all().find(node => node.textContent === text)!;
  const rows = () => all().filter(node => node.attributes.get('role') === 'treeitem');
  const row = (name: string) => rows().find(node => node.title.startsWith(`${name}\n`))!;
  const requests = () => send.mock.calls.map(([message]) => message).filter(message => message.type === 'tree-inspect');
  const cancels = () => send.mock.calls.map(([message]) => message).filter(message => message.type === 'tree-cancel');
  const startRequest = () => { controller.setSelection(selection()); byText('Inspect subtree').click(); };
  const started = (revision = 1, session = 'session') => {
    const request = requests()[requests().length - 1]!;
    currentIdentity = { requestId: request.requestId, rootId: request.rootId, revision, documentSessionId: session };
    controller.receive({ type: 'tree-started', ...currentIdentity });
  };
  const data = (tree = minimalTree()) => ({ ...tree, ...currentIdentity, includeHidden: requests()[requests().length - 1]!.includeHidden });
  const ready = (tree = minimalTree()) => controller.receive({ type: 'tree-ready', ...currentIdentity, snapshot: data(tree) });
  beforeEach(() => {
    vi.useFakeTimers(); focused = undefined; root = new Element(); send = vi.fn();
    vi.stubGlobal('document', { createElement: (tag: string) => new Element(tag) });
    controller = installTreeInspector(root as unknown as HTMLElement, send);
  });
  afterEach(() => { vi.clearAllTimers(); vi.useRealTimers(); vi.unstubAllGlobals(); });

  it('requests nothing automatically, disables commands without one selection, and preserves controller nodes', () => {
    const button = byText('Inspect subtree'), input = byClass('tree-include-hidden');
    expect(button.disabled).toBe(true); expect(byText('Cancel').disabled).toBe(true); expect(send).not.toHaveBeenCalled();
    controller.setSelection(selection()); expect(button.disabled).toBe(false); expect(send).not.toHaveBeenCalled();
    controller.setSelection({ status: 'multiple', count: 2 }); expect(button.disabled).toBe(true);
    controller.setSelection(selection('new', 'Updated'));
    expect(byText('Inspect subtree')).toBe(button); expect(byClass('tree-include-hidden')).toBe(input);
  });
  it('correlates started/progress/ready, shows counts and ignores duplicated/backwards progress', () => {
    startRequest(); expect(requests()[0]).toEqual({ type: 'tree-inspect', requestId: 1, rootId: 'root', includeHidden: false });
    expect(byText('Inspect subtree').disabled).toBe(true); expect(byText('Cancel').disabled).toBe(false);
    started();
    for (const count of [0, 2, 2, 1, -1, 1001]) controller.receive({ type: 'tree-progress', ...currentIdentity, processedNodes: count });
    expect(byClass('tree-progress').value).toBe(2); ready();
    expect(byClass('tree-status').textContent).toBe('Captured 2 nodes · complete snapshot.');
    expect(byText('Cancel').disabled).toBe(true); expect(byClass('tree-progress').hidden).toBe(true);
    expect(rows()).toHaveLength(2); expect(row('root').tabIndex).toBe(0); expect(row('child').tabIndex).toBe(-1);
    vi.advanceTimersByTime(20000); expect(byClass('tree-status').textContent).toContain('Captured 2');
  });
  it('accepts a correlated error before started, without leaving controls busy', () => {
    startRequest(); controller.receive({ type: 'tree-error', requestId: 1, rootId: 'root', documentSessionId: 'session', revision: 1, message: 'Selection no longer matches' });
    expect(byClass('tree-status').textContent).toBe('Selection no longer matches'); expect(byText('Inspect subtree').disabled).toBe(false);
    expect(rows()).toHaveLength(0);
  });
  it('cancels before started and sends exact cancellation when the identity arrives later', () => {
    startRequest(); byText('Cancel').click(); expect(cancels()).toHaveLength(0);
    expect(byClass('tree-status').textContent).toContain('cancelled'); started();
    expect(cancels()).toEqual([{ type: 'tree-cancel', ...currentIdentity }]);
    ready(); controller.receive({ type: 'tree-progress', ...currentIdentity, processedNodes: 2 });
    expect(rows()).toHaveLength(0); expect(byClass('tree-status').textContent).toContain('cancelled');
  });
  it('cancels running work and ignores terminal or progress messages after local cancellation', () => {
    startRequest(); started(); byText('Cancel').click(); byText('Cancel').click();
    expect(cancels()).toHaveLength(1); ready(); controller.receive({ type: 'tree-error', ...currentIdentity, message: 'late' });
    controller.receive({ type: 'tree-cancelled', ...currentIdentity });
    expect(byClass('tree-status').textContent).toContain('cancelled'); expect(rows()).toHaveLength(0);
  });
  it('ignores malformed messages, unstarted responses, stale identity and foreign session/revision', () => {
    startRequest();
    controller.receive({ type: 'tree-ready', requestId: 1, rootId: 'root', revision: 1, documentSessionId: 'session', snapshot: { ...minimalTree(), revision: 1 } });
    expect(rows()).toHaveLength(0); expect(byClass('tree-status').textContent).toContain('Requesting');
    started();
    for (const patch of [{ requestId: 99 }, { rootId: 'other' }, { revision: 3 }, { documentSessionId: 'other' }]) {
      controller.receive({ type: 'tree-progress', ...currentIdentity, ...patch, processedNodes: 5 });
    }
    expect(byClass('tree-progress').value).toBe(0);
    expect(controller.receive({ type: 'tree-ready', ...currentIdentity, snapshot: {} })).toBe(false);
    ready(); expect(rows()).toHaveLength(2);
  });
  it('pins session and increasing revisions across requests without accepting late first-request results', () => {
    startRequest(); started(2); const first = { ...currentIdentity }; ready();
    byText('Inspect subtree').click(); started(3, 'foreign'); expect(byClass('tree-status').textContent).toContain('Requesting');
    started(2); expect(byClass('tree-status').textContent).toContain('Requesting');
    started(3); controller.receive({ type: 'tree-error', ...first, message: 'late old error' }); ready();
    expect(byClass('tree-status').textContent).toContain('Captured'); expect(requests().map(r => r.requestId)).toEqual([1, 2]);
  });
  it('clears stale snapshots on selection/loading/options changes and does not auto-recapture', () => {
    startRequest(); started(); ready(); controller.setSelection(selection('different'));
    expect(rows()).toHaveLength(0); ready(); expect(rows()).toHaveLength(0);
    expect(byClass('tree-status').textContent).toContain('Selection changed'); expect(requests()).toHaveLength(1);
    controller.setSelection(selection()); byText('Inspect subtree').click(); started(2); ready();
    const checkbox = byClass('tree-include-hidden'); checkbox.checked = true; checkbox.change();
    expect(rows()).toHaveLength(0); expect(requests()).toHaveLength(2);
    byText('Inspect subtree').click(); expect(requests()[2]?.includeHidden).toBe(true);
    controller.setSelection({ status: 'loading' }); expect(byText('Inspect subtree').disabled).toBe(true);
  });
  it('preserves a same-root ready snapshot until main sends authoritative stale invalidation', () => {
    startRequest(); started(); ready(); controller.setSelection(selection('root', 'Renamed'));
    expect(rows()).toHaveLength(2); expect(byClass('tree-root-label').textContent).toContain('Renamed');
    controller.receive({ type: 'tree-stale', ...currentIdentity, reason: 'document' });
    expect(rows()).toHaveLength(0); expect(byClass('tree-status').textContent).toContain('stale (document)');
    ready(); expect(rows()).toHaveLength(0);
  });
  it('times out without hanging and cancels a late-started operation instead of reopening it', () => {
    startRequest(); vi.advanceTimersByTime(TREE_LIMITS.timeoutMs + 5000);
    expect(byClass('tree-status').textContent).toContain('timed out'); expect(byText('Inspect subtree').disabled).toBe(false);
    started(); expect(cancels()).toEqual([{ type: 'tree-cancel', ...currentIdentity }]); ready();
    expect(byClass('tree-status').textContent).toContain('timed out'); expect(rows()).toHaveLength(0);
  });
  it('handles send failure and protects against wrong hidden policy/final progress rollback', () => {
    controller.setSelection(selection()); send.mockImplementationOnce(() => { throw new Error('unavailable'); });
    byText('Inspect subtree').click(); expect(byClass('tree-status').textContent).toContain('Could not request');
    byText('Inspect subtree').click(); started();
    controller.receive({ type: 'tree-ready', ...currentIdentity, snapshot: { ...data(), includeHidden: true } });
    expect(byClass('tree-status').textContent).toContain('did not match'); expect(cancels()).toHaveLength(1);
    byText('Inspect subtree').click(); started(2); controller.receive({ type: 'tree-progress', ...currentIdentity, processedNodes: 3 }); ready();
    expect(byClass('tree-status').textContent).toContain('did not match'); expect(rows()).toHaveLength(0);
  });
  it('shows placeholders and partial completeness without fabricating properties', () => {
    startRequest(); started(); const tree = minimalTree();
    tree.nodes.child!.visible = false; delete tree.nodes.child!.inspector;
    tree.nodes.child!.branch = { status: 'omitted', reason: 'hidden', omittedChildren: null }; tree.completeness = 'partial';
    tree.diagnostics = [{ code: 'HIDDEN_BRANCH_UNREAD', severity: 'info', nodeId: 'child', message: 'Hidden branch unread.', revision: 1 }];
    ready(tree); expect(byClass('tree-status').textContent).toContain('partial snapshot'); expect(byClass('tree-diagnostics').hidden).toBe(false);
    row('child').click(); expect(byText('Properties unavailable for this placeholder.')).toBeDefined();
    expect(byText('omitted · hidden · unknown children not captured')).toBeDefined();
  });
  it('supports roving focus, expanding/collapsing and parent/child/Home/End keyboard navigation', () => {
    startRequest(); started(); ready(nestedTree()); const before = send.mock.calls.length;
    expect(rows().map(r => r.title.split('\n')[0])).toEqual(['root', 'a', 'b']);
    row('root').key('ArrowRight'); expect(focused).toBe(row('a'));
    expect(row('a').key('ArrowRight')).toHaveBeenCalled(); expect(rows()).toHaveLength(4);
    expect(row('a').attributes.get('aria-expanded')).toBe('true');
    row('a').key('ArrowRight'); expect(focused).toBe(row('a1')); expect(row('a1').attributes.get('aria-level')).toBe('3');
    row('a1').key('ArrowLeft'); expect(focused).toBe(row('a')); row('a').key('ArrowLeft'); expect(rows()).toHaveLength(3);
    row('a').key('End'); expect(focused).toBe(row('b')); row('b').key('Home'); expect(focused).toBe(row('root'));
    row('root').key('ArrowDown'); row('a').key('ArrowUp'); expect(focused).toBe(row('root'));
    row('root').key(' '); row('root').key('Enter'); expect(rows().filter(r => r.tabIndex === 0)).toHaveLength(1);
    expect(send.mock.calls).toHaveLength(before); // local selection never changes Figma
    expect(row('root').key('x')).not.toHaveBeenCalled(); expect(row('root').key('ArrowDown', { ctrlKey: true })).not.toHaveBeenCalled();
  });
  it('supports mouse disclosure and diagnostics that reveal and focus a deep node', () => {
    startRequest(); started(); const tree = nestedTree();
    tree.diagnostics = [{ code: 'GEOMETRY_UNSTABLE', severity: 'warning', nodeId: 'a1', message: 'Geometry unavailable', revision: 1 }]; ready(tree);
    const a = row('a'); a.click(a.children[0]); expect(rows()).toHaveLength(4);
    row('a').click(row('a').children[0]); expect(rows()).toHaveLength(3);
    byClass('tree-diagnostic-link').click(); expect(focused).toBe(row('a1'));
    expect(row('a1').attributes.get('aria-selected')).toBe('true');
  });
  it('uses DOM text for malicious names/Unicode content and shows existing generator CSS without mutating snapshot', () => {
    startRequest(); started(); const tree = minimalTree();
    tree.nodes.child!.inspector = { id: 'child', type: 'TEXT', name: '<img src=x onerror=evil()>'.repeat(20), characters: '  世界\n👋 <script>evil()</script>',
      width: 23.2, height: 50, warnings: [] };
    const before = JSON.stringify(tree); ready(tree); const child = rows()[1]!; child.click();
    expect(child.title).toContain('<img'); expect(byClass('tree-node-text').textContent).toBe(tree.nodes.child!.inspector.characters);
    expect(byClass('tree-node-css').textContent).toContain('width: 23.2px;');
    expect(all().some(node => ['IMG', 'SCRIPT', 'IFRAME', 'STYLE'].includes(node.tagName))).toBe(false);
    expect(JSON.stringify(tree)).toBe(before);
  });
  it('does not activate detached rows/diagnostic handlers from a stale snapshot', () => {
    startRequest(); started(); ready(nestedTree()); const oldRow = row('a');
    controller.receive({ type: 'tree-stale', ...currentIdentity, reason: 'document' });
    oldRow.click(); oldRow.key('ArrowRight'); expect(rows()).toHaveLength(0); expect(byClass('tree-selected').hidden).toBe(true);
  });
  it('bounds DOM rows to the validated snapshot budget', () => {
    startRequest(); started(); const tree = minimalTree(); tree.nodes = { root: treeNode('root') }; tree.sourceOrder = ['root'];
    for (let i = 1; i < TREE_LIMITS.maxNodes; i++) { const id = `n${i}`; tree.nodes[id] = treeNode(id, 'root'); tree.nodes.root!.childIds.push(id); tree.sourceOrder.push(id); }
    ready(tree); expect(rows()).toHaveLength(1000); expect(rows().filter(r => r.tabIndex === 0)).toHaveLength(1);
  });
  it('caps visual indentation while preserving real accessibility depth', () => {
    startRequest(); started(); const tree = minimalTree(); tree.nodes = { root: treeNode('root') }; tree.sourceOrder = ['root']; let parent = 'root';
    for (let i = 1; i <= TREE_LIMITS.maxDepth; i++) { const id = `n${i}`; tree.nodes[id] = treeNode(id, parent); tree.nodes[parent]!.childIds.push(id); tree.sourceOrder.push(id); parent = id; }
    tree.diagnostics = [{ code: 'GEOMETRY_UNSTABLE', severity: 'warning', nodeId: parent, message: 'Deep node', revision: 1 }]; ready(tree);
    byClass('tree-diagnostic-link').click(); expect(row(parent).attributes.get('aria-level')).toBe('65');
    expect(Math.max(...rows().map(r => parseFloat(r.style.paddingInlineStart!)))).toBe(54);
  });
  it('declares min-width/overflow/ellipsis constraints for narrow windows; actual layout requires Figma/browser', async () => {
    const moduleName: string = 'node:fs/promises';
    const { readFile } = await import(moduleName) as { readFile(path: string, encoding: string): Promise<string> };
    const css = await readFile('src/ui/style.css', 'utf8');
    expect(css).toContain('.tree-list { min-width: 0; max-width: 100%;');
    expect(css).toContain('overflow-y: auto; overflow-x: hidden;');
    expect(css).toContain('.tree-node-name { flex: 1 1 auto; min-width: 0; overflow: hidden; text-overflow: ellipsis;');
    expect(css).toContain('.tree-row:focus-visible');
  });
});
