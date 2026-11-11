import { describe, expect, it } from 'vitest';
import { parseCSS } from '../src/styles/parser';
import { buildStyleIndex } from '../src/styles/index';
import { findMatches } from '../src/styles/match';
import { normalizeDeclarations } from '../src/styles/normalize';
import type { InspectorNode } from '../src/shared/contracts';

// Minimal synthetic reproduction, independent of the ignored production bundle.
const fixture = `.cookie-banner__text{margin:0 0 10px;font-size:16px;font-weight:400;line-height:1.45;letter-spacing:-.01em}
@media(max-width:600px){.cookie-banner__text{font-size:14px;margin-bottom:16px}}`;
const node: InspectorNode = { id: 'text', name: 'Text', type: 'TEXT', opacity: 1, warnings: [], typography: {
  fontFamily: 'Averta CY', fontSize: 16, fontWeight: 400,
  lineHeight: { unit: '%', value: 145 }, letterSpacing: { unit: 'em', value: -0.01 },
} };
const parse = (css: string) => parseCSS(css, { id: 'test', name: 'test.css' });
const results = (css: string) => findMatches(node, buildStyleIndex([parse(css)], { remBase: 10 }), { remBase: 10 });
const cookie = (css = fixture) => results(css).matches.find(m => m.classes[0] === 'cookie-banner__text')!;

describe('typography matching regression', () => {
  it('extracts compiled simple selectors and preserves separate media declarations', () => {
    const rules = parse(fixture).rules;
    expect(rules[0]?.selectors[0]?.text).toBe('.cookie-banner__text');
    expect(rules[0]?.declarations).toHaveLength(5);
    expect(rules[0]?.conditions).toEqual([]);
    expect(rules[1]?.conditions[0]).toContain('@media');
    expect(rules[1]?.selectors[0]?.kind).toBe('conditional');
  });
  it('matches four typography properties without inheriting a font family', () => {
    const result = cookie();
    expect(result.matched.map(p => p.property)).toEqual(['font-size', 'font-weight', 'line-height', 'letter-spacing']);
    expect(result.matched.find(p => p.property === 'line-height')?.css).toBe('23.2px');
    expect(result.matched.find(p => p.property === 'letter-spacing')?.css).toBe('-0.16px');
    expect(result.missing.map(p => p.property)).toContain('font-family');
    expect(result.category).toBe('conditional');
    expect(result.confidence).toBe('low');
    expect(result.override).toBeUndefined();
  });
  it('normalizes percentage and unitless line-height to the same own-font-size ratio', () => {
    const norm = (value: string) => normalizeDeclarations([{ property: 'line-height', value, order: 0, important: false }])[0]?.normalized;
    expect(norm('145%')).toBe(norm('1.45'));
    expect(norm('1.45')).toBe('1.45em');
    expect(cookie(fixture.replace('1.45', '145%')).matched).toEqual(cookie().matched);
  });
  it('requires each candidate own font size and does not compare relative lengths blindly', () => {
    const unknown = results('.x{font-weight:400;line-height:1.45;letter-spacing:-.01em}').matches[0]!;
    expect(unknown.incomparable.map(p => p.property)).toEqual(expect.arrayContaining(['line-height', 'letter-spacing']));
    const different = results('.x{font-size:20px;font-weight:400;line-height:1.45;letter-spacing:-.01em}').matches[0]!;
    expect(different.different.map(p => p.property)).toEqual(expect.arrayContaining(['line-height', 'letter-spacing']));
  });
  it('does not equate Averta CY and Averta', () => {
    expect(cookie(fixture.replace('margin:0 0 10px;', 'font-family:Averta;')).different.map(p => p.property)).toContain('font-family');
  });
  it('ranks informative typography above dozens of default-opacity matches deterministically', () => {
    const noise = Array.from({ length: 80 }, (_, i) => `.noise${i}{opacity:1;font-size:16px;font-weight:400;line-height:1.2;letter-spacing:0}`).join('');
    const css = noise + fixture;
    expect(results(css).matches[0]?.classes).toEqual(['cookie-banner__text']);
    expect(results(css)).toEqual(results(css));
    expect(cookie(css).score).toBe(80);
    expect(cookie(fixture.replace('margin:0 0 10px;', 'opacity:1;')).score).toBe(cookie().score);
  });
  it('keeps global rules separate and does not claim contextual declarations apply', () => {
    const result = cookie('body{font-family:Averta;font-size:16px}.parent .cookie-banner__text{color:red}' + fixture);
    expect(result.category).toBe('conditional');
    expect(result.missing.map(p => p.property)).toContain('font-family');
    expect(result.confidence).toBe('low');
    expect(result.override).toBeUndefined();
  });
});
