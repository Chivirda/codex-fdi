import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { parseInspectorMessage, parseResizeError } from '../src/ui/messages';

// File/worker controls have separate tests; keep existing inspector interaction tests isolated.
vi.mock('../src/ui/project-styles', () => ({ installProjectStyles: () => ({ setSelection: () => {}, restoreProfile: () => {} }) }));

const ready = { status: 'ready', node: { id: '1', name: 'Frame', type: 'FRAME', width: 100, warnings: [] }, css: '.inspected-element { width: 100px; }' };
const spacing = { status: 'ready', parentName: 'Card', parentType: 'FRAME', values: { top: 24, right: 56, bottom: 80, left: 24, x: 24, y: 24, width: 120, height: 64 }, warnings: ['Rotated bounds are projected.'] };
const envelope = (state: unknown): unknown => ({ pluginMessage: { type: 'inspector-state', state } });

class MockElement {
  constructor(public tagName = '') {}
  hidden = false;
  disabled = false;
  textContent = '';
  className = '';
  type = '';
  title = '';
  value = '';
  style: Record<string, string> = {};
  isConnected = true;
  children: MockElement[] = [];
  attributes = new Map<string, string>();
  successfulFocus = false;
  focus = vi.fn(() => { if (!this.disabled) this.successfulFocus = true; });
  select = vi.fn();
  listeners = new Map<string, () => void>();
  append(...children: MockElement[]): void { this.children.push(...children); }
  replaceChildren(): void {
    const detach = (child: MockElement): void => { child.isConnected = false; child.children.forEach(detach); };
    this.children.forEach(detach);
    this.children = [];
  }
  setAttribute(name: string, value: string): void { this.attributes.set(name, value); }
  remove(): void { this.isConnected = false; }
  addEventListener(type: string, listener: () => void): void { this.listeners.set(type, listener); }
}

