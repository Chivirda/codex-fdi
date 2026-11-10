import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { parseInspectorMessage } from '../src/ui/messages';

const ready = { status: 'ready', node: { id: '1', name: 'Frame', type: 'FRAME', width: 100, warnings: [] }, css: '.inspected-element { width: 100px; }' };
const envelope = (state: unknown): unknown => ({ pluginMessage: { type: 'inspector-state', state } });

class MockElement {
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
  let body: MockElement;
  const descendants = (root: MockElement): MockElement[] => root.children.flatMap(child => [child, ...descendants(child)]);
  const propertyButton = (property: string): MockElement | undefined => descendants(elements.get('properties')!).find(item => item.attributes.get('aria-label') === `Copy ${property} declaration`);
  const receive = (state: unknown): void => messageListener({ source: null, data: envelope(state) });
  const settle = async (): Promise<void> => { await Promise.resolve(); await Promise.resolve(); await Promise.resolve(); };
  beforeEach(async () => {
    vi.resetModules();
    vi.useFakeTimers();
    elements = new Map();
    body = new MockElement();
    writeText.mockReset().mockResolvedValue(undefined);
    execCommand.mockReset().mockReturnValue(true);
    vi.stubGlobal('navigator', { clipboard: { writeText } });
    vi.stubGlobal('document', {
      getElementById: (id: string) => {
        if (!elements.has(id)) elements.set(id, new MockElement());
        return elements.get(id);
      },
      createElement: () => new MockElement(),
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
  it('rejects unrelated, incomplete and nonfinite payloads', () => {
    for (const value of [null, ready, {}, envelope({ status: 'ready' }), envelope({ status: 'error', message: 5 }), envelope({ status: 'multiple', count: NaN }), envelope({ ...ready, node: { ...ready.node, width: Infinity } })]) {
      expect(parseInspectorMessage(value)).toBeUndefined();
    }
  });
});
