import { afterEach, beforeEach, describe, expect, it, vi, type Mock } from 'vitest';
import { installProjectStyles } from '../src/ui/project-styles';
import type { InspectorNode, UIMessage } from '../src/shared/contracts';
import type { FileMetadata, MatchingResult, ProjectSnapshot, StylesCommand, StylesProfile, StylesResponse } from '../src/shared/project-styles';

class Element {
  className = ''; textContent = ''; value = ''; type = ''; title = '';
  maxLength = 0;
  disabled = false; isConnected = true; files: File[] | null = null;
  style: Record<string, string> = {};
  attributes = new Map<string, string>();
  children: Element[] = [];
  listeners = new Map<string, () => void>();
  append(...nodes: Element[]): void { this.children.push(...nodes); }
  replaceChildren(...nodes: Element[]): void {
    const detach = (node: Element): void => { node.isConnected = false; node.children.forEach(detach); };
    this.children.forEach(detach); this.children = nodes;
  }
  addEventListener(type: string, callback: () => void): void { this.listeners.set(type, callback); }
  setAttribute(key: string, value: string): void { this.attributes.set(key, value); }
  focus(): void {} select(): void {} remove(): void { this.isConnected = false; }
  click(): void { this.listeners.get('click')?.(); }
}
const descendants = (element: Element): Element[] => element.children.flatMap(child => [child, ...descendants(child)]);
const node = (id = '1'): InspectorNode => ({ id, name: 'Button', type: 'FRAME', width: 100, warnings: [] });
const emptyMatch = (): MatchingResult => ({ matches: [], variables: [], warnings: [] });
const fileInfo = (id: string, name: string, bytes: number): FileMetadata => ({ id, name, bytes, importedAt: 1000, classes: 1, rules: 1, variables: 0 });
const flush = async (): Promise<void> => { for (let i = 0; i < 20; i++) await Promise.resolve(); };

