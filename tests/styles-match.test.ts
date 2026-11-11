import { describe, expect, it } from 'vitest';
import { buildStyleIndex } from '../src/styles/index';
import { findMatches } from '../src/styles/match';
import { parseCSS } from '../src/styles/parser';
import type { InspectorNode } from '../src/shared/contracts';
import type { NormalizationOptions } from '../src/shared/project-styles';

const frame: InspectorNode = { id: '1', name: 'Frame', type: 'FRAME', width: 100, height: 50, warnings: [] };
function index(css: string, options: NormalizationOptions = {}) {
  return buildStyleIndex([parseCSS(css, { id: 'one', name: 'one.css' })], options);
}
function match(css: string, node: InspectorNode = frame, options: NormalizationOptions = {}) {
  return findMatches(node, index(css, options), options);
}

describe('project CSS indexing and matching', () => {
  it('retains unknown shorthand effects after a later known longhand', () => {
    const result = match('.card{width:100px;height:50px;background:linear-gradient(red,blue);background-color:red}', {
      ...frame, backgroundColor: { r: 1, g: 0, b: 0, a: 1 },
    });
    const card = result.matches[0]!;
    expect(card.incomparable).toContainEqual(expect.objectContaining({ property: 'background' }));
    expect(card.confidence).not.toBe('high');
    expect(card.override).toBeUndefined();
  });
  it('finds a reliable multi-property match without fabricating a browser cascade claim', () => {
    const result = match('.card { box-sizing: border-box; width:100px; height:50px }');
    expect(result.matches[0]).toMatchObject({ classes: ['card'], score: 100, confidence: 'high', category: 'safe', different: [], missing: [], incomparable: [] });
    expect(result.matches[0]?.override).toBeUndefined();
    expect(result.warnings.join(' ')).toContain('unimported styles');
  });
  it('merges repeated rules and imported files using source order and importance', () => {
    const first = parseCSS('.card { width:90px!important; height:40px } .card { height:45px }', { id: 'a', name: 'a.css' });
    const second = parseCSS('.card { width:100px; height:50px }', { id: 'b', name: 'b.css' });
    const result = findMatches(frame, buildStyleIndex([first, second]));
    expect(result.matches[0]?.different).toContainEqual({ property: 'width', figma: '100px', css: '90px' });
    expect(result.matches[0]?.matched.some(property => property.property === 'height')).toBe(true);
    expect(buildStyleIndex([first, second]).classes[0]?.sources).toHaveLength(3);
  });
  it('lets a later important declaration replace an earlier important declaration', () => {
    expect(match('.card {width:90px!important;height:50px}.card{width:100px!important}').matches[0]?.different).toEqual([]);
  });
  it('keeps one-property utilities low-confidence even at complete coverage', () => {
    const result = match('.w {width:100px}', { ...frame, height: undefined });
    expect(result.matches[0]?.confidence).toBe('low');
    expect(result.matches[0]?.score).toBeLessThanOrEqual(25);
    expect(result.matches[0]?.limitations.join(' ')).toContain('never an exact match');
    expect(result.matches[0]?.override).toBeUndefined();
  });
  it('does not inflate a padding or radius utility into multiple meaningful matching groups', () => {
    const node: InspectorNode = { ...frame, width: undefined, height: undefined, borderRadius: 8,
      layout: { direction: 'row', padding: [8, 8, 8, 8] } };
    const result = match('.rounded {border-radius:8px}.p{padding:8px}', node);
    expect(result.matches.filter(item => item.classes.length === 1).every(item => item.confidence === 'low')).toBe(true);
  });
  it('combines complementary classes and reports each class coverage', () => {
    const result = match('.w{width:100px}.h{height:50px}');
    const pair = result.matches.find(item => item.classes.length === 2);
    expect(pair).toMatchObject({ score: 100, confidence: 'high', category: 'safe' });
    expect(pair?.coverage.w).toEqual(['width']);
    expect(pair?.coverage.h).toEqual(['height']);
  });
  it('resolves pair conflicts through imported source order and explains them', () => {
    const result = match('.first{width:90px;height:50px}.second{width:100px;color:red}', { ...frame, color: { r: 1, g: 0, b: 0, a: 1 } });
    const pair = result.matches.find(item => item.classes.length === 2);
    expect(pair?.different).toEqual([]);
    expect(pair?.limitations.join(' ')).toContain('conflict on width');
    expect(pair?.coverage.first).not.toContain('width');
    expect(pair?.coverage.second).toContain('width');
  });
  it('uses important when pair source order would otherwise choose a different value', () => {
    const node: InspectorNode = { ...frame, color: { r: 1, g: 0, b: 0, a: 1 } };
    const result = match('.first{width:100px!important;height:50px}.second{width:90px;color:red}', node);
    expect(result.matches.find(item => item.classes.length === 2)?.different).toEqual([]);
  });
  it('generates only confirmed differing declarations and preserves important conflicts', () => {
    const result = match('.card{box-sizing:border-box;width:100px;height:50px;color:blue!important}', {
      ...frame, color: { r: 1, g: 0, b: 0, a: 1 }, opacity: 0.5,
    });
    expect(result.matches[0]?.override).toBe('.card {\n  color: rgb(255, 0, 0) !important;\n}');
  });
  it('keeps unknown CSS values incomparable rather than equating matching raw strings', () => {
    const result = match('.card{width:100px;height:50px;color:currentColor}', { ...frame, color: { r: 0, g: 0, b: 0, a: 1 } });
    expect(result.matches[0]?.incomparable).toContainEqual(expect.objectContaining({ property: 'color', css: 'currentColor' }));
    expect(result.matches[0]?.override).toBeUndefined();
  });
  it('lists missing, differing and unsupported imported properties separately', () => {
    const result = match('.card{width:100px;opacity:.2;transform:rotate(10deg)}', { ...frame, opacity: 0.5 });
    expect(result.matches[0]?.matched.some(item => item.property === 'width')).toBe(true);
    expect(result.matches[0]?.different.some(item => item.property === 'opacity')).toBe(true);
    expect(result.matches[0]?.missing.some(item => item.property === 'height')).toBe(true);
    expect(result.matches[0]?.incomparable.some(item => item.property === 'transform')).toBe(true);
  });
  it.each([
    '.card:hover{width:80px}', '@media(min-width:600px){.card{height:80px}}',
    '.card.active{width:80px}', '.parent .card{width:80px}',
    '@layer utilities{.card{width:80px!important}}', '.card{& .nested{width:80px}}',
  ])('never treats contextual rules as exact or emits their override: %s', extra => {
    const result = match(`.card{width:100px;height:50px}${extra}`);
    const card = result.matches.find(item => item.classes.length === 1 && item.classes[0] === 'card');
    // Nested rules may target only .nested, but their own candidates remain contextual.
    if (extra.includes('& .nested')) {
      expect(index(extra).classes.find(item => item.className === 'nested')?.category).not.toBe('safe');
    } else {
      expect(card?.category).not.toBe('safe');
      expect(card?.confidence).toBe('low');
      expect(card?.override).toBeUndefined();
    }
  });
  it('does not downgrade a class for a hover rule unrelated to comparable properties', () => {
    expect(match('.card{width:100px;height:50px}.card:hover{cursor:pointer}').matches[0]?.category).toBe('safe');
  });
  it('blocks overrides when global rules or all/revert can affect compared values', () => {
    for (const css of ['*{width:80px}', 'div{height:80px}', '.card{all:revert}', ':root{font-size:20px}']) {
      const result = match(`.card{width:100px;height:50px}${css}`);
      expect(result.matches[0]?.override).toBeUndefined();
      expect(result.matches[0]?.confidence).not.toBe('high');
    }
  });
  it('normalizes equivalent colors, lengths and font-weight values through the same engine', () => {
    const result = match('.card{width:100.0px;height:50px;color:#ff0000;font-weight:bold}', {
      ...frame, color: { r: 1, g: 0, b: 0, a: 1 }, typography: { fontWeight: 700 },
    });
    expect(result.matches[0]?.different).toEqual([]);
    expect(result.matches[0]?.incomparable).toEqual([]);
    expect(result.matches[0]?.confidence).toBe('high');
  });
  it('keeps rem unknown until a base is supplied and the index is rebuilt for changed settings', () => {
    const css = '.card{width:6.25rem;height:3.125rem;color:red}';
    const built = index(css);
    const node = { ...frame, color: { r: 1, g: 0, b: 0, a: 1 } };
    expect(findMatches(node, built).matches[0]?.incomparable.some(item => item.property === 'width')).toBe(true);
    expect(findMatches(node, index(css, { remBase: 16 }), { remBase: 16 }).matches[0]?.different).toEqual([]);
    expect(findMatches(node, index(css, { remBase: 16 }), { remBase: 16 }).matches[0]?.incomparable).toEqual([]);
    expect(findMatches(node, index(css, { remBase: 20 }), { remBase: 20 }).matches[0]?.different.some(item => item.property === 'width')).toBe(true);
  });
  it('compares shorthand gap/padding/border/radius expansions to Figma CSS', () => {
    const node: InspectorNode = { ...frame, borderRadius: 8, border: { width: 1, color: { r: 0, g: 0, b: 0, a: 1 } },
      layout: { direction: 'row', gap: 8, padding: [4, 8, 4, 8] } };
    const result = match('.card{width:100px;height:50px;display:flex;flex-direction:row;gap:8px;padding:4px 8px;border:1px solid #000;border-radius:8px}', node);
    expect(result.matches[0]?.different).toEqual([]);
    expect(result.matches[0]?.incomparable).toEqual([]);
    expect(result.matches[0]?.matched.some(item => item.property === 'row-gap')).toBe(true);
  });
  it('resolves certain root variables and suggests only normalized equivalent tokens', () => {
    const css = ':root{--size:100px;--tone:#f00;--other:blue}.card{width:var(--size);height:50px;color:var(--tone)}';
    const result = match(css, { ...frame, color: { r: 1, g: 0, b: 0, a: 1 } });
    expect(result.matches[0]?.incomparable).toEqual([]);
    expect(result.variables).toContainEqual({ property: 'color', variable: '--tone', declaration: 'color: var(--tone);', value: 'rgba(255, 0, 0, 1)' });
    expect(result.variables.some(item => item.variable === '--other')).toBe(false);
  });
  it('honors root variable important/file cascade and blocks scoped or conditional redefinitions', () => {
    const css = ':root{--tone:red!important}:root{--tone:blue}.theme{--tone:green}.card{width:100px;height:50px;color:var(--tone,red)}';
    const result = match(css, { ...frame, color: { r: 1, g: 0, b: 0, a: 1 } });
    expect(index(css).variables['--tone']).toBeUndefined();
    expect(result.variables).toEqual([]);
    expect(result.matches[0]?.incomparable.some(item => item.property === 'color')).toBe(true);
    expect(result.matches[0]?.override).toBeUndefined();
    const safe = index(':root{--tone:red!important}:root{--tone:blue}');
    expect(safe.variables['--tone']).toBe('red');
    expect(index(':root{--tone:red}@media(print){:root{--tone:blue}}').variables['--tone']).toBeUndefined();
  });
  it('does not assume unknown variable fallback or cyclic variable scope is certain', () => {
    for (const css of ['.card{width:100px;height:50px;color:var(--unknown,red)}', ':root{--a:var(--b);--b:var(--a)}.card{width:100px;height:50px;color:var(--a,red)}']) {
      const result = match(css, { ...frame, color: { r: 1, g: 0, b: 0, a: 1 } });
      expect(result.matches[0]?.incomparable.some(item => item.property === 'color')).toBe(true);
      expect(result.variables).toEqual([]);
    }
  });
  it('keeps coverage records safe for prototype-like names and escapes copied CSS selectors', () => {
    const css = '.__proto__{width:100px;height:50px}.constructor{width:100px;height:50px}.a\\:b{width:100px;height:50px}.按钮{width:100px;height:50px}';
    const result = match(css);
    const dangerous = result.matches.find(item => item.classes[0] === '__proto__');
    expect(Object.getPrototypeOf(dangerous?.coverage)).toBe(null);
    expect(dangerous?.coverage.__proto__).toContain('width');
    expect(result.matches.find(item => item.classes[0] === 'a:b')?.selector).toBe('.a\\:b');
    expect(result.matches.find(item => item.classes[0] === '按钮')?.category).toBe('safe');
    expect({}.constructor).toBe(Object);
  });
  it('bounds result count and returns deterministic candidates for large utility sets', () => {
    const css = Array.from({ length: 30 }, (_, i) => `.w${i}{width:100px}.h${i}{height:50px}`).join('');
    const built = index(css);
    const first = findMatches(frame, built);
    const second = findMatches(frame, built);
    expect(first.matches.length).toBeLessThanOrEqual(12);
    expect(first).toEqual(second);
    expect(first.warnings.join(' ')).toContain('at most 40 pairs');
  });
  it('does not mutate imported stylesheet records or Figma data', () => {
    const parsed = parseCSS('.card{width:100px;height:50px}', { id: 'a', name: 'a.css' });
    const before = JSON.stringify(parsed);
    const node = JSON.stringify(frame);
    findMatches(frame, buildStyleIndex([parsed]));
    expect(JSON.stringify(parsed)).toBe(before);
    expect(JSON.stringify(frame)).toBe(node);
  });
  it('bounds unique classes independently of the number of rules', () => {
    const parsed = parseCSS('.a{width:100px}', { id: 'a', name: 'a.css' });
    parsed.rules[0]!.selectors = Array.from({ length: 12001 }, (_, i) => ({
      text: `.c${i}`, classes: [`c${i}`], kind: 'simple' as const, specificity: [0, 1, 0] as [number, number, number],
    }));
    expect(() => buildStyleIndex([parsed])).toThrow('12000 unique classes');
  });
  it('bounds expanded shorthand components before indexing them', () => {
    const parsed = parseCSS(`.a{${'border:1px solid red;'.repeat(8400)}}`, { id: 'a', name: 'a.css' });
    expect(() => buildStyleIndex([parsed])).toThrow('100000 normalized declaration components');
  });
  it('bounds declaration multiplication across selector lists', () => {
    const selector = Array.from({ length: 501 }, (_, i) => `.c${i}`).join(',');
    const declarations = Array.from({ length: 200 }, (_, i) => `unknown-${i}:1;`).join('');
    const parsed = parseCSS(`${selector}{${declarations}}`, { id: 'a', name: 'a.css' });
    expect(() => buildStyleIndex([parsed])).toThrow('100000 indexed class declaration components');
  });
  it('bounds branching variable graphs without exponentially expanding known definitions', () => {
    const variables = Array.from({ length: 25 }, (_, i) => `--v${i}:var(--v${i + 1}) var(--v${i + 1});`).join('');
    const built = index(`:root{${variables}--v25:red}.card{width:100px;height:50px;color:var(--v0)}`);
    const result = findMatches({ ...frame, color: { r: 1, g: 0, b: 0, a: 1 } }, built);
    expect(result.matches[0]?.incomparable.some(item => item.property === 'color')).toBe(true);
    expect(result.matches[0]?.override).toBeUndefined();
    expect(result.variables.some(item => item.variable === '--v0')).toBe(false);
  });
  it('bounds candidate detail payloads without treating unknown extras as evidence', () => {
    const extra = Array.from({ length: 5000 }, (_, i) => `unknown-${i}:${i};`).join('');
    const result = match(`.a{width:100px;${extra}}.b{height:50px;${extra}}`);
    expect(result.matches.length).toBeGreaterThan(0);
    for (const candidate of result.matches) {
      expect(candidate.incomparable.length).toBeLessThanOrEqual(80);
      expect(candidate.score).toBeLessThanOrEqual(candidate.classes.length === 1 ? 25 : 100);
      expect(candidate.confidence).toBe('low');
      expect(candidate.override).toBeUndefined();
      expect(candidate.limitations.join(' ')).toContain('additional incomparable properties omitted');
    }
  });
  it('treats unloaded imports as unknown cascade rather than safe override context', () => {
    const result = match('@import "missing.css";:root{--tone:red}.card{width:100px;height:50px}', { ...frame, opacity: 0.5 });
    expect(result.matches[0]?.category).toBe('conditional');
    expect(result.matches[0]?.override).toBeUndefined();
    expect(result.variables).toEqual([]);
  });
  it('excludes root token suggestions when property registration leaves inheritance unknown', () => {
    const parsed = parseCSS('@property --tone{syntax:"<color>";inherits:false;initial-value:blue}:root{--tone:red}.card{width:100px;height:50px;color:var(--tone)}', { id: 'a', name: 'a.css' });
    expect(parsed.registeredVariables).toContain('--tone');
    const result = findMatches({ ...frame, color: { r: 1, g: 0, b: 0, a: 1 } }, buildStyleIndex([parsed]));
    expect(result.variables).toEqual([]);
    expect(result.matches[0]?.incomparable.some(item => item.property === 'color')).toBe(true);
    expect(result.matches[0]?.override).toBeUndefined();
  });
});
