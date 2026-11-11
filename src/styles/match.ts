import type { InspectorNode } from '../shared/contracts';
import type {
  ImportedDeclaration, IndexedClass, MatchProperty, MatchingResult, NormalizationOptions, StyleIndex, StyleMatch, VariableSuggestion,
} from '../shared/project-styles';
import { equivalent, formatMatchValue } from './numeric';
import { generateDeclarations } from '../css/generate';
import { cascade, COMPARABLE_PROPERTIES, expandedDeclarations } from './index';

// Score only the inspector's comparable domain. Keep other declarations in
// incomparable details and override safety checks, without penalizing margin
// four times merely because it was expanded.
function weight(item: MatchProperty): number {
  if (!COMPARABLE_PROPERTIES.has(item.property) || item.property === 'box-sizing') return 0;
  if (item.property === 'opacity' && (item.figma ?? item.css) === '1') return 0;
  return /^(font-|line-height|letter-spacing)/.test(item.property) ? 2 : 1;
}
const weighted = (items: MatchProperty[]): number => items.reduce((sum, item) => sum + weight(item), 0);
function typographyContext(declarations: ImportedDeclaration[]): ImportedDeclaration[] {
  const fontSize = declarations.find(item => item.property === 'font-size')?.normalized;
  const size = fontSize?.endsWith('px') ? Number(fontSize.slice(0, -2)) : NaN;
  return declarations.map(item => {
    if (!['line-height', 'letter-spacing'].includes(item.property) || !item.normalized?.endsWith('em')) return item;
    if (!Number.isFinite(size) || size <= 0) return { ...item, normalized: undefined, reason: 'Relative typography needs a known font-size on this candidate; inheritance is unknown.' };
    return { ...item, normalized: `${Number((Number(item.normalized.slice(0, -2)) * size).toPrecision(15))}px` };
  });
}
function matchingGroups(properties: MatchProperty[]): number {
  return new Set(properties.filter(item => weight(item) > 0).map(({ property }) => {
    if (property.startsWith('padding-')) return 'padding';
    if (/^border-.+-radius$/.test(property)) return 'border-radius';
    if (property.startsWith('border-')) return 'border';
    if (property === 'row-gap' || property === 'column-gap') return 'gap';
    return property;
  })).size;
}
function escapeIdentifier(value: string): string {
  return Array.from(value).map((character, index, characters) => {
    const point = character.codePointAt(0)!;
    if ((index === 0 || index === 1 && characters[0] === '-') && /[0-9]/.test(character)) return `\\${point.toString(16)} `;
    if (characters.length === 1 && character === '-') return '\\-';
    if (point >= 128 || /[a-zA-Z0-9_-]/.test(character)) return character;
    return `\\${character}`;
  }).join('');
}
const selectorFor = (classes: string[]): string => classes.map(name => `.${escapeIdentifier(name)}`).join('');