describe('UI host transport', () => {
  let elements: Map<string, MockElement>;
  let messageListener: (event: { source: unknown; data: unknown }) => void;
  const postMessage = vi.fn();
  const writeText = vi.fn<(...args: string[]) => Promise<void>>();
  const execCommand = vi.fn();
  const clipboardSetData = vi.fn();
  const copyPreventDefault = vi.fn();
  let copyListeners: Set<(event: { clipboardData: { setData: typeof clipboardSetData }; preventDefault: typeof copyPreventDefault }) => void>;
  let body: MockElement;
  const descendants = (root: MockElement): MockElement[] => root.children.flatMap(child => [child, ...descendants(child)]);
  const propertyButton = (property: string): MockElement | undefined => descendants(elements.get('properties')!).find(item => item.attributes.get('aria-label') === `Copy ${property} declaration`);
  const spacingButton = (key: string): MockElement | undefined => descendants(elements.get('spacing-values')!).find(item => item.attributes.get('aria-label') === `Copy spacing ${key} value`);
  const receive = (state: unknown): void => messageListener({ source: null, data: envelope(state) });
  const settle = async (): Promise<void> => { await Promise.resolve(); await Promise.resolve(); await Promise.resolve(); };
  beforeEach(async () => {
    vi.resetModules();
    vi.useFakeTimers();
    elements = new Map();
    body = new MockElement();
    writeText.mockReset().mockResolvedValue(undefined);
    copyListeners = new Set();
    clipboardSetData.mockReset();
    copyPreventDefault.mockReset();
    execCommand.mockReset().mockImplementation(() => {
      for (const listener of copyListeners) listener({ clipboardData: { setData: clipboardSetData }, preventDefault: copyPreventDefault });
      return true;
    });
    vi.stubGlobal('navigator', { clipboard: { writeText } });
    vi.stubGlobal('document', {
      getElementById: (id: string) => {
        if (!elements.has(id)) elements.set(id, new MockElement());
        return elements.get(id);
      },
      createElement: (tagName: string) => new MockElement(tagName.toUpperCase()),
      addEventListener: (type: string, listener: (event: { clipboardData: { setData: typeof clipboardSetData }; preventDefault: typeof copyPreventDefault }) => void) => { if (type === 'copy') copyListeners.add(listener); },
      removeEventListener: (type: string, listener: (event: { clipboardData: { setData: typeof clipboardSetData }; preventDefault: typeof copyPreventDefault }) => void) => { if (type === 'copy') copyListeners.delete(listener); },
      body,
      execCommand,
    });
    vi.stubGlobal('parent', { postMessage });
    vi.stubGlobal('window', { addEventListener: (type: string, listener: typeof messageListener) => { if (type === 'message') messageListener = listener; } });
    await import('../src/ui/index');
  });
  afterEach(() => {
    vi.clearAllTimers();
    vi.useRealTimers();
    vi.unstubAllGlobals();
    vi.clearAllMocks();
  });
  it('renders a Figma relay with null source and cancels loading timeout', () => {
    expect(postMessage).toHaveBeenCalledWith({ pluginMessage: { type: 'ready' } }, '*');
    messageListener({ source: null, data: envelope(ready) });
    expect(elements.get('inspector')?.hidden).toBe(false);
    expect(elements.get('node-name')?.textContent).toBe('Frame');
    expect(elements.get('css-code')?.textContent).toBe(ready.css);
    vi.advanceTimersByTime(9000);
    expect(elements.get('inspector')?.hidden).toBe(false);
  });
  it('ends loading on timeout and recovers through refresh and a host response', () => {
    vi.advanceTimersByTime(8000);
    expect(elements.get('state-title')?.textContent).toBe('Unable to inspect element');
    expect(elements.get('state-description')?.textContent).toContain('Refresh selection');
    elements.get('refresh')?.listeners.get('click')?.();
    expect(elements.get('state-title')?.textContent).toBe('Reading selection…');
    expect(postMessage).toHaveBeenCalledWith({ pluginMessage: { type: 'refresh' } }, '*');
    messageListener({ source: {}, data: envelope({ status: 'empty' }) });
    vi.advanceTimersByTime(9000);
    expect(elements.get('state-title')?.textContent).toBe('Select an element');
  });
  it('copies the exact generated property declaration with native keyboard button semantics', async () => {
    receive(ready);
    const button = propertyButton('width')!;
    expect(button.type).toBe('button');
    expect(button.attributes.get('aria-label')).toBe('Copy width declaration');
    expect(button.listeners.has('keydown')).toBe(false); // Native buttons dispatch click for Enter/Space.
    button.listeners.get('click')?.();
    await settle();
    expect(writeText).toHaveBeenCalledWith('width: 100px;');
    expect(button.textContent).toBe('✓');
    const status = descendants(elements.get('properties')!).find(item => item.attributes.get('role') === 'status');
    expect(status?.textContent).toBe('width declaration copied to clipboard.');
    vi.advanceTimersByTime(1600);
    expect(button.textContent).toBe('⧉');
  });
  it('maps human property values to exact CSS declarations for layout, opacity and typography', async () => {
    receive({ ...ready, node: {
      ...ready.node,
      opacity: 0.5,
      layout: { direction: 'column', padding: [1, 2, 3, 4] },
      typography: { fontFamily: 'A "Quoted" Font' },
    } });
    const expected = [
      ['opacity', 'opacity: 0.5;'],
      ['padding', 'padding: 1px 2px 3px 4px;'],
      ['font-family', String.raw`font-family: "A \"Quoted\" Font";`],
      ['flex-direction', 'flex-direction: column;'],
    ];
    for (const [property, declaration] of expected) {
      const button = propertyButton(property!)!;
      button.listeners.get('click')?.();
      await settle();
      expect(writeText).toHaveBeenLastCalledWith(declaration);
    }
  });
  it('shows a property value without a copy button when CSS cannot represent it', () => {
    receive({ ...ready, node: { ...ready.node, width: -1 } });
    expect(propertyButton('width')).toBeUndefined();
    expect(descendants(elements.get('properties')!).some(item => item.textContent === '-1 px')).toBe(true);
  });
  it('uses the fallback for a rejected clipboard API and restores focus to the row button', async () => {
    writeText.mockRejectedValue(new Error('Denied'));
    receive(ready);
    const button = propertyButton('width')!;
    button.listeners.get('click')?.();
    await settle();
    expect(execCommand).toHaveBeenCalledWith('copy');
    expect(body.children[body.children.length - 1]?.value).toBe('width: 100px;');
    expect(button.focus).toHaveBeenCalledOnce();
    expect(button.successfulFocus).toBe(true);
    expect(button.textContent).toBe('✓');
  });
  it('reports failed clipboard and fallback copying without a false success', async () => {
    writeText.mockRejectedValue(new Error('Denied'));
    execCommand.mockReturnValue(false);
    receive(ready);
    const button = propertyButton('width')!;
    button.listeners.get('click')?.();
    await settle();
    expect(button.textContent).toBe('⧉');
    const status = descendants(elements.get('properties')!).find(item => item.attributes.get('role') === 'status');
    expect(status?.textContent).toContain('Copy unavailable.');
    expect(status?.className).toBe('property-feedback');
  });
  it('does not attach pending property-copy feedback to a new selection', async () => {
    let finish: (() => void) | undefined;
    writeText.mockReturnValue(new Promise<void>(resolve => { finish = resolve; }));
    receive(ready);
    propertyButton('width')!.listeners.get('click')?.();
    receive({ ...ready, node: { ...ready.node, id: '2', width: 200 } });
    finish?.();
    await settle();
    expect(propertyButton('width')?.textContent).toBe('⧉');
    expect(elements.get('copy-status')?.textContent).toBe('');
  });
  it('preserves whole-block Copy CSS success and fallback behavior', async () => {
    receive(ready);
    elements.get('copy')?.listeners.get('click')?.();
    await settle();
    expect(writeText).toHaveBeenCalledWith(ready.css);
    expect(elements.get('copy-status')?.textContent).toBe('CSS copied to clipboard.');
    writeText.mockRejectedValue(new Error('Denied'));
    elements.get('copy')?.listeners.get('click')?.();
    await settle();
    expect(body.children[body.children.length - 1]?.value).toBe(ready.css);
    expect(elements.get('copy-status')?.textContent).toBe('CSS copied to clipboard.');
  });
  it('renders six copyable spacing measurements as a diagram without duplicating dimensions from Properties', async () => {
    receive({ ...ready, node: { ...ready.node, height: 50, spacing } });
    expect(elements.get('spacing-parent')?.textContent).toBe('Parent: Card · FRAME');
    expect(elements.get('spacing-warnings')?.children[0]?.textContent).toContain('Rotated bounds');
    const diagram = elements.get('spacing-values')!;
    expect(diagram.className).toBe('spacing-diagram');
    expect(diagram.children.filter(item => /^spacing-cell spacing-(top|right|bottom|left)$/.test(item.className))).toHaveLength(4);
    expect(diagram.children.find(item => item.className === 'spacing-center')?.textContent).toBe('Selected');
    expect(diagram.children.find(item => item.className === 'spacing-coordinates')?.children).toHaveLength(2);
    const coordinates = diagram.children.find(item => item.className === 'spacing-coordinates')!;
    expect(coordinates.attributes.get('role')).toBe('group');
    expect(coordinates.attributes.get('aria-label')).toBe('Coordinates');
    for (const cell of descendants(diagram).filter(item => item.className.startsWith('spacing-cell '))) {
      expect(cell.tagName).toBe('DL');
      expect(cell.children.map(item => item.tagName)).toEqual(['DT', 'DD']);
    }
    expect(descendants(diagram).filter(item => item.attributes.get('aria-label')?.startsWith('Copy spacing '))).toHaveLength(6);
    expect(spacingButton('width')).toBeUndefined();
    expect(spacingButton('height')).toBeUndefined();
    expect(descendants(elements.get('properties')!).some(item => item.textContent === '100 px')).toBe(true);
    expect(descendants(elements.get('properties')!).some(item => item.textContent === '50 px')).toBe(true);
    expect(propertyButton('width')).toBeDefined();
    expect(propertyButton('height')).toBeDefined();
    for (const key of ['top', 'right', 'bottom', 'left', 'x', 'y'] as const) {
      spacingButton(key)?.listeners.get('click')?.();
      await settle();
      expect(writeText).toHaveBeenLastCalledWith(`${spacing.values[key]}px`);
    }
  });
  it('switches spacing units, edits rem base and preserves settings across selection changes', async () => {
    receive({ ...ready, node: { ...ready.node, spacing } });
    expect(elements.get('spacing-base-settings')?.hidden).toBe(true);
    elements.get('spacing-rem')?.listeners.get('click')?.();
    expect(elements.get('spacing-base-settings')?.hidden).toBe(false);
    expect(elements.get('spacing-rem')?.attributes.get('aria-pressed')).toBe('true');
    spacingButton('top')?.listeners.get('click')?.();
    await settle();
    expect(writeText).toHaveBeenLastCalledWith('2.4rem');
    elements.get('spacing-base')!.value = '12';
    elements.get('spacing-base')?.listeners.get('input')?.();
    receive({ ...ready, node: { ...ready.node, id: '2', spacing } });
    spacingButton('top')?.listeners.get('click')?.();
    await settle();
    expect(writeText).toHaveBeenLastCalledWith('2rem');
    expect(spacing.values.top).toBe(24);
    expect(elements.get('spacing-base')?.value).toBe('12');
    elements.get('spacing-px')?.listeners.get('click')?.();
    expect(elements.get('spacing-base-settings')?.hidden).toBe(true);
    expect(elements.get('spacing-base')?.value).toBe('12');
    elements.get('spacing-rem')?.listeners.get('click')?.();
    expect(elements.get('spacing-base-settings')?.hidden).toBe(false);
    expect(elements.get('spacing-base')?.value).toBe('12');
  });
  it('disables spacing copy for invalid rem bases and recovers in px or after correction', async () => {
    receive({ ...ready, node: { ...ready.node, spacing } });
    elements.get('spacing-rem')?.listeners.get('click')?.();
    for (const base of ['', '0', '-2', 'Infinity', 'no']) {
      elements.get('spacing-base')!.value = base;
      elements.get('spacing-base')?.listeners.get('input')?.();
      expect(spacingButton('top')?.disabled).toBe(true);
      expect(elements.get('spacing-base-error')?.textContent).toContain('greater than 0');
      spacingButton('top')?.listeners.get('click')?.();
      expect(writeText).not.toHaveBeenCalled();
    }
    elements.get('spacing-px')?.listeners.get('click')?.();
    expect(spacingButton('top')?.disabled).toBe(false);
    expect(elements.get('spacing-base-error')?.hidden).toBe(true);
    spacingButton('top')?.listeners.get('click')?.();
    await settle();
    expect(writeText).toHaveBeenLastCalledWith('24px');
    elements.get('spacing-base')!.value = '16';
    elements.get('spacing-base')?.listeners.get('input')?.();
    elements.get('spacing-rem')?.listeners.get('click')?.();
    expect(elements.get('spacing-base-error')?.hidden).toBe(true);
    expect(spacingButton('top')?.disabled).toBe(false);
  });
  it('shows unsupported spacing instead of stale rows or parent data', () => {
    receive({ ...ready, node: { ...ready.node, spacing } });
    receive({ ...ready, node: { ...ready.node, spacing: { status: 'unsupported', message: 'No parent bounds.' } } });
    expect(elements.get('spacing-unsupported')?.textContent).toBe('No parent bounds.');
    expect(elements.get('spacing-values')?.children).toHaveLength(0);
    expect(elements.get('spacing-parent')?.hidden).toBe(true);
    expect(elements.get('spacing-warnings')?.children).toHaveLength(0);
  });
  it('reports rem conversion overflow for a tiny finite base and recovers', async () => {
    receive({ ...ready, node: { ...ready.node, spacing } });
    elements.get('spacing-rem')?.listeners.get('click')?.();
    elements.get('spacing-base')!.value = '5e-324';
    elements.get('spacing-base')?.listeners.get('input')?.();
    expect(elements.get('spacing-base-error')?.hidden).toBe(false);
    expect(elements.get('spacing-base-error')?.textContent).toContain('too small');
    expect(spacingButton('top')?.disabled).toBe(true);
    spacingButton('top')?.listeners.get('click')?.();
    expect(writeText).not.toHaveBeenCalled();
    elements.get('spacing-px')?.listeners.get('click')?.();
    expect(elements.get('spacing-base-error')?.hidden).toBe(true);
    spacingButton('top')?.listeners.get('click')?.();
    await settle();
    expect(writeText).toHaveBeenLastCalledWith('24px');
    elements.get('spacing-base')!.value = '16';
    elements.get('spacing-base')?.listeners.get('input')?.();
    elements.get('spacing-rem')?.listeners.get('click')?.();
    expect(elements.get('spacing-base-error')?.hidden).toBe(true);
    spacingButton('top')?.listeners.get('click')?.();
    await settle();
    expect(writeText).toHaveBeenLastCalledWith('1.5rem');
  });
  it('supports spacing clipboard fallback and reports copy errors locally', async () => {
    writeText.mockRejectedValue(new Error('Denied'));
    receive({ ...ready, node: { ...ready.node, spacing } });
    spacingButton('top')?.listeners.get('click')?.();
    await settle();
    expect(body.children[body.children.length - 1]?.value).toBe('24px');
    expect(spacingButton('top')?.textContent).toBe('✓');
    expect(spacingButton('top')?.successfulFocus).toBe(true);
    execCommand.mockReturnValue(false);
    spacingButton('right')?.listeners.get('click')?.();
    await settle();
    const messages = descendants(elements.get('spacing-values')!).filter(item => item.attributes.get('role') === 'status');
    expect(messages.some(item => item.textContent.includes('Copy unavailable.'))).toBe(true);
    expect(elements.get('copy-status')?.textContent).toBe('');
  });
  it('does not apply pending spacing feedback or fallback after switching selections', async () => {
    let reject: ((reason: Error) => void) | undefined;
    writeText.mockReturnValue(new Promise<void>((_resolve, rejectPromise) => { reject = rejectPromise; }));
    receive({ ...ready, node: { ...ready.node, spacing } });
    spacingButton('top')?.listeners.get('click')?.();
    receive({ status: 'empty' });
    reject?.(new Error('Denied'));
    await settle();
    expect(execCommand).not.toHaveBeenCalled();
    expect(elements.get('spacing-values')?.children).toHaveLength(0);
  });
  it('copies exact text including empty strings, whitespace, line breaks and Unicode', async () => {
    for (const characters of ['', '  leading and trailing  ', 'line one\nline two\r\n', 'Привет 👩🏽‍💻 漢字\t✓']) {
      receive({ ...ready, node: { ...ready.node, type: 'TEXT', characters } });
      const button = elements.get('copy-text')!;
      expect(button.hidden).toBe(false);
      button.listeners.get('click')?.();
      await settle();
      expect(writeText).toHaveBeenLastCalledWith(characters);
      expect(button.textContent).toBe('Copied ✓');
      expect(elements.get('copy-text-status')?.textContent).toBe('Text copied to clipboard.');
    }
    vi.advanceTimersByTime(1600);
    expect(elements.get('copy-text')?.textContent).toBe('Copy Text');
  });
  it('hides Copy Text for non-text nodes, missing text and empty selection', () => {
    for (const node of [ready.node, { ...ready.node, characters: 'unexpected' }, { ...ready.node, type: 'TEXT' }]) {
      receive({ ...ready, node });
      expect(elements.get('copy-text')?.hidden).toBe(true);
      elements.get('copy-text')?.listeners.get('click')?.();
    }
    receive({ status: 'empty' });
    expect(elements.get('copy-text')?.hidden).toBe(true);
    expect(writeText).not.toHaveBeenCalled();
  });
  it('provides the full layer name as a tooltip safely', () => {
    const name = '<img src=x>Very long layer name '.repeat(30);
    receive({ ...ready, node: { ...ready.node, name } });
    expect(elements.get('node-name')?.textContent).toBe(name);
    expect(elements.get('node-name')?.title).toBe(name);
  });
  it('falls back when text clipboard API rejects and reports failures locally', async () => {
    writeText.mockRejectedValue(new Error('Denied'));
    receive({ ...ready, node: { ...ready.node, type: 'TEXT', characters: '  exact\ntext 👋  ' } });
    elements.get('copy-text')?.listeners.get('click')?.();
    await settle();
    expect(body.children[body.children.length - 1]?.value).toBe('  exact\ntext 👋  ');
    expect(elements.get('copy-text')?.successfulFocus).toBe(true);
    expect(elements.get('copy-text-status')?.textContent).toBe('Text copied to clipboard.');
    execCommand.mockReturnValue(false);
    elements.get('copy-text')?.listeners.get('click')?.();
    await settle();
    expect(elements.get('copy-text-status')?.textContent).toContain('Copy unavailable.');
    expect(elements.get('copy-text')?.disabled).toBe(false);
    expect(elements.get('copy-status')?.textContent).toBe('');
    vi.advanceTimersByTime(1600);
    expect(elements.get('copy-text-status')?.textContent).toContain('Copy unavailable.');
  });
  it('copies exact CRLF and empty text through the fallback copy event and removes its listener', async () => {
    writeText.mockRejectedValue(new Error('Denied'));
    for (const text of ['original\r\nline\r\n', '']) {
      receive({ ...ready, node: { ...ready.node, type: 'TEXT', characters: text } });
      elements.get('copy-text')?.listeners.get('click')?.();
      await settle();
      expect(clipboardSetData).toHaveBeenLastCalledWith('text/plain', text);
      expect(copyPreventDefault).toHaveBeenCalled();
      expect(copyListeners.size).toBe(0);
      expect(elements.get('copy-text-status')?.textContent).toBe('Text copied to clipboard.');
      if (!text) expect(body.children[body.children.length - 1]?.value).toBe(' ');
    }
  });
  it('reports an unverifiable text fallback as failure and cleans up after missing events or exceptions', async () => {
    writeText.mockRejectedValue(new Error('Denied'));
    receive({ ...ready, node: { ...ready.node, type: 'TEXT', characters: 'exact\r\ntext' } });
    execCommand.mockReturnValue(true); // Browser claims success but sends no copy event.
    elements.get('copy-text')?.listeners.get('click')?.();
    await settle();
    expect(elements.get('copy-text-status')?.textContent).toContain('Copy unavailable.');
    expect(copyListeners.size).toBe(0);
    execCommand.mockImplementation(() => { throw new Error('Copy denied'); });
    elements.get('copy-text')?.listeners.get('click')?.();
    await settle();
    expect(elements.get('copy-text-status')?.textContent).toContain('Copy unavailable.');
    expect(copyListeners.size).toBe(0);
    expect(body.children[body.children.length - 1]?.isConnected).toBe(false);
  });
  it('does not apply stale text-copy success or fallback to a changed selection', async () => {
    let finish: (() => void) | undefined;
    writeText.mockReturnValue(new Promise<void>(resolve => { finish = resolve; }));
    receive({ ...ready, node: { ...ready.node, type: 'TEXT', characters: 'old' } });
    elements.get('copy-text')?.listeners.get('click')?.();
    receive({ ...ready, node: { ...ready.node, type: 'TEXT', characters: 'new' } });
    finish?.();
    await settle();
    expect(elements.get('copy-text')?.textContent).toBe('Copy Text');
    expect(elements.get('copy-text-status')?.textContent).toBe('');
    let reject: ((reason: Error) => void) | undefined;
    writeText.mockReturnValue(new Promise<void>((_resolve, rejectPromise) => { reject = rejectPromise; }));
    elements.get('copy-text')?.listeners.get('click')?.();
    receive({ status: 'empty' });
    reject?.(new Error('Denied'));
    await settle();
    expect(execCommand).not.toHaveBeenCalled();
    expect(elements.get('copy-text-status')?.textContent).toBe('');
  });
  it('shows resize errors in footer without rerendering selection or copy feedback', async () => {
    receive(ready);
    elements.get('copy')?.listeners.get('click')?.();
    await settle();
    messageListener({ source: null, data: { pluginMessage: { type: 'resize-error', message: 'Unable to resize. Try again.' } } });
    expect(elements.get('resize-status')?.textContent).toBe('Unable to resize. Try again.');
    expect(elements.get('inspector')?.hidden).toBe(false);
    expect(elements.get('copy-status')?.textContent).toBe('CSS copied to clipboard.');
    expect(elements.get('node-name')?.textContent).toBe('Frame');
    messageListener({ source: null, data: { pluginMessage: { type: 'resize-error', message: 42 } } });
    expect(elements.get('resize-status')?.textContent).toBe('Unable to resize. Try again.');
  });
  it('ignores malformed host payloads without leaving the loading state', () => {
    messageListener({ source: null, data: envelope({ ...ready, node: { ...ready.node, layout: { direction: 'row', padding: 'invalid' } } }) });
    expect(elements.get('state-title')?.textContent).toBe('Reading selection…');
  });
});

