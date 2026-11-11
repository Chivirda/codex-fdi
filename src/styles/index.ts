import type {
  CSSVariable, ImportedDeclaration, IndexedClass, NormalizationOptions, ParsedStylesheet, SourceLocation, StyleIndex,
} from '../shared/project-styles';
import { normalizeDeclarations } from './normalize';
import valueParser from 'postcss-value-parser';

/** Properties with a reliable counterpart in the inspector's CSS model. */
export const COMPARABLE_PROPERTIES = new Set([
  'box-sizing', 'width', 'height', 'display', 'flex-direction', 'align-items', 'justify-content', 'row-gap', 'column-gap',
  'padding-top', 'padding-right', 'padding-bottom', 'padding-left', 'background-color', 'color',
  ...['top', 'right', 'bottom', 'left'].flatMap(side => [`border-${side}-width`, `border-${side}-style`, `border-${side}-color`]),
  ...['top-left', 'top-right', 'bottom-right', 'bottom-left'].map(corner => `border-${corner}-radius`),
  'opacity', 'font-family', 'font-size', 'font-weight', 'line-height', 'letter-spacing',
]);

/** Unknown shorthands must not hide effects on comparable longhands. */
export function affectedProperties(property: string): string[] {
  if (property === 'all') return [...COMPARABLE_PROPERTIES];
  if (property === 'padding') return ['padding-top', 'padding-right', 'padding-bottom', 'padding-left'];
  if (property === 'gap') return ['row-gap', 'column-gap'];
  if (property === 'background') return ['background-color'];
  if (property === 'font') return ['font-family', 'font-size', 'font-weight', 'line-height'];
  if (property === 'flex-flow') return ['flex-direction'];
  if (property === 'border-radius') return [...COMPARABLE_PROPERTIES].filter(item => /^border-.+-radius$/.test(item));
  if (property === 'border') return [...COMPARABLE_PROPERTIES].filter(item => /^border-(top|right|bottom|left)-(width|style|color)$/.test(item));
  if (/^border-(width|style|color)$/.test(property)) return ['top', 'right', 'bottom', 'left'].map(side => `border-${side}-${property.slice(7)}`);
  if (/^border-(top|right|bottom|left)$/.test(property)) return ['width', 'style', 'color'].map(part => `${property}-${part}`);
  return [property];
}

interface VariableSafety { unknown: boolean; cost: number }
export function expandedDeclarations(declarations: ImportedDeclaration[], options: NormalizationOptions, memo = new Map<string, VariableSafety>()): ImportedDeclaration[] {
  let budget = 10000;
  const uncertain = (value: string, visiting = new Set<string>(), depth = 0): boolean => {
    if (depth > 32 || value.length > 65536 || --budget < 0) return true;
    const inspect = (nodes: valueParser.Node[], nesting: number): boolean => {
      if (nesting > 64) return true;
      for (const token of nodes) {
        if (--budget < 0) return true;
        if (token.type !== 'function') continue;
        if (token.value.toLowerCase() !== 'var') {
          if (inspect(token.nodes, nesting + 1)) return true;
          continue;
        }
        const comma = token.nodes.findIndex(child => child.type === 'div' && child.value === ',');
        const name = valueParser.stringify(comma < 0 ? token.nodes : token.nodes.slice(0, comma)).trim();
        if (!options.variables || !Object.prototype.hasOwnProperty.call(options.variables, name) || visiting.has(name)) return true;
        const cached = memo.get(name);
        if (cached) {
          budget -= cached.cost;
          if (cached.unknown || budget < 0) return true;
          continue;
        }
        visiting.add(name);
        const before = budget;
        const unknown = uncertain(options.variables[name]!, visiting, depth + 1);
        visiting.delete(name);
        memo.set(name, { unknown, cost: Math.max(1, before - budget) });
        if (unknown) return true;
      }
      return false;
    };
    return inspect(valueParser(value).nodes, 0);
  };
  return declarations.flatMap(original => {
    // Absence from a known environment does not prove a variable is absent in
    // the eventual DOM. A fallback cannot make an unknown scoped token certain.
    const normalized = uncertain(original.value)
      ? [{ ...original, normalized: undefined, reason: 'CSS variable scope/value is unknown; fallback applicability cannot be proven.' }]
      : normalizeDeclarations([original], options);
    return normalized;
  }).flatMap(declaration => {
    if (declaration.normalized !== undefined) return [declaration];
    const affected = affectedProperties(declaration.property);
    const expanded = affected.map(property => ({ ...declaration, property }));
    // A later longhand cannot prove that every effect of an unknown shorthand
    // was reset (e.g. background-color leaves a gradient background-image).
    // Retain its uncertainty even when the comparable components are replaced.
    return affected.includes(declaration.property) ? expanded : [declaration, ...expanded];
  });
}

const wins = (incoming: ImportedDeclaration, current: ImportedDeclaration | undefined): boolean => !current
  || (incoming.important !== current.important ? incoming.important : incoming.order >= current.order);
export function cascade(declarations: ImportedDeclaration[]): ImportedDeclaration[] {
  const effective = new Map<string, ImportedDeclaration>();
  for (const declaration of declarations) if (wins(declaration, effective.get(declaration.property))) effective.set(declaration.property, declaration);
  return [...effective.values()].sort((a, b) => a.order - b.order || a.property.localeCompare(b.property));
}

