import type { InspectorNode, InspectorState, RGBA, UIMessage } from '../shared/contracts';
import { parseInspectorMessage } from './messages';
import { generateDeclarations } from '../css/generate';

function element<T extends HTMLElement>(id: string): T {
  const result = document.getElementById(id);
  if (!result) throw new Error(`Missing UI element: ${id}`);
  return result as T;
}

const statePanel = element('state');
const inspector = element('inspector');
const copyButton = element<HTMLButtonElement>('copy');
const copyStatus = element('copy-status');
let currentCSS = '';
let copying = false;
let loadingTimeout: ReturnType<typeof setTimeout> | undefined;

function send(message: UIMessage): void {
  parent.postMessage({ pluginMessage: message }, '*');
}

const number = (value: number): string => String(Number(value.toFixed(3)));
const px = (value: number): string => `${number(value)} px`;
function color(value: RGBA): string {
  return `rgba(${Math.round(value.r * 255)}, ${Math.round(value.g * 255)}, ${Math.round(value.b * 255)}, ${number(value.a)})`;
}

function showProperties(node: InspectorNode): void {
  const rows: [string, string, string][] = [];
  const declarations = new Map(generateDeclarations(node).map(item => [item.property, item.declaration]));
  const add = (label: string, property: string, value: string | undefined): void => { if (value !== undefined) rows.push([label, property, value]); };
  add('Width', 'width', node.width === undefined ? undefined : px(node.width));
  add('Height', 'height', node.height === undefined ? undefined : px(node.height));
  if (node.layout) {
    add('Auto layout', 'flex-direction', node.layout.direction === 'row' ? 'Horizontal' : 'Vertical');
    add('Align items', 'align-items', node.layout.alignItems);
    add('Justify content', 'justify-content', node.layout.justifyContent);
    add('Gap', 'gap', node.layout.gap === undefined ? undefined : px(node.layout.gap));
    add('Padding', 'padding', node.layout.padding?.map(px).join(' / '));
  }
  if (node.backgroundColor) add('Background', 'background-color', color(node.backgroundColor));
  if (node.color) add('Text color', 'color', color(node.color));
  if (node.border) add('Border', 'border', `${px(node.border.width)} solid ${color(node.border.color)}`);
  if (node.borderRadius !== undefined) add('Radius', 'border-radius', Array.isArray(node.borderRadius) ? node.borderRadius.map(px).join(' / ') : px(node.borderRadius));
  if (node.opacity !== undefined) add('Opacity', 'opacity', `${number(node.opacity * 100)}%`);
  if (node.typography) {
    const text = node.typography;
    add('Font family', 'font-family', text.fontFamily);
    add('Font size', 'font-size', text.fontSize === undefined ? undefined : px(text.fontSize));
    add('Font weight', 'font-weight', text.fontWeight === undefined ? undefined : number(text.fontWeight));
    add('Line height', 'line-height', text.lineHeight ? `${number(text.lineHeight.value)}${text.lineHeight.unit}` : undefined);
    add('Letter spacing', 'letter-spacing', text.letterSpacing ? `${number(text.letterSpacing.value)}${text.letterSpacing.unit}` : undefined);
  }
  const properties = element('properties');
  properties.replaceChildren();
  for (const [label, property, value] of rows) {
    const row = document.createElement('div');
    row.className = 'property';
    const term = document.createElement('dt');
    term.textContent = label;
    const definition = document.createElement('dd');
    const displayValue = document.createElement('span');
    displayValue.className = 'property-value';
    displayValue.textContent = value;
    definition.append(displayValue);
    const declaration = declarations.get(property);
    if (declaration) addPropertyCopy(definition, property, declaration);
    row.append(term, definition);
    properties.append(row);
  }
  if (rows.length === 0) {
    const message = document.createElement('p');
    message.textContent = 'No supported properties are available for this element.';
    properties.append(message);
  }
}

