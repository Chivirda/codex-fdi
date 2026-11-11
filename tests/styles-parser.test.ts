import { describe, expect, it } from 'vitest';
import { parseCSS } from '../src/styles/parser';
import { CSS_LIMITS } from '../src/shared/project-styles';
const file = { id: 'file-1', name: 'project.css' };

describe('CSS stylesheet parser', () => {
  it('parses minified lists, escaped classes, duplicate declarations and importance', () => {
    const actual = parseCSS('.p-4,.hover\\:red{padding:4px;color:red!important;color:blue}', file);
    expect(actual.rules).toHaveLength(1);
    expect(actual.rules[0]?.selectors.map(item => [item.classes, item.kind, item.specificity])).toEqual([
      [['p-4'], 'simple', [0, 1, 0]], [['hover:red'], 'simple', [0, 1, 0]],
    ]);
    expect(actual.rules[0]?.declarations.map(item => [item.property, item.value, item.important])).toEqual([
      ['padding', '4px', false], ['color', 'red', true], ['color', 'blue', false],
    ]);
    expect(actual.rules[0]?.source).toEqual({ fileId: file.id, fileName: file.name, line: 1, column: 1 });
  });
  it('preserves conditional ancestry and never treats nested classes as unconditional', () => {
    const actual = parseCSS('@layer theme{@media(min-width:40rem){.card{color:red;&:hover{color:blue}.child{padding:2px}}}}', file);
    expect(actual.rules).toHaveLength(3);
    expect(actual.rules[0]?.conditions).toEqual(['@layer theme', '@media (min-width:40rem)']);
    expect(actual.rules[0]?.selectors[0]?.kind).toBe('conditional');
    expect(actual.rules[1]?.conditions).toContain('selector(.card)');
    expect(actual.rules[1]?.selectors[0]?.kind).toBe('unsupported');
    expect(actual.rules[2]?.selectors[0]?.kind).toBe('conditional');
  });
  it('extracts variable scopes, condition, case and declaration source locations', () => {
    const actual = parseCSS(':root{--Accent: red}\n@supports(display:grid){.card{--accent:blue!important;color:var(--Accent)}}', file);
    expect(actual.variables.map(item => [item.name, item.selectors, item.conditions, item.important])).toEqual([
      ['--Accent', [':root'], [], false], ['--accent', ['.card'], ['@supports (display:grid)'], true],
    ]);
    expect(actual.variables[1]?.source.line).toBe(2);
  });
  it('uses selector AST specificity for compounds, where, is and nth-child of', () => {
    const actual = parseCSS('.a:hover > #id:is(.b,div)::before,.c:where(#ignored),.x:nth-child(2n of .a,#b){color:red}', file);
    expect(actual.rules[0]?.selectors.map(item => item.specificity)).toEqual([[1, 3, 1], [0, 1, 0], [1, 2, 0]]);
    expect(actual.rules[0]?.selectors.every(item => item.kind === 'conditional')).toBe(true);
  });
  it('excludes keyframes and never loads imports', () => {
    const actual = parseCSS('@import url("https://example.invalid/x.css");@keyframes spin{from{opacity:0}to{opacity:1}}.safe{color:red}', file);
    expect(actual.rules).toHaveLength(1);
    expect(actual.rules[0]?.selectors[0]?.classes).toEqual(['safe']);
    expect(actual.warnings.join(' ')).toContain('not loaded');
    expect(actual.warnings.join(' ')).toContain('Keyframes');
  });
  it('rejects invalid CSS and excessive file size, rules, declarations and depth', () => {
    expect(() => parseCSS('.a{color red}', file)).toThrow(/Invalid CSS/);
    expect(() => parseCSS('/*' + 'x'.repeat(CSS_LIMITS.fileBytes) + '*/', file)).toThrow(/MiB/);
    expect(() => parseCSS('.a{}'.repeat(CSS_LIMITS.rules + 1), file)).toThrow(/rule limit/);
    expect(() => parseCSS('.a{' + 'x:0;'.repeat(CSS_LIMITS.declarations + 1) + '}', file)).toThrow(/declaration limit/);
    expect(() => parseCSS('@media all{'.repeat(66) + '.a{}' + '}'.repeat(66), file)).toThrow(/depth/);
  });
  it('counts UTF-8 without TextEncoder and returns only serializable source data', () => {
    const css = '.a{content:"👋é"}';
    const actual = parseCSS(css, file);
    expect(actual.bytes).toBe(new TextEncoder().encode(css).byteLength);
    expect(() => JSON.stringify(actual)).not.toThrow();
    expect(JSON.stringify(actual)).not.toContain('raws');
  });
  it('bounds aggregate selector and class-reference work across rules', () => {
    const list = Array.from({ length: 8001 }, () => '.a').join(',');
    expect(() => parseCSS(`${list}{}${list}{}${list}{}`, file)).toThrow(/24000 selector limit/);
    const compound = '.a'.repeat(801);
    expect(() => parseCSS(`${compound}{}`.repeat(60), file)).toThrow(/48000 class-reference limit/);
  });
  it('retains registration and unloaded-import safety metadata independently of warnings', () => {
    const notices = Array.from({ length: 140 }, (_, index) => `@unknown${index};`).join('');
    const actual = parseCSS(`${notices}@property --tone{syntax:"<color>";inherits:false;initial-value:blue}@import "missing.css";:root{--tone:red}`, file);
    expect(actual.registeredVariables).toEqual(['--tone']);
    expect(parseCSS('@property --\\74 one{inherits:false;initial-value:blue}', file).registeredVariables).toEqual(['--tone']);
    expect(actual.unresolvedImports).toBe(true);
    expect(actual.warnings.length).toBeLessThanOrEqual(129);
    expect(parseCSS('.a{}', file).registeredVariables).toBeUndefined();
    expect(parseCSS('.a{}', file).unresolvedImports).toBeUndefined();
  });
});
