import { describe, expect, it } from 'vitest';
import { equivalent, formatMatchValue } from '../src/styles/numeric';
import { parseCSS } from '../src/styles/parser';
import { buildStyleIndex } from '../src/styles/index';
import { findMatches } from '../src/styles/match';
import type { InspectorNode } from '../src/shared/contracts';
const node: InspectorNode = { id: 'n', name: 'Text', type: 'TEXT', warnings: [], typography: {
  fontSize: 16, fontWeight: 400, lineHeight: { unit: 'px', value: 23.2000007629395 }, letterSpacing: { unit: 'px', value: -0.160000002384 },
} };
const match = (css: string, base = 10, selected = node) => findMatches(selected,
  buildStyleIndex([parseCSS(css, { id: 'main', name: 'main.css' })], { remBase: base }), { remBase: base }).matches[0]!;
describe('numeric matching and class source actions', () => {
  it('compares compatible numeric values with unit-specific tolerances, not substrings', () => {
    expect(equivalent('line-height', '23.2000007629395px', '23.2px')).toBe(true);
    expect(equivalent('width', '23.21px', '23.2px')).toBe(false);
    expect(equivalent('width', '123.2px', '23.2px')).toBe(false);
    expect(equivalent('width', '1em', '1px')).toBe(false);
    expect(equivalent('opacity', '0.5000001', '0.5')).toBe(true);
    expect(equivalent('opacity', '0.5001', '0.5')).toBe(false);
    expect(equivalent('font-weight', '400.00001', '400')).toBe(false);
    expect(equivalent('color', 'rgba(1, 2, 3, 1)', 'rgba(1, 2, 4, 1)')).toBe(false);
  });
  it('formats UI separately without altering the internal value', () => {
    const result = match('.text{font-size:16px;font-weight:400;line-height:23.2px;letter-spacing:-.16px}');
    const height = result.matched.find(p => p.property === 'line-height')!;
    expect(height.figma).toBe('23.2000007629395px');
    expect(formatMatchValue(height.figma)).toBe('23.2px');
    expect(formatMatchValue('-0.160000002384px')).toBe('-0.16px');
    expect(result.override).toBeUndefined();
  });
  it('normalizes project rem font-size and all supported line-height units with known own font-size', () => {
    for (const height of ['23.2px', '145%', '1.45em', '1.45']) {
      const result = match(`.text{font-size:1.6rem;font-weight:400;line-height:${height};letter-spacing:-.01em}`);
      expect(result.matched.map(p => p.property)).toEqual(['font-size', 'font-weight', 'line-height', 'letter-spacing']);
      expect(result.override).toBeUndefined();
    }
    expect(match('.text{font-size:1rem;font-weight:400;line-height:1.45;letter-spacing:-.01em}', 16).different).toEqual([]);
  });
  it('keeps parent-dependent font sizes and unresolvable lengths incomparable', () => {
    for (const size of ['1em', '100%', 'calc(8px + 8px)']) {
      const result = match(`.text{font-size:${size};font-weight:400;line-height:1.45;letter-spacing:-.01em}`);
      expect(result.incomparable.map(p => p.property)).toEqual(expect.arrayContaining(['font-size', 'line-height', 'letter-spacing']));
      expect(result.override).toBeUndefined();
    }
  });
  it('copies source values, importance, duplicate declarations and conditional contexts', () => {
    const result = match('.text{font-size:1.6rem;font-size:16px!important;font-weight:400;line-height:1.45;letter-spacing:-.01em}@media(max-width:600px){.text{font-size:14px}}');
    expect(result.matchedCSS).toContain('font-size: 1.6rem;\n  font-size: 16px !important;');
    expect(result.matchedCSS).toContain('line-height: 1.45;');
    expect(result.matchedCSS).toContain('@media (max-width:600px) {');
    expect(result.matchedCSS).toContain('font-size: 14px;');
    expect(result.matchedCSS).not.toContain('23.200000');
    expect(result.copyable).toBe(true);
    expect(result.category).toBe('conditional');
    expect(result.override).toBeUndefined();
    expect(match('.parent .text{font-size:16px;font-weight:400}').copyable).toBe(false);
  });
  it('keeps original source order when copying a combination of classes', () => {
    const selected: InspectorNode = { id: 'n', name: 'Frame', type: 'FRAME', width: 100, height: 50, warnings: [] };
    const index = buildStyleIndex([parseCSS('.a{width:90px}.b{height:50px}.a{width:100px}', { id: 'main', name: 'main.css' })]);
    const pair = findMatches(selected, index).matches.find(m => m.classes.length === 2)!;
    expect(pair.matchedCSS!.indexOf('width: 90px')).toBeLessThan(pair.matchedCSS!.indexOf('height: 50px'));
    expect(pair.matchedCSS!.indexOf('height: 50px')).toBeLessThan(pair.matchedCSS!.indexOf('width: 100px'));
  });
  it('generates only confirmed differences, never missing declarations', () => {
    const result = match('.text{font-size:16px;font-weight:400;line-height:24px}');
    expect(result.override).toBe('.text {\n  line-height: 23.2px;\n}');
    expect(result.override).not.toContain('letter-spacing');
  });
});