function rootVariables(files: ParsedStylesheet[], options: NormalizationOptions): { values: Record<string, string>; warnings: string[] } {
  const chosen = new Map<string, CSSVariable>();
  const blocked = new Set<string>();
  const warnings: string[] = [];
  const unknownEnvironment = files.some(file => file.unresolvedImports);
  for (const file of files) for (const name of file.registeredVariables ?? []) blocked.add(name);
  for (const file of files) for (const variable of [...file.variables].sort((a, b) => a.order - b.order)) {
    if (variable.conditions.length || !variable.selectors.length || !variable.selectors.every(selector => selector.trim() === ':root')) {
      blocked.add(variable.name);
      continue;
    }
    const previous = chosen.get(variable.name);
    if (!previous || variable.important || !previous.important) chosen.set(variable.name, variable);
  }
  const values: Record<string, string> = Object.create(null) as Record<string, string>;
  if (unknownEnvironment) {
    return { values, warnings: ['CSS variable resolution and token suggestions are disabled because an unresolved @import leaves variable scope/inheritance unknown.'] };
  }
  for (const [name, variable] of chosen) if (!blocked.has(name)) values[name] = variable.value;
  for (const [name, value] of Object.entries(options.variables ?? {})) if (!blocked.has(name)) values[name] = value;
  if (blocked.size) warnings.push(`${blocked.size} scoped, conditional or registered CSS variable name(s) were excluded from resolution and token suggestions.`);
  return { values, warnings };
}

interface ClassBuilder {
  result: IndexedClass;
  safe: ImportedDeclaration[];
  contextual: ImportedDeclaration[];
}

/** Imported file order is cascade order. Only unconditional single-class selectors are safe. */
export function buildStyleIndex(files: ParsedStylesheet[], options: NormalizationOptions = {}): StyleIndex {
  const variables = rootVariables(files, options);
  const normalizedOptions: NormalizationOptions = { ...options, variables: variables.values };
  const variableMemo = new Map<string, VariableSafety>();
  const classes = new Map<string, ClassBuilder>();
  const warnings = [...files.flatMap(file => file.warnings), ...variables.warnings,
    'Matches compare imported declarations only; element types, ancestors, browser defaults, inheritance and unimported styles are not evaluated.'];
  const globals = new Set<string>();
  if (files.some(file => file.unresolvedImports)) {
    for (const property of COMPARABLE_PROPERTIES) globals.add(property);
  }
  let order = 0;
  let ruleCount = 0;
  let variableCount = 0;
  let normalizedCount = 0;
  let indexedCount = 0;
  const addSource = (list: SourceLocation[], source: SourceLocation): void => {
    if (!list.some(item => item.fileId === source.fileId && item.line === source.line && item.column === source.column)) list.push(source);
  };
  for (const file of files) {
    variableCount += file.variables.length;
    for (const rule of [...file.rules].sort((a, b) => a.order - b.order)) {
      ruleCount++;
      const declarations: ImportedDeclaration[] = [];
      for (const declaration of [...rule.declarations].sort((a, b) => a.order - b.order)) {
        const normalized = expandedDeclarations([{ ...declaration, order: order++ }], normalizedOptions, variableMemo)
          .filter(item => !item.property.startsWith('--'));
        normalizedCount += normalized.length;
        if (normalizedCount > 100000) throw new Error('CSS index exceeds 100000 normalized declaration components. Import fewer or smaller stylesheets.');
        declarations.push(...normalized);
      }
      const affected = declarations.filter(declaration => COMPARABLE_PROPERTIES.has(declaration.property));
      for (const selector of rule.selectors) {
        if (!selector.classes.length) {
          for (const declaration of affected) globals.add(declaration.property);
          continue;
        }
        for (const className of new Set(selector.classes)) {
          let entry = classes.get(className);
          if (!entry) {
            if (classes.size >= 12000) throw new Error('CSS index exceeds 12000 unique classes. Import fewer stylesheets.');
            entry = { result: { className, selectors: [], declarations: [], category: 'safe', limitations: [], sources: [] }, safe: [], contextual: [] };
            classes.set(className, entry);
          }
          const result = entry.result;
          if (!result.selectors.includes(selector.text)) result.selectors.push(selector.text);
          addSource(result.sources, rule.source);
          // Keep generated combined selectors and HTML class tokens unambiguous.
          const safeToken = className.length > 0 && !/[\s\u0000-\u001f\u007f]/u.test(className);
          const safe = selector.kind === 'simple' && !rule.conditions.length && safeToken;
          indexedCount += declarations.length;
          if (indexedCount > 100000) throw new Error('CSS index exceeds 100000 indexed class declaration components. Reduce selector lists or imported stylesheets.');
          if (safe) entry.safe.push(...declarations);
          else {
            entry.contextual.push(...declarations);
            if (affected.length || !safeToken) {
              result.category = selector.kind === 'unsupported' || !safeToken ? 'unsupported' : result.category === 'unsupported' ? 'unsupported' : 'conditional';
              result.limitations.push(selector.reason ?? `Contextual selector ${selector.text}${rule.conditions.length ? ` in ${rule.conditions.join(' / ')}` : ''} may affect compared properties.`);
            }
          }
        }
      }
    }
  }
  for (const { result, safe, contextual } of classes.values()) {
    const effective = cascade(safe);
    const covered = new Set(effective.map(declaration => declaration.property));
    // Contextual declarations are illustrative only; never overwrite known base declarations.
    result.declarations = [...effective, ...cascade(contextual).filter(declaration => !covered.has(declaration.property))];
    if (globals.size) {
      result.category = result.category === 'unsupported' ? 'unsupported' : 'conditional';
      result.limitations.push(`Global/contextual selectors may affect: ${[...globals].sort().join(', ')}. Their applicability is unknown.`);
    }
    result.limitations = [...new Set(result.limitations)];
  }
  return { classes: [...classes.values()].map(entry => entry.result).sort((a, b) => a.className.localeCompare(b.className)),
    variables: variables.values, warnings: [...new Set(warnings)], ruleCount, variableCount };
}