function candidate(entries: IndexedClass[], expected: ImportedDeclaration[]): StyleMatch {
  const declarations = typographyContext(cascade(entries.flatMap(entry => entry.declarations)));
  const actual = new Map(declarations.map(declaration => [declaration.property, declaration]));
  const desired = new Map(expected.map(declaration => [declaration.property, declaration]));
  const matched: MatchProperty[] = [], different: MatchProperty[] = [], missing: MatchProperty[] = [], incomparable: MatchProperty[] = [];
  for (const declaration of expected) {
    const other = actual.get(declaration.property);
    const property = { property: declaration.property, figma: declaration.normalized ?? declaration.value };
    if (!other) missing.push(property);
    else if (other.normalized === undefined || declaration.normalized === undefined) incomparable.push({ ...property, css: other.value, reason: other.reason ?? declaration.reason ?? 'Value cannot be reliably normalized.' });
    else if (equivalent(declaration.property, other.normalized, declaration.normalized)) matched.push({ ...property, css: other.normalized });
    else different.push({ ...property, css: other.normalized });
  }
  for (const declaration of declarations) if (!desired.has(declaration.property)) {
    incomparable.push({ property: declaration.property, css: declaration.normalized ?? declaration.value,
      reason: declaration.reason ?? 'Figma does not expose a reliable value for this imported property.' });
  }
  const category = entries.some(entry => entry.category === 'unsupported') ? 'unsupported'
    : entries.some(entry => entry.category === 'conditional') ? 'conditional' : 'safe';
  const matchedCount = weighted(matched);
  const groups = matchingGroups(matched);
  const total = matchedCount + weighted(different) + weighted(missing) + weighted(incomparable);
  // Weighted coverage within the inspector domain. Unknown extra declarations
  // remain visible and block confident claims/overrides independently of score.
  // At least two semantic groups are still required for a score above 25.
  const coverageScore = total ? Math.round(100 * matchedCount / total) : 0;
  const score = groups < 2 ? Math.min(25, coverageScore) : coverageScore;
  const confidence = category === 'safe' && groups >= 2 && score >= 85 && !different.length && !incomparable.length ? 'high'
    : category === 'safe' && groups >= 2 && score >= 50 && !incomparable.length ? 'medium' : 'low';
  const classes = entries.map(entry => entry.className);
  const limitations = [...new Set(entries.flatMap(entry => entry.limitations))];
  if (incomparable.length) limitations.push('Uncomparable declarations limit confidence and prevent a reliable override.');
  if (groups < 2) limitations.push('Fewer than two meaningful matching property groups: a utility class alone is low-confidence, never an exact match.');
  if (entries.length > 1) {
    const conflicts = new Set<string>();
    const seen = new Map<string, ImportedDeclaration>();
    for (const entry of entries) for (const declaration of entry.declarations) {
      const previous = seen.get(declaration.property);
      if (previous && (previous.normalized !== declaration.normalized || previous.important !== declaration.important)) conflicts.add(declaration.property);
      seen.set(declaration.property, declaration);
    }
    if (conflicts.size) limitations.push(`Combined classes conflict on ${[...conflicts].sort().slice(0, 40).join(', ')}${conflicts.size > 40 ? ` and ${conflicts.size - 40} more properties` : ''}; imported !important and source order determine the winner.`);
  }
  const coverage: Record<string, string[]> = Object.create(null) as Record<string, string[]>;
  for (const entry of entries) {
    const properties = new Map(typographyContext(entry.declarations).map(declaration => [declaration.property, declaration.normalized]));
    coverage[entry.className] = matched.filter(property => equivalent(property.property, properties.get(property.property), property.figma)).map(property => property.property);
  }
  const result: StyleMatch = { classes, selector: selectorFor(classes), category, score, confidence, matched, different, missing, incomparable, limitations, coverage, copyable: entries.every(entry => entry.copyable ?? entry.category === 'safe') };
  if (category === 'safe' && groups >= 2 && !incomparable.length) {
    const changes = different.map(property => {
      const declaration = desired.get(property.property);
      if (!declaration || declaration.normalized === undefined) return undefined;
      const important = actual.get(property.property)?.important ? ' !important' : '';
      return `  ${property.property}: ${formatMatchValue(declaration.value)}${important};`;
    }).filter((line): line is string => line !== undefined);
    if (changes.length) {
      result.override = [`${result.selector} {`, ...changes, '}'].join('\n');
      result.limitations.push('Apply this override after the imported styles; it only accounts for the imported unconditional class rules.');
    }
  }
  // Compute scores/confidence and override safety from the complete comparison
  // above, then bound response/DOM work without hiding that details were omitted.
  for (const [name, properties] of [['matched', matched], ['different', different], ['missing', missing], ['incomparable', incomparable]] as const) {
    if (properties.length > 80) {
      limitations.push(`${properties.length - 80} additional ${name} properties omitted from the displayed details.`);
      properties.length = 80;
    }
  }
  return result;
}

