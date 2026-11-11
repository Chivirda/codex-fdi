import postcss from 'postcss';
import selectorParser from 'postcss-selector-parser';
import type { Node as SelectorNode } from 'postcss-selector-parser';
import { CSS_LIMITS, type ParsedStylesheet, type SelectorInfo, type SourceLocation } from '../shared/project-styles';

type Specificity = [number, number, number];
const add = (a: Specificity, b: Specificity): Specificity => [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
const max = (a: Specificity, b: Specificity): Specificity => a[0] !== b[0] ? a[0] > b[0] ? a : b : a[1] !== b[1] ? a[1] > b[1] ? a : b : a[2] > b[2] ? a : b;
function specificity(node: SelectorNode, depth = 0): Specificity {
  if (depth > 64) throw new Error('Selector nesting exceeds the supported depth of 64.');
  if (node.type === 'id') return [1, 0, 0];
  if (node.type === 'class' || node.type === 'attribute') return [0, 1, 0];
  if (node.type === 'tag') return [0, 0, 1];
  if (node.type === 'pseudo') {
    const name = node.value.toLowerCase();
    if (name === ':where') return [0, 0, 0];
    if ([':is', ':not', ':has'].includes(name)) return node.nodes.reduce<Specificity>((total, child) => max(total, specificity(child, depth + 1)), [0, 0, 0]);
    if (name === ':nth-child' || name === ':nth-last-child') {
      const first = node.nodes[0];
      const of = first?.nodes.findIndex(child => child.type === 'tag' && child.value.toLowerCase() === 'of') ?? -1;
      if (first && of >= 0) {
        let argument = first.nodes.slice(of + 1).reduce<Specificity>((total, child) => add(total, specificity(child, depth + 1)), [0, 0, 0]);
        for (const child of node.nodes.slice(1)) argument = max(argument, specificity(child, depth + 1));
        return add([0, 1, 0], argument);
      }
    }
    if (name === ':host' || name === ':host-context' || name === '::slotted') {
      const argument = node.nodes.reduce<Specificity>((total, child) => max(total, specificity(child, depth + 1)), [0, 0, 0]);
      return add(name === '::slotted' ? [0, 0, 1] : [0, 1, 0], argument);
    }
    if (name.startsWith('::') || [':before', ':after', ':first-line', ':first-letter'].includes(name)) return [0, 0, 1];
    return [0, 1, 0];
  }
  if ('nodes' in node && node.nodes) return node.nodes.reduce<Specificity>((total, child) => add(total, specificity(child, depth + 1)), [0, 0, 0]);
  return [0, 0, 0];
}
function selectors(text: string, contextual: boolean, budget: { selectors: number; classes: number }): SelectorInfo[] {
  if (text.length > 32768) throw new Error('A selector exceeds the supported length of 32768 characters.');
  return selectorParser().astSync(text).nodes.map(selector => {
    if (++budget.selectors > 24000) throw new Error('CSS exceeds the 24000 selector limit.');
    const classes = new Set<string>();
    const pending: { node: SelectorNode; depth: number }[] = [{ node: selector, depth: 0 }];
    while (pending.length) {
      const { node, depth } = pending.pop()!;
      if (depth > 64) throw new Error('Selector nesting exceeds the supported depth of 64.');
      if (node.type === 'class') {
        if (++budget.classes > 48000) throw new Error('CSS exceeds the 48000 class-reference limit.');
        classes.add(node.value);
      }
      if ('nodes' in node && node.nodes) for (let index = node.nodes.length - 1; index >= 0; index--) pending.push({ node: node.nodes[index]!, depth: depth + 1 });
    }
    const meaningful = selector.nodes.filter(item => item.type !== 'comment');
    const simple = meaningful.length === 1 && meaningful[0]?.type === 'class';
    const unsupported = selector.nodes.some(item => item.type === 'nesting') || !classes.size;
    return {
      text: selector.toString().trim(), classes: [...classes],
      kind: simple && !contextual ? 'simple' : unsupported ? 'unsupported' : 'conditional',
      specificity: specificity(selector), simple,
      ...(!simple || contextual ? { reason: contextual ? 'Rule depends on an at-rule or nested-selector context.' : unsupported ? 'Selector requires unsupported nesting or has no class.' : 'Compound selectors, states, elements and combinators require document context.' } : {}),
    };
  });
}

/** Parse data only: no imports, URLs, declarations or selectors are executed. */
export function parseCSS(css: string, file: { id: string; name: string }): ParsedStylesheet {
  let bytes = 0;
  for (const character of css) {
    const point = character.codePointAt(0)!;
    bytes += point <= 0x7f ? 1 : point <= 0x7ff ? 2 : point <= 0xffff ? 3 : 4;
    if (bytes > CSS_LIMITS.fileBytes) break;
  }
  if (bytes > CSS_LIMITS.fileBytes) throw new Error(`CSS file exceeds the ${CSS_LIMITS.fileBytes / 1024 / 1024} MiB limit.`);
  const result: ParsedStylesheet = { ...file, bytes, importedAt: Date.now(), rules: [], variables: [], warnings: [] };
  const warning = (message: string): void => {
    if (result.warnings.includes(message)) return;
    if (result.warnings.length < 128) result.warnings.push(message);
    else if (result.warnings.length === 128) result.warnings.push('Additional stylesheet warnings were omitted.');
  };
  let root: postcss.Root;
  try { root = postcss.parse(css, { from: file.name }); }
  catch (error) { throw new Error(`Invalid CSS in ${file.name}: ${error instanceof Error ? error.message : String(error)}`); }
  let ruleCount = 0, declarationCount = 0, order = 0;
  const registeredVariables = new Set<string>();
  const selectorBudget = { selectors: 0, classes: 0 };
  const source = (node: postcss.Node): SourceLocation => ({ fileId: file.id, fileName: file.name, line: node.source?.start?.line ?? 1, column: node.source?.start?.column ?? 1 });
  type Task = { node: postcss.ChildNode; conditions: string[]; depth: number; excluded: boolean };
  const queue: Task[] = [...root.nodes].reverse().map(node => ({ node, conditions: [], depth: 0, excluded: false }));
  while (queue.length) {
    const task = queue.pop()!;
    const { node, conditions, depth } = task;
    if (depth > 64) throw new Error('CSS nesting exceeds the supported depth of 64.');
    if (node.type === 'decl') {
      if (++declarationCount > CSS_LIMITS.declarations) throw new Error(`CSS exceeds the ${CSS_LIMITS.declarations} declaration limit.`);
      continue;
    }
    if (node.type === 'comment') continue;
    if (node.type === 'atrule' && node.name.toLowerCase() === 'import') {
      result.unresolvedImports = true;
      warning(`@import ${node.params} was not loaded; import its CSS file explicitly.`);
    }
    if (node.type === 'atrule' && node.name.toLowerCase() === 'property') {
      // Identifier escapes can consume whitespace; a value tokenizer alone
      // would miss a registration such as --\\74 one (the identifier --tone).
      if (node.params.length <= 32768) try {
        const identifier = selectorParser().astSync(`.${node.params.trim()}`);
        const parts = identifier.nodes[0]?.nodes.filter(item => item.type !== 'comment');
        if (identifier.nodes.length === 1 && parts?.length === 1 && parts[0]?.type === 'class' && parts[0].value.startsWith('--')) registeredVariables.add(parts[0].value);
      } catch { /* Invalid registrations are not active property definitions. */ }
      warning('@property registrations are not evaluated; CSS variable inheritance is uncertain.');
    }
    const keyframes = node.type === 'atrule' && /^(?:-\w+-)?keyframes$/i.test(node.name);
    if (keyframes) warning('Keyframes are excluded from applicable class styles.');
    if (node.type === 'atrule' && !node.nodes && node.name.toLowerCase() !== 'import') warning(`@${node.name} is retained only as source context and is not evaluated.`);
    let nextConditions = conditions;
    if (node.type === 'atrule') nextConditions = [...conditions, `@${node.name}${node.params ? ` ${node.params}` : ''}`];
    if (node.type === 'rule') {
      if (++ruleCount > CSS_LIMITS.rules) throw new Error(`CSS exceeds the ${CSS_LIMITS.rules} rule limit.`);
      if (!task.excluded) {
        let parsedSelectors: SelectorInfo[];
        try { parsedSelectors = selectors(node.selector, conditions.length > 0, selectorBudget); }
        catch (error) { throw new Error(`Invalid or unsupported selector at ${file.name}:${source(node).line}: ${error instanceof Error ? error.message : String(error)}`); }
        const declarations = node.nodes.filter((child): child is postcss.Declaration => child.type === 'decl').map(decl => ({ property: decl.prop.startsWith('--') ? decl.prop : decl.prop.toLowerCase(), value: decl.value, important: !!decl.important, order: order++ }));
        result.rules.push({ selectors: parsedSelectors, declarations, source: source(node), order: order++, conditions: [...conditions] });
        for (const decl of node.nodes) if (decl.type === 'decl' && decl.prop.startsWith('--')) {
          result.variables.push({ name: decl.prop, value: decl.value, important: !!decl.important, selectors: parsedSelectors.map(item => item.text), source: source(decl), order: order++, conditions: [...conditions] });
        }
      }
      nextConditions = [...conditions, `selector(${node.selector})`];
    }
    if ('nodes' in node && node.nodes) for (let index = node.nodes.length - 1; index >= 0; index--) queue.push({ node: node.nodes[index]!, conditions: nextConditions, depth: depth + 1, excluded: task.excluded || keyframes });
  }
  result.warnings = [...new Set(result.warnings)];
  if (registeredVariables.size) result.registeredVariables = [...registeredVariables];
  return result;
}