describe('Project Styles UI', () => {
  let root: Element;
  let files: Map<string, FileMetadata>;
  let matching: MatchingResult;
  let send: Mock<(message: UIMessage) => void>;
  let writeText: Mock<(text: string) => Promise<void>>;
  let request: (command: StylesCommand) => Promise<StylesResponse>;
  let controller: ReturnType<typeof installProjectStyles>;
  const byClass = (name: string): Element => descendants(root).find(item => item.className === name)!;
  const byText = (text: string): Element => descendants(root).find(item => item.textContent === text)!;
  const snapshot = (): ProjectSnapshot => ({ files: [...files.values()], classes: files.size, rules: files.size, variables: 0, warnings: [] });
  const importFiles = async (...chosen: File[]): Promise<void> => {
    const input = byClass('project-import'); input.files = chosen;
    input.listeners.get('change')?.(); await flush();
  };
  beforeEach(() => {
    vi.useFakeTimers(); root = new Element(); files = new Map(); matching = emptyMatch(); send = vi.fn(); writeText = vi.fn().mockResolvedValue(undefined);
    vi.stubGlobal('document', { createElement: () => new Element(), body: new Element(), execCommand: vi.fn().mockReturnValue(true) });
    vi.stubGlobal('navigator', { clipboard: { writeText } });
    request = vi.fn(async (command: StylesCommand) => {
      if (command.type === 'import') files.set(command.id, fileInfo(command.id, command.name, new TextEncoder().encode(command.css).length));
      if (command.type === 'remove') files.delete(command.id);
      return { snapshot: snapshot(), ...(command.type === 'match' ? { matching } : {}) };
    });
    controller = installProjectStyles(root as unknown as HTMLElement, { request }, send);
  });
  afterEach(() => { vi.clearAllTimers(); vi.useRealTimers(); vi.unstubAllGlobals(); });

  it('imports exact CSS as worker data without executing or injecting it and persists metadata only', async () => {
    const css = '@import "https://example.test/x.css"; .button{content:"<script>evil()</script>";width:10rem}';
    await importFiles(new File([css], 'project.css'));
    expect(request).toHaveBeenCalledWith({ type: 'import', id: 'project.css', name: 'project.css', css });
    expect(byClass('project-stats').textContent).toContain('1 imported files');
    expect(send).toHaveBeenCalledWith({ type: 'styles-profile-ready' });
    const saved = send.mock.calls.map(([message]) => message).find(message => message.type === 'save-styles-profile');
    expect(saved?.profile.remBase).toBe(10);
    expect(JSON.stringify(saved)).not.toContain(css);
    expect(descendants(root).some(item => ['style', 'script', 'iframe'].includes(item.type))).toBe(false);
  });
  it('replaces the same basename, refreshes retained snapshots and removes files', async () => {
    await importFiles(new File(['.a{}'], 'a.css'));
    await importFiles(new File(['.new{}'], 'a.css'));
    expect(byClass('project-stats').textContent).toContain('1 imported files');
    byText('Refresh imported files').click(); await flush();
    expect(request).toHaveBeenLastCalledWith({ type: 'refresh' });
    expect(byClass('project-status').textContent).toContain('Reselect a file');
    byText('Remove a.css').click(); await flush();
    expect(request).toHaveBeenCalledWith({ type: 'remove', id: 'a.css' });
    expect(byClass('project-stats').textContent).toContain('0 imported files');
  });
  it('offers per-file replacement preserving the existing file id', async () => {
    await importFiles(new File(['.a{}'], 'a.css'));
    const replace = byClass('project-file-replace');
    replace.files = [new File(['.b{}'], 'renamed.css')]; replace.listeners.get('change')?.(); await flush();
    expect(request).toHaveBeenCalledWith({ type: 'import', id: 'a.css', name: 'renamed.css', css: '.b{}' });
  });
  it('enforces file count, extension and bytes before parsing', async () => {
    await importFiles(...Array.from({ length: 9 }, (_, i) => new File(['x'], `${i}.css`)));
    expect(request).not.toHaveBeenCalled();
    await importFiles(new File(['x'], 'wrong.html'));
    expect(request).not.toHaveBeenCalled();
    await importFiles(new File(['x'.repeat(2 * 1024 * 1024 + 1)], 'huge.css'));
    expect(request).not.toHaveBeenCalled();
    expect(byClass('project-status').textContent).toContain('2 MiB');
  });
  it('restores metadata with a reimport notice, but late restore cannot overwrite edits', async () => {
    const profile: StylesProfile = { version: 1, name: 'Saved', remBase: 16, files: [fileInfo('saved.css', 'saved.css', 2)] };
    controller.restoreProfile(profile);
    expect(byClass('project-name').value).toBe('Saved');
    expect(byClass('project-stats').textContent).toContain('1 saved files need reimport');
    const input = byClass('project-name'); input.value = 'Edited'; input.listeners.get('input')?.();
    controller.restoreProfile({ ...profile, name: 'Late' });
    expect(input.value).toBe('Edited');
    expect(request).not.toHaveBeenCalled();
  });
  it('aligns editable profile name length with the host metadata validator', () => {
    const input = byClass('project-name');
    expect(input.maxLength).toBe(80);
    input.value = 'x'.repeat(120); input.listeners.get('input')?.();
    const saved = send.mock.calls.map(([message]) => message).filter(message => message.type === 'save-styles-profile');
    expect(saved[saved.length - 1]?.profile.name).toHaveLength(80);
  });
  it('replaces restored reminders only after a successful import and caps saved metadata', async () => {
    controller.restoreProfile({ version: 1, name: 'Saved', remBase: 10, files: Array.from({ length: 8 }, (_, i) => fileInfo(`${i}.css`, `${i}.css`, 2)) });
    await importFiles(new File(['x'], 'invalid.html'));
    expect(byClass('project-stats').textContent).toContain('8 saved files need reimport');
    await importFiles(new File(['.new{}'], 'new.css'));
    expect(byClass('project-stats').textContent).not.toContain('saved files need reimport');
    const saved = send.mock.calls.map(([message]) => message).filter(message => message.type === 'save-styles-profile');
    expect(saved[saved.length - 1]?.profile.files.map(file => file.name)).toEqual(['new.css']);
  });
  it('serializes asynchronous file imports instead of racing File reads and worker mutations', async () => {
    let finish: ((css: string) => void) | undefined;
    const first = new File(['.first{}'], 'first.css');
    const second = new File(['.second{}'], 'second.css');
    const firstText = vi.fn(() => new Promise<string>(resolve => { finish = resolve; }));
    const secondText = vi.fn().mockResolvedValue('.second{}');
    Object.defineProperty(first, 'text', { value: firstText });
    Object.defineProperty(second, 'text', { value: secondText });
    await importFiles(first); await importFiles(second);
    expect(firstText).toHaveBeenCalledOnce();
    expect(secondText).not.toHaveBeenCalled();
    finish?.('.first{}'); await flush();
    expect(secondText).toHaveBeenCalledOnce();
    expect(vi.mocked(request).mock.calls.map(([command]) => command.type === 'import' ? command.name : command.type)).toEqual(['first.css', 'second.css']);
  });
  it('selection changes match without reparsing and reject stale match results', async () => {
    await importFiles(new File(['.a{}'], 'a.css'));
    let finish: ((response: StylesResponse) => void) | undefined;
    const original = request;
    request = vi.fn(command => command.type === 'match' && command.node.id === 'old'
      ? new Promise<StylesResponse>(resolve => { finish = resolve; }) : original(command));
    // Client object delegates dynamically so queued replies can complete out of order.
    const secondRoot = new Element();
    controller = installProjectStyles(secondRoot as unknown as HTMLElement, { request: command => request(command) }, send);
    root = secondRoot;
    await importFiles(new File(['.a{}'], 'a.css'));
    controller.setSelection(node('old')); vi.advanceTimersByTime(120); await flush();
    controller.setSelection(node('new')); vi.advanceTimersByTime(120); await flush();
    finish?.({ snapshot: snapshot(), matching: { ...emptyMatch(), warnings: ['STALE RESULT'] } }); await flush();
    expect(descendants(root).some(item => item.textContent.includes('STALE RESULT'))).toBe(false);
    const importCalls = vi.mocked(original).mock.calls.filter(([command]) => command.type === 'import');
    expect(importCalls).toHaveLength(2);
  });
  it('gates class and override copying by category and copies raw safe class tokens', async () => {
    matching.matches = ['safe', 'conditional', 'unsupported'].map(category => ({
      classes: ['button', 'primary'], selector: '.button.primary', category: category as 'safe' | 'conditional' | 'unsupported', score: 90, confidence: 'high',
      matched: [], different: [{ property: 'width', figma: '100px', css: '90px' }], missing: [], incomparable: [], limitations: [], coverage: {}, override: 'width: 100px;',
    }));
    await importFiles(new File(['.a{}'], 'a.css'));
    controller.setSelection(node()); vi.advanceTimersByTime(120); await flush();
    const copyButtons = descendants(root).filter(item => item.textContent === 'Copy class');
    expect(copyButtons.map(item => item.disabled)).toEqual([false, true, true]);
    copyButtons[0]?.click(); await flush();
    expect(writeText).toHaveBeenLastCalledWith('button primary');
    expect(descendants(root).some(item => item.textContent === 'Copy override')).toBe(false);
    expect(byText('Override selector: .inspected-element')).toBeDefined();
    const choose = descendants(root).filter(item => item.textContent === 'Use for override');
    expect(choose.map(item => item.disabled)).toEqual([false, true, true]);
    choose[0]?.click();
    expect(byText('Override selector: .button.primary')).toBeDefined();
    byText('Copy override').click(); await flush();
    expect(writeText).toHaveBeenLastCalledWith('width: 100px;');
  });
  it('copies original contextual CSS and allows only unambiguous class tokens without implying an override', async () => {
    matching.matches = [{ classes: ['card'], selector: '.card', category: 'conditional', copyable: true,
      score: 60, confidence: 'low', matched: [], different: [], missing: [], incomparable: [], limitations: [], coverage: {},
      matchedCSS: '@media (max-width:600px) { .card {font-size:1.6rem;} }' }];
    await importFiles(new File(['.card{}'], 'a.css'));
    controller.setSelection(node()); vi.advanceTimersByTime(120); await flush();
    byText('Copy class').click(); await flush();
    expect(writeText).toHaveBeenLastCalledWith('card');
    byText('Copy matched CSS').click(); await flush();
    expect(writeText).toHaveBeenLastCalledWith(matching.matches[0]!.matchedCSS);
    byText('Use for override').click();
    expect(byText('No override needed')).toBeDefined();
    expect(descendants(root).some(item => item.textContent.startsWith('Override unavailable:'))).toBe(false);
    expect(byText('Selected by property similarity. Verify that this class applies on the page.')).toBeDefined();
    expect(descendants(root).some(item => item.textContent === 'Copy override')).toBe(false);
    controller.setSelection(node('new'));
    expect(byText('Override selector: .inspected-element')).toBeDefined();
  });
  it('still blocks contextual overrides when there are confirmed differences', async () => {
    matching.matches = [{ classes: ['card'], selector: '.card', category: 'conditional', copyable: true,
      score: 60, confidence: 'low', matched: [], different: [{ property: 'width', figma: '100px', css: '90px' }],
      missing: [], incomparable: [], limitations: [], coverage: {} }];
    await importFiles(new File(['.card{}'], 'a.css'));
    controller.setSelection(node()); vi.advanceTimersByTime(120); await flush();
    byText('Use for override').click();
    expect(byText('Override unavailable: conditional or unsupported rules require DOM/media context.')).toBeDefined();
    expect(descendants(root).some(item => item.textContent === 'No override needed' || item.textContent === 'Copy override')).toBe(false);
  });
  it('shows no override needed only after explicit selection when there are no confirmed differences', async () => {
    matching.matches = [{ classes: ['card'], selector: '.card', category: 'safe', score: 25, confidence: 'low',
      matched: [], different: [], missing: [{property: 'height', figma: '50px'}], incomparable: [], limitations: [], coverage: {} }];
    await importFiles(new File(['.card{}'], 'a.css'));
    controller.setSelection(node()); vi.advanceTimersByTime(120); await flush();
    expect(descendants(root).some(item => item.textContent === 'No override needed')).toBe(false);
    byText('Use for override').click();
    expect(byText('No override needed')).toBeDefined();
    expect(byText('Selected by property similarity. Verify that this class applies on the page.')).toBeDefined();
    expect(descendants(root).some(item => item.textContent === 'Copy override')).toBe(false);
  });
  it('copies safe variable declarations with a local fallback and blocks malformed class tokens', async () => {
    matching.matches = [{ classes: ['unsafe token'], selector: '.unsafe', category: 'safe', score: 1, confidence: 'low', matched: [], different: [], missing: [], incomparable: [], limitations: [], coverage: {} }];
    matching.variables = [{ property: 'color', variable: '--brand', declaration: 'color: var(--brand);', value: '#fff' }];
    await importFiles(new File(['.a{}'], 'a.css'));
    controller.setSelection(node()); vi.advanceTimersByTime(120); await flush();
    expect(byText('Copy class').disabled).toBe(true);
    writeText.mockRejectedValue(new Error('Denied'));
    byText('Copy declaration').click(); await flush();
    expect(descendants(root).some(item => item.textContent === 'Copied.')).toBe(true);
    expect(writeText).toHaveBeenLastCalledWith('color: var(--brand);');
  });
  it('copies decoded escaped utility class tokens without restricting safe punctuation or Unicode', async () => {
    matching.matches = [{ classes: ['w-1/2', 'hover:red', 'кнопка'], selector: '.w-1\\/2.hover\\:red.кнопка', category: 'safe', score: 80, confidence: 'medium', matched: [], different: [], missing: [], incomparable: [], limitations: [], coverage: {} }];
    await importFiles(new File(['.w-1\\/2{width:50px}'], 'utility.css'));
    controller.setSelection(node()); vi.advanceTimersByTime(120); await flush();
    expect(byText('Copy class').disabled).toBe(false);
    byText('Copy class').click(); await flush();
    expect(writeText).toHaveBeenLastCalledWith('w-1/2 hover:red кнопка');
  });
});
