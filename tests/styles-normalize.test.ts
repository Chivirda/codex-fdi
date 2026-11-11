import { describe, expect, it } from 'vitest';
import { normalizeDeclarations } from '../src/styles/normalize';
import type { ImportedDeclaration, NormalizationOptions } from '../src/shared/project-styles';
const normalize = (property: string, value: string, options: NormalizationOptions = {}): ImportedDeclaration[] => normalizeDeclarations([{ property, value, order: 3, important: true }], options);
const values = (property: string, value: string, options?: NormalizationOptions): Record<string, string | undefined> => Object.fromEntries(normalize(property, value, options).map(item => [item.property, item.normalized]));

describe('CSS normalization', () => {
  it('expands box shorthands and preserves order/importance', () => {
    expect(values('padding', '1px 2px 3px')).toEqual({ 'padding-top': '1px', 'padding-right': '2px', 'padding-bottom': '3px', 'padding-left': '2px' });
    expect(values('margin', '-1rem 0', { remBase: 16 })['margin-top']).toBe('-16px');
    expect(normalize('padding', '1px').every(item => item.order === 3 && item.important)).toBe(true);
  });
  it('expands border, side border and independent elliptical radii', () => {
    expect(values('border', '2px solid #f00')['border-top-color']).toBe('rgba(255, 0, 0, 1)');
    expect(values('border-left', 'red solid 1rem', { remBase: 16 })).toEqual({ 'border-left-width': '16px', 'border-left-style': 'solid', 'border-left-color': 'rgba(255, 0, 0, 1)' });
    expect(values('border-radius', '4px 8px / 2px')['border-top-right-radius']).toBe('8px 2px');
    expect(normalize('border', 'solid').find(item => item.property === 'border-top-color')?.reason).toContain('context');
  });
  it('canonicalizes colors and safely recognizes only single-color backgrounds', () => {
    for (const raw of ['red', '#f00', 'rgb(255 0 0)', 'hsl(0,100%,50%)', 'hwb(0 0% 0%)']) expect(values('color', raw).color).toBe('rgba(255, 0, 0, 1)');
    expect(values('background', 'transparent')).toEqual({ 'background-color': 'rgba(0, 0, 0, 0)' });
    expect(normalize('background', 'url(x.png) center/cover red')[0]?.reason).toBeTruthy();
    expect(normalize('color', 'currentColor')[0]?.normalized).toBeUndefined();
  });
  it('uses an explicit rem base and never assumes em, percentage or calc context', () => {
    expect(values('width', '2rem', { remBase: 16 }).width).toBe('32px');
    for (const raw of ['2rem', '2em', '50%', 'calc(20px + 2px)', 'auto', 'inherit']) {
      expect(normalize('width', raw)[0]?.normalized).toBeUndefined();
      expect(normalize('width', raw)[0]?.reason).toBeTruthy();
    }
    expect(values('line-height', '1.5')['line-height']).toBe('1.5em');
    expect(values('letter-spacing', '-1px')['letter-spacing']).toBe('-1px');
    expect(values('width', '-1px').width).toBeUndefined();
    for (const raw of ['0nonsense', '0%', '0em', '1.px']) expect(normalize('width', raw)[0]?.normalized).toBeUndefined();
    expect(normalize('font-weight', '0x190')[0]?.normalized).toBeUndefined();
    expect(values('width', '0.00000001px').width).toBe('1e-8px');
  });
  it('normalizes font weights, quoted/unquoted families and a basic font shorthand', () => {
    expect(values('font-weight', 'bold')['font-weight']).toBe('700');
    expect(values('font-weight', 'normal')['font-weight']).toBe('400');
    expect(values('font-family', '"Open Sans", sans-serif')).toEqual(values('font-family', 'Open Sans,sans-serif'));
    expect(values('font-family', '"A \\"Quoted\\" Font"')['font-family']).toBe('"a \\"quoted\\" font"');
    const font = values('font', 'italic bold 16px/24px "Open Sans", sans-serif');
    expect(font['font-size']).toBe('16px');
    expect(font['line-height']).toBe('24px');
    expect(font['font-weight']).toBe('700');
    expect(font['font-family']).toBe('"open sans", "sans-serif"');
    expect(normalize('font', 'caption')[0]?.reason).toBeTruthy();
  });
  it('resolves only supplied variables, supports fallbacks and preserves original value', () => {
    const actual = normalize('color', 'var(--brand, blue)', { variables: { '--brand': 'var(--token)', '--token': '#f00' } });
    expect(actual[0]?.value).toBe('var(--brand, blue)');
    expect(actual[0]?.normalized).toBe('rgba(255, 0, 0, 1)');
    expect(values('color', 'var(--missing, rgb(0, 0, 255))').color).toBe('rgba(0, 0, 255, 1)');
    expect(normalize('color', 'var(--missing)')[0]?.reason).toContain('Unresolved');
    expect(values('padding', 'var(--space)', { variables: { '--space': '4px 8px' } })['padding-right']).toBe('8px');
  });
  it('detects cycles and never uses an internal fallback to validate a cyclic definition', () => {
    const options = { variables: { '--a': 'var(--b)', '--b': 'var(--a, red)' } };
    expect(normalize('color', 'var(--a)', options)[0]?.reason).toContain('Cyclic');
    expect(values('color', 'var(--a, blue)', options).color).toBe('rgba(0, 0, 255, 1)');
  });
  it('bounds branching variable graphs before exponential expansion can allocate or recurse', () => {
    const variables: Record<string, string> = { '--v25': '1px' };
    for (let index = 24; index >= 0; index--) variables[`--v${index}`] = `var(--v${index + 1}) var(--v${index + 1})`;
    const started = performance.now();
    const actual = normalize('padding', 'var(--v0)', { variables });
    expect(actual[0]?.normalized).toBeUndefined();
    expect(actual[0]?.reason).toMatch(/too large|budget/);
    expect(performance.now() - started).toBeLessThan(1000);
  });
  it('expands flex flow and gap and retains unsupported raw declarations', () => {
    expect(values('flex-flow', 'wrap column')).toEqual({ 'flex-direction': 'column', 'flex-wrap': 'wrap' });
    expect(values('gap', '8px 16px')).toEqual({ 'row-gap': '8px', 'column-gap': '16px' });
    expect(normalize('transform', 'rotate(20deg)')[0]).toMatchObject({ value: 'rotate(20deg)', normalized: undefined, reason: expect.any(String) });
    expect(normalize('padding', '1px 2px 3px 4px 5px')[0]?.value).toBe('1px 2px 3px 4px 5px');
  });
});