function render(state: InspectorState): void {
  clearTimeout(loadingTimeout);
  loadingTimeout = undefined;
  if (state.status === 'loading') {
    loadingTimeout = setTimeout(() => {
      render({ status: 'error', message: 'Figma did not respond. Use Refresh selection (↻) to try again, or reopen the plugin.' });
    }, 8000);
  }
  inspector.hidden = state.status !== 'ready';
  statePanel.hidden = state.status === 'ready';
  currentCSS = '';
  copyStatus.textContent = '';
  if (state.status === 'ready') {
    element('node-name').textContent = state.node.name;
    element('node-type').textContent = state.node.type.replace(/_/g, ' ');
    showProperties(state.node);
    currentCSS = state.css;
    element('css-code').textContent = currentCSS;
    copyButton.disabled = !currentCSS || copying;
    const warnings = element('warnings');
    warnings.replaceChildren();
    for (const warning of state.node.warnings) {
      const item = document.createElement('li');
      item.textContent = warning;
      warnings.append(item);
    }
    element('warnings-section').hidden = state.node.warnings.length === 0;
    return;
  }
  copyButton.disabled = true;
  const descriptions: Record<Exclude<InspectorState['status'], 'ready'>, [string, string]> = {
    loading: ['Reading selection…', 'Your element properties will appear here.'],
    empty: ['Select an element', 'Choose a frame, text layer, or shape in your design to inspect its CSS.'],
    multiple: ['Choose one element', state.status === 'multiple' ? `${state.count} elements selected. This inspector supports one element at a time.` : ''],
    error: ['Unable to inspect element', state.status === 'error' ? state.message : ''],
  };
  const [title, description] = descriptions[state.status];
  element('state-title').textContent = title;
  element('state-description').textContent = description;
}

function fallbackCopy(text: string, focusTarget: HTMLElement | null = copyButton): boolean {
  const textarea = document.createElement('textarea');
  textarea.value = text;
  textarea.setAttribute('aria-label', 'CSS to copy');
  textarea.style.position = 'fixed';
  textarea.style.opacity = '0';
  document.body.append(textarea);
  textarea.focus();
  textarea.select();
  try { return document.execCommand('copy'); }
  finally {
    textarea.remove();
    focusTarget?.focus();
  }
}

function addPropertyCopy(container: HTMLElement, property: string, declaration: string): void {
  const button = document.createElement('button');
  button.type = 'button';
  button.className = 'property-copy';
  button.textContent = '⧉';
  button.title = `Copy ${declaration}`;
  button.setAttribute('aria-label', `Copy ${property} declaration`);
  const status = document.createElement('span');
  status.className = 'sr-only';
  status.setAttribute('role', 'status');
  status.setAttribute('aria-live', 'polite');
  container.append(button, status);
  let busy = false;
  button.addEventListener('click', () => {
    if (busy) return;
    busy = true;
    button.disabled = true;
    status.textContent = '';
    const copy = async (): Promise<void> => {
      let copied = false;
      let usedFallback = false;
      try {
        if (!navigator.clipboard?.writeText) throw new Error('Clipboard API unavailable');
        await navigator.clipboard.writeText(declaration);
        copied = true;
      } catch {
        usedFallback = true;
        try { copied = fallbackCopy(declaration, null); } catch { /* Report failure below. */ }
      } finally {
        busy = false;
        button.disabled = false;
        if (usedFallback && button.isConnected) button.focus();
      }
      // Each row owns its feedback; pending copies never update a new selection.
      if (!button.isConnected) return;
      button.textContent = copied ? '✓' : '⧉';
      button.className = copied ? 'property-copy is-copied' : 'property-copy';
      status.className = copied ? 'sr-only' : 'property-feedback';
      status.textContent = copied
        ? `${property} declaration copied to clipboard.`
        : 'Copy unavailable. Select the declaration in the CSS block and copy it manually.';
      if (copied) setTimeout(() => {
        button.textContent = '⧉';
        button.className = 'property-copy';
        status.textContent = '';
      }, 1600);
    };
    void copy();
  });
}

copyButton.addEventListener('click', () => {
  if (!currentCSS || copying) return;
  const text = currentCSS;
  copying = true;
  copyButton.disabled = true;
  const copy = async (): Promise<void> => {
    try {
      if (!navigator.clipboard?.writeText) throw new Error('Clipboard API unavailable');
      await navigator.clipboard.writeText(text);
      copyStatus.textContent = 'CSS copied to clipboard.';
    } catch {
      try {
        copyStatus.textContent = fallbackCopy(text) ? 'CSS copied to clipboard.' : 'Copy unavailable. Select the CSS above and copy it manually.';
      } catch {
        copyStatus.textContent = 'Copy unavailable. Select the CSS above and copy it manually.';
      }
    } finally {
      copying = false;
      copyButton.disabled = !currentCSS;
    }
  };
  void copy();
});

element('refresh').addEventListener('click', () => {
  render({ status: 'loading' });
  send({ type: 'refresh' });
});

window.addEventListener('message', (event: MessageEvent<unknown>) => {
  const state = parseInspectorMessage(event.data);
  if (state) render(state);
});

render({ status: 'loading' });
send({ type: 'ready' });