const tokenCache = new WeakMap<StyleIndex, Map<string, string | undefined>>();
function suggestions(expected: ImportedDeclaration[], index: StyleIndex, options: NormalizationOptions): VariableSuggestion[] {
  const result: VariableSuggestion[] = [];
  let cache = tokenCache.get(index);
  if (!cache) { cache = new Map(); tokenCache.set(index, cache); }
  // Token scans and output are bounded independently of imported stylesheet size.
  for (const [variable] of Object.entries(index.variables).sort(([a], [b]) => a.localeCompare(b)).slice(0, 500)) {
    for (const declaration of expected) {
      if (!COMPARABLE_PROPERTIES.has(declaration.property) || declaration.normalized === undefined) continue;
      const key = JSON.stringify([options.remBase, variable, declaration.property]);
      if (!cache.has(key)) {
        const normalized = expandedDeclarations([{ ...declaration, value: `var(${variable})`, normalized: undefined, reason: undefined }], options);
        cache.set(key, normalized.find(item => item.property === declaration.property)?.normalized);
      }
      if (equivalent(declaration.property, cache.get(key), declaration.normalized)) {
        result.push({ property: declaration.property, variable, declaration: `${declaration.property}: var(${variable});`, value: declaration.normalized });
        if (result.length === 12) return result;
      }
    }
  }
  return result;
}

/** Pure, bounded matching over imported CSS. No DOM, Figma API, or browser cascade claims. */
export function findMatches(node: InspectorNode, index: StyleIndex, options: NormalizationOptions = {}): MatchingResult {
  const normalization: NormalizationOptions = { ...options, variables: index.variables };
  const expected = typographyContext(cascade(expandedDeclarations(generateDeclarations(node).map((declaration, order) => ({
    property: declaration.property, value: declaration.value, important: false, order,
  })), normalization)));
  // The session rebuilds the index when rem base or imports change. Imported CSS
  // is already normalized: never reparse every class on each selection update.
  const byName = new Map(index.classes.map(entry => [entry.className, entry]));
  const rank = (a: StyleMatch, b: StyleMatch): number => b.score - a.score || weighted(b.matched) - weighted(a.matched) || a.classes.length - b.classes.length || a.selector.localeCompare(b.selector);
  const singles: StyleMatch[] = [];
  const partial: StyleMatch[] = [];
  const retain = (list: StyleMatch[], match: StyleMatch): void => { list.push(match); list.sort(rank); if (list.length > 12) list.length = 12; };
  for (const entry of index.classes) {
    const single = candidate([entry], expected);
    if (weighted(single.matched) === 0) continue;
    retain(singles, single);
    if (single.category === 'safe' && (single.missing.length || single.different.length)) retain(partial, single);
  }
  const pairs: StyleMatch[] = [];
  let attempts = 0;
  for (let a = 0; a < partial.length && attempts < 40; a++) for (let b = a + 1; b < partial.length && attempts < 40; b++) {
    attempts++;
    const first = byName.get(partial[a]!.classes[0]!);
    const second = byName.get(partial[b]!.classes[0]!);
    if (!first || !second) continue;
    const pair = candidate([first, second], expected);
    if (pair.score > Math.max(partial[a]!.score, partial[b]!.score)) pairs.push(pair);
  }
  const matches = [...singles, ...pairs].sort(rank).slice(0, 12);
  // Serialize original rules only for retained candidates; never substitute
  // normalized expansions or Figma values. Preserve every conditional wrapper.
  for (const match of matches) {
    const rules = [...new Set(match.classes.flatMap(name => byName.get(name)?.rules ?? []))].sort((a, b) => a.order - b.order);
    let size = 0;
    const blocks: string[] = [];
    for (const rule of rules) {
      let css = `${rule.selectors.map(selector => selector.text).join(', ')} {\n${rule.declarations.map(d => `  ${d.property}: ${d.value}${d.important ? ' !important' : ''};`).join('\n')}\n}`;
      for (const context of [...rule.conditions].reverse()) {
        const wrapper = context.startsWith('selector(') ? context.slice(9, -1) : context;
        css = `${wrapper} {\n${css.split('\n').map(line => `  ${line}`).join('\n')}\n}`;
      }
      size += css.length;
      if (size > 65536) { blocks.length = 0; match.limitations.push('Matched CSS exceeds the 64 KiB copy limit; inspect the source file.'); break; }
      blocks.push(css);
    }
    if (blocks.length) match.matchedCSS = blocks.join('\n\n');
  }
  return { matches, variables: suggestions(expected, index, normalization),
    warnings: [...index.warnings, 'Pair search considers at most 40 pairs from the top 12 partial single-class candidates; it is not an exhaustive class-combination search.'] };
}
