import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { installTreeExport } from '../src/ui/tree-export';
import { minimalTree } from './fixtures/tree/minimal';
class Element {
  className = ''; textContent = ''; value = ''; type = ''; disabled = false; title = ''; maxLength = 0; tabIndex = 0;
  style: Record<string, string> = {}; children: Element[] = []; attributes = new Map<string, string>();
  listeners = new Map<string, () => void>(); focus = vi.fn(); select = vi.fn(); remove = vi.fn();
  append(...nodes: Element[]) { this.children.push(...nodes); }
  replaceChildren(...nodes: Element[]) { this.children = nodes; }
  setAttribute(key: string, value: string) { this.attributes.set(key, value); }
  addEventListener(type: string, callback: () => void) { this.listeners.set(type, callback); }
  click() { if (!this.disabled) this.listeners.get('click')?.(); }
  input(value: string, type = 'input') { this.value = value; this.listeners.get(type)?.(); }
}
const descendants = (node: Element): Element[] => node.children.flatMap(child => [child, ...descendants(child)]);
const textTree = () => { const tree = minimalTree(); tree.nodes.child!.inspector = { id: 'child', name: 'Text', type: 'TEXT', characters: 'Hello <world>', warnings: [] }; return tree; };
const flush = async () => { for (let i = 0; i < 5; i++) await Promise.resolve(); };
describe('tree HTML/CSS export controls', () => {
  let root: Element, controller: ReturnType<typeof installTreeExport>, write: ReturnType<typeof vi.fn<(text: string) => Promise<void>>>;
  let fallback: ReturnType<typeof vi.fn>;
  const byClass = (name: string) => descendants(root).find(node => node.className === name)!;
  const byText = (text: string) => descendants(root).find(node => node.textContent === text)!;
  beforeEach(() => {
    vi.useFakeTimers(); root = new Element(); write = vi.fn().mockResolvedValue(undefined); fallback = vi.fn().mockReturnValue(false);
    vi.stubGlobal('document', { createElement: () => new Element(), body: new Element(), execCommand: fallback });
    vi.stubGlobal('navigator', { clipboard: { writeText: write } });
    controller = installTreeExport(root as unknown as HTMLElement);
  });
  afterEach(() => { vi.clearAllTimers(); vi.useRealTimers(); vi.unstubAllGlobals(); });
  const show = () => { controller.setRoot('root'); controller.setSnapshot(textTree()); };
  it('keeps copy disabled until a current snapshot exists and copies HTML/CSS separately', async () => {
    expect(byText('Copy HTML draft').disabled).toBe(true); show();
    byText('Copy HTML draft').click(); await flush();
    expect(write).toHaveBeenLastCalledWith(byClass('tree-export-html').textContent);
    expect(byClass('tree-export-status').textContent).toBe('HTML draft copied.');
    byText('Copy CSS draft').click(); await flush();
    expect(write).toHaveBeenLastCalledWith(byClass('tree-export-css').textContent);
    expect(byClass('tree-export-css').textContent).not.toContain('<p');
  });
  it('applies a block class, manual tags and BEM names without changing the captured tree', () => {
    const tree = textTree(), before = JSON.stringify(tree); controller.setRoot('root'); controller.setSnapshot(tree);
    byClass('tree-block-class').input('cookie-banner'); expect(byText('Copy HTML draft').disabled).toBe(true); vi.advanceTimersByTime(120);
    byClass('tree-export-tag').input('header', 'change');
    controller.selectNode('child'); byClass('tree-element-name').input('description'); vi.advanceTimersByTime(120);
    byClass('tree-export-tag').input('h2', 'change');
    const html = byClass('tree-export-html').textContent;
    expect(html).toContain('<header class="cookie-banner">'); expect(html).toContain('<h2 class="cookie-banner__description">');
    expect(JSON.stringify(tree)).toBe(before);
  });
  it('blocks invalid identifiers and semantic combinations instead of copying stale output', () => {
    show(); byClass('tree-block-class').input('.card'); vi.advanceTimersByTime(120);
    expect(byText('Copy HTML draft').disabled).toBe(true); expect(byClass('tree-export-html').textContent).toBe('');
    expect(byClass('tree-export-status').textContent).toContain('without a dot');
    byClass('tree-block-class').input('card'); vi.advanceTimersByTime(120);
    byClass('tree-export-tag').input('button', 'change'); controller.selectNode('child'); byClass('tree-export-tag').input('h1', 'change');
    expect(byText('Copy HTML draft').disabled).toBe(true);
  });
  it('accepts only an explicit root-candidate name for the same selected root', () => {
    show(); expect(controller.useBlockClass('cookie-banner', 'other')).toBe(false);
    expect(controller.useBlockClass('a b', 'root')).toBe(false); expect(byClass('tree-block-class').value).toBe('component');
    expect(controller.useBlockClass('cookie-banner', 'root')).toBe(true);
    expect(byClass('tree-export-html').textContent).toContain('class="cookie-banner"');
    expect(byClass('tree-export-status').textContent).toContain('name only');
  });
  it('invalidates copy on stale/selection changes and resets decisions on new snapshots', () => {
    show(); byClass('tree-block-class').input('card'); vi.advanceTimersByTime(120); controller.selectNode('child');
    byClass('tree-export-tag').input('h2', 'change'); controller.setSnapshot(undefined);
    expect(byText('Copy HTML draft').disabled).toBe(true); expect(byClass('tree-export-html').textContent).toBe('');
    controller.setSnapshot(textTree()); expect(byClass('tree-export-html').textContent).not.toContain('<h2');
    expect(byClass('tree-block-class').value).toBe('card'); controller.setRoot('new');
    expect(byClass('tree-block-class').value).toBe('component'); expect(byText('Copy CSS draft').disabled).toBe(true);
  });
  it('reports clipboard failures and falls back without touching generated markup in the DOM', async () => {
    show(); write.mockRejectedValue(new Error('denied')); byText('Copy HTML draft').click(); await flush();
    expect(fallback).toHaveBeenCalledWith('copy'); expect(byClass('tree-export-status').textContent).toContain('Copy unavailable');
    fallback.mockReturnValue(true); byText('Copy HTML draft').click(); await flush();
    expect(byClass('tree-export-status').textContent).toBe('HTML draft copied.');
  });
  it('does not announce copied for a snapshot invalidated while clipboard was pending', async () => {
    show(); let finish: (() => void) | undefined; write.mockImplementation(() => new Promise<void>(resolve => { finish = resolve; }));
    byText('Copy HTML draft').click(); controller.setSnapshot(undefined); finish?.(); await flush();
    expect(byClass('tree-export-status').textContent).toContain('Inspect subtree'); expect(byText('Copy HTML draft').disabled).toBe(true);
  });
});
