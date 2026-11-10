import type { SpacingResult, SpacingKey } from '../shared/spacing';
import { formatSpacingValue } from '../spacing/units';

const keys: SpacingKey[] = ['top', 'right', 'bottom', 'left', 'x', 'y'];

export function installSpacingInspector(get: <T extends HTMLElement>(id: string) => T, fallbackCopy: (text: string) => boolean): (spacing?: SpacingResult) => void {
  const rows = get('spacing-values');
  const parent = get('spacing-parent');
  const unsupported = get('spacing-unsupported');
  const warningList = get('spacing-warnings');
  const error = get('spacing-base-error');
  const pxButton = get<HTMLButtonElement>('spacing-px');
  const remButton = get<HTMLButtonElement>('spacing-rem');
  const baseInput = get<HTMLInputElement>('spacing-base');
  const baseSettings = get('spacing-base-settings');
  rows.className = 'spacing-diagram';
  baseInput.value = '10';
  let unit: 'px' | 'rem' = 'px';
  let current: SpacingResult | undefined;
  let version = 0;

  const render = (): void => {
    const renderVersion = ++version;
    rows.replaceChildren();
    warningList.replaceChildren();
    pxButton.setAttribute('aria-pressed', String(unit === 'px'));
    remButton.setAttribute('aria-pressed', String(unit === 'rem'));
    baseSettings.hidden = unit === 'px';
    const base = Number(baseInput.value);
    const invalidBase = unit === 'rem' && (!baseInput.value.trim() || !Number.isFinite(base) || base <= 0);
    const values = current?.status === 'ready' ? current.values : undefined;
    const overflow = unit === 'rem' && !invalidBase && values !== undefined
      && keys.some(key => formatSpacingValue(values[key], unit, base) === undefined);
    const invalid = invalidBase || overflow;
    error.textContent = invalidBase ? 'Enter a finite base greater than 0 px to use rem.'
      : overflow ? 'This base is too small to format these values in rem. Increase the base or switch to px.' : '';
    error.hidden = !invalid;
    baseInput.setAttribute('aria-invalid', String(invalid));
    unsupported.hidden = current?.status === 'ready';
    unsupported.textContent = current?.status === 'unsupported' ? current.message : 'Spacing is unavailable for this selection.';
    parent.hidden = current?.status !== 'ready';
    parent.textContent = current?.status === 'ready' ? `Parent: ${current.parentName} · ${current.parentType.replace(/_/g, ' ')}` : '';
    rows.hidden = current?.status !== 'ready';
    if (current?.status !== 'ready') return;
    for (const warning of current.warnings) {
      const item = document.createElement('li');
      item.textContent = warning;
      warningList.append(item);
    }
    const center = document.createElement('div');
    center.className = 'spacing-center';
    center.textContent = 'Selected';
    center.setAttribute('aria-hidden', 'true');
    const coordinates = document.createElement('div');
    coordinates.className = 'spacing-coordinates';
    coordinates.setAttribute('role', 'group');
    coordinates.setAttribute('aria-label', 'Coordinates');
    for (const key of keys) {
      const value = invalid ? undefined : formatSpacingValue(current.values[key], unit, base);
      const row = document.createElement('dl');
      row.className = `spacing-cell spacing-${key}`;
      const label = document.createElement('dt');
      label.textContent = key[0]!.toUpperCase() + key.slice(1);
      const cell = document.createElement('dd');
      const display = document.createElement('span');
      display.textContent = value ?? '—';
      display.className = 'spacing-value';
      const button = document.createElement('button');
      button.type = 'button';
      button.className = 'property-copy';
      button.textContent = '⧉';
      button.disabled = value === undefined;
      button.title = value === undefined ? 'Enter a valid rem base to copy' : `Copy ${value}`;
      button.setAttribute('aria-label', `Copy spacing ${key} value`);
      const status = document.createElement('span');
      status.className = 'sr-only';
      status.setAttribute('role', 'status');
      status.setAttribute('aria-live', 'polite');
      let busy = false;
      button.addEventListener('click', () => {
        if (busy || value === undefined || renderVersion !== version) return;
        busy = true;
        button.disabled = true;
        status.textContent = '';
        const copy = async (): Promise<void> => {
          let copied = false;
          let usedFallback = false;
          try {
            if (!navigator.clipboard?.writeText) throw new Error('Clipboard API unavailable');
            await navigator.clipboard.writeText(value);
            copied = true;
          } catch {
            if (renderVersion !== version) return;
            usedFallback = true;
            try { copied = fallbackCopy(value); } catch { /* Show local error below. */ }
          } finally {
            busy = false;
            button.disabled = false;
          }
          if (renderVersion !== version || !button.isConnected) return;
          if (usedFallback) button.focus();
          button.textContent = copied ? '✓' : '⧉';
          button.className = copied ? 'property-copy is-copied' : 'property-copy';
          status.className = copied ? 'sr-only' : 'property-feedback';
          status.textContent = copied ? `${key} value copied: ${value}` : 'Copy unavailable. Select this value and copy it manually.';
          if (copied) setTimeout(() => {
            if (renderVersion !== version) return;
            button.textContent = '⧉';
            button.className = 'property-copy';
            status.textContent = '';
          }, 1600);
        };
        void copy();
      });
      cell.append(display, button, status);
      row.append(label, cell);
      if (key === 'x' || key === 'y') coordinates.append(row);
      else rows.append(row);
    }
    rows.append(center, coordinates);
  };
  pxButton.addEventListener('click', () => { unit = 'px'; render(); });
  remButton.addEventListener('click', () => { unit = 'rem'; render(); });
  baseInput.addEventListener('input', render);
  return (spacing): void => { current = spacing; render(); };
}