describe('message validation', () => {
  it('accepts supported state envelopes', () => {
    for (const state of [ready, { status: 'loading' }, { status: 'empty' }, { status: 'multiple', count: 2 }, { status: 'error', message: 'Failed' }]) {
      expect(parseInspectorMessage(envelope(state))).toEqual(state);
    }
  });
  it('validates optional text content and resize error envelopes', () => {
    expect(parseInspectorMessage(envelope({ ...ready, node: { ...ready.node, type: 'TEXT', characters: '' } }))).toBeDefined();
    expect(parseInspectorMessage(envelope({ ...ready, node: { ...ready.node, characters: 42 } }))).toBeUndefined();
    expect(parseResizeError({ pluginMessage: { type: 'resize-error', message: 'Failed' } })).toBe('Failed');
    expect(parseResizeError({ pluginMessage: { type: 'resize-error', message: null } })).toBeUndefined();
  });
  it('validates nested spacing payloads and finite values', () => {
    expect(parseInspectorMessage(envelope({ ...ready, node: { ...ready.node, spacing } }))).toBeDefined();
    for (const invalid of [null, { ...spacing, parentName: 3 }, { ...spacing, warnings: ['ok', 1] }, { ...spacing, values: { ...spacing.values, x: NaN } }, { ...spacing, values: { top: 1 } }, { status: 'unsupported', message: false }]) {
      expect(parseInspectorMessage(envelope({ ...ready, node: { ...ready.node, spacing: invalid } }))).toBeUndefined();
    }
  });
  it('rejects unrelated, incomplete and nonfinite payloads', () => {
    for (const value of [null, ready, {}, envelope({ status: 'ready' }), envelope({ status: 'error', message: 5 }), envelope({ status: 'multiple', count: NaN }), envelope({ ...ready, node: { ...ready.node, width: Infinity } })]) {
      expect(parseInspectorMessage(value)).toBeUndefined();
    }
  });
});
