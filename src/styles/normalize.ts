import valueParser from 'postcss-value-parser';
import colorString from 'color-string';
import type { ImportedDeclaration, NormalizationOptions } from '../shared/project-styles';

type Token = valueParser.Node;
const sides = ['top', 'right', 'bottom', 'left'] as const;
const corners = ['top-left', 'top-right', 'bottom-right', 'bottom-left'] as const;
const wide = /^(inherit|initial|unset|revert|revert-layer)$/i;
const numeric = /^[+-]?(?:\d*\.\d+|\d+)(?:e[+-]?\d+)?$/i;
const numberText = (value: number): string => String(Number(value.toPrecision(15)));
const tokens = (raw: string): string[] => valueParser(raw).nodes.filter(node => node.type !== 'space' && node.type !== 'comment').map(node => node.type === 'div' ? node.value : valueParser.stringify(node));
const four = (values: string[]): string[] | undefined => values.length >= 1 && values.length <= 4
  ? [values[0]!, values[1] ?? values[0]!, values[2] ?? values[0]!, values[3] ?? values[1] ?? values[0]!] : undefined;
class VariableCycle extends Error {
  constructor(readonly members: string[]) { super(`Cyclic variable reference: ${members.join(' → ')}.`); }
}
class ResolutionLimit extends Error {}
interface ResolutionWork { steps: number; memo: Map<string, string> }

/** Resolve only explicitly supplied variables. Scope/cascade belongs to the index. */
function resolve(raw: string, options: NormalizationOptions, stack: string[] = [], work: ResolutionWork = { steps: 0, memo: new Map() }): string {
  if (stack.length > 32) throw new ResolutionLimit('Variable resolution exceeds the supported depth.');
  const render = (nodes: Token[], depth = 0): string => {
    if (depth > 64) throw new ResolutionLimit('CSS value nesting exceeds the supported depth.');
    const parts: string[] = [];
    let size = 0;
    for (const node of nodes) {
      if (++work.steps > 20000) throw new ResolutionLimit('Variable resolution exceeds the supported work budget.');
      const part = (() => {
      if (node.type !== 'function') return valueParser.stringify(node);
      if (node.unclosed) throw new Error('Unclosed CSS value function.');
      if (node.value.toLowerCase() !== 'var') return `${node.value}(${render(node.nodes, depth + 1)})`;
      const divider = node.nodes.findIndex(child => child.type === 'div' && child.value === ',');
      const name = valueParser.stringify(divider < 0 ? node.nodes : node.nodes.slice(0, divider)).trim();
      if (!/^--[^\s,()]+$/.test(name)) throw new Error('Invalid custom property reference.');
      const fallback = divider < 0 ? undefined : valueParser.stringify(node.nodes.slice(divider + 1));
      try {
        if (stack.includes(name)) throw new VariableCycle([...stack.slice(stack.indexOf(name)), name]);
        if (!options.variables || !Object.prototype.hasOwnProperty.call(options.variables, name)) throw new Error(`Unresolved variable ${name}.`);
        const cached = work.memo.get(name);
        if (cached !== undefined) return cached;
        const value = resolve(options.variables[name]!, options, [...stack, name], work);
        work.memo.set(name, value);
        return value;
      } catch (error) {
        if (error instanceof ResolutionLimit) throw error;
        // A fallback inside a cyclic custom-property definition cannot make the
        // definition valid. Only the outside consumer may use its own fallback.
        if (error instanceof VariableCycle && stack.some(name => error.members.includes(name))) throw error;
        if (fallback !== undefined) return resolve(fallback, options, stack, work);
        throw error;
      }
      })();
      size += part.length;
      if (size > 65536) throw new ResolutionLimit('Resolved CSS value is too large.');
      parts.push(part);
    }
    return parts.join('');
  };
  return render(valueParser(raw).nodes);
}

function color(raw: string): string | undefined {
  const parsed = colorString.get(raw.toLowerCase());
  if (!parsed || !parsed.value.every(Number.isFinite)) return undefined;
  let [a = 0, b = 0, c = 0, alpha = 1] = parsed.value;
  if (parsed.model === 'hsl') {
    const hue = ((a % 360) + 360) % 360 / 60, saturation = b / 100, lightness = c / 100;
    const chroma = (1 - Math.abs(2 * lightness - 1)) * saturation;
    const x = chroma * (1 - Math.abs(hue % 2 - 1));
    const m = lightness - chroma / 2;
    const channels = hue < 1 ? [chroma, x, 0] : hue < 2 ? [x, chroma, 0] : hue < 3 ? [0, chroma, x] : hue < 4 ? [0, x, chroma] : hue < 5 ? [x, 0, chroma] : [chroma, 0, x];
    [a, b, c] = channels.map(channel => (channel + m) * 255) as [number, number, number];
  } else if (parsed.model === 'hwb') {
    const hue = ((a % 360) + 360) % 360 / 60, white = b / 100, black = c / 100;
    if (white + black >= 1) a = b = c = white / (white + black) * 255;
    else {
      const x = 1 - Math.abs(hue % 2 - 1);
      const channels = hue < 1 ? [1, x, 0] : hue < 2 ? [x, 1, 0] : hue < 3 ? [0, 1, x] : hue < 4 ? [0, x, 1] : hue < 5 ? [x, 0, 1] : [1, 0, x];
      [a, b, c] = channels.map(channel => (channel * (1 - white - black) + white) * 255) as [number, number, number];
    }
  }
  return `rgba(${numberText(a)}, ${numberText(b)}, ${numberText(c)}, ${numberText(alpha)})`;
}

function length(raw: string, options: NormalizationOptions): string | undefined {
  const parsed = valueParser.unit(raw.toLowerCase());
  if (!parsed || !numeric.test(parsed.number)) return undefined;
  const value = Number(parsed.number);
  if (!Number.isFinite(value)) return undefined;
  if (value === 0 && (parsed.unit === '' || parsed.unit === 'px')) return '0px';
  if (parsed.unit === 'px') return `${numberText(value)}px`;
  if (parsed.unit === 'rem' && options.remBase !== undefined && Number.isFinite(options.remBase) && options.remBase > 0) {
    const px = value * options.remBase;
    if (Number.isFinite(px)) return `${numberText(px)}px`;
  }
  return undefined;
}
function decode(raw: string): string {
  return raw.replace(/\\(?:([0-9a-f]{1,6})\s?|\r\n|[\n\r\f]|(.))/gi, (_match, hex: string | undefined, escaped: string | undefined) => {
    if (hex) { const point = parseInt(hex, 16); return point === 0 || point > 0x10ffff || point >= 0xd800 && point <= 0xdfff ? '\ufffd' : String.fromCodePoint(point); }
    return escaped ?? '';
  });
}
function fontFamily(raw: string): string | undefined {
  const groups: string[][] = [[]];
  let quoted = false;
  for (const node of valueParser(raw).nodes) {
    if (node.type === 'space' || node.type === 'comment') continue;
    if (node.type === 'div' && node.value === ',') { if (!groups[groups.length - 1]!.length) return undefined; groups.push([]); quoted = false; }
    else if (node.type === 'word' || node.type === 'string') {
      const group = groups[groups.length - 1]!;
      if (quoted || node.type === 'string' && (node.unclosed || group.length)) return undefined;
      if (node.type === 'word' && !/^-?[a-z_\u0080-\uffff][\w\u0080-\uffff-]*$/i.test(decode(node.value))) return undefined;
      if (node.type === 'string') quoted = true;
      group.push(decode(node.value));
    }
    else return undefined;
  }
  if (groups.some(group => !group.length)) return undefined;
  return groups.map(group => JSON.stringify(group.join(' ').toLowerCase())).join(', ');
}
const enums: Record<string, string[]> = {
  display: ['flex', 'inline-flex', 'block', 'inline', 'inline-block', 'grid', 'none'],
  'flex-direction': ['row', 'column', 'row-reverse', 'column-reverse'], 'flex-wrap': ['nowrap', 'wrap', 'wrap-reverse'],
  'align-items': ['flex-start', 'flex-end', 'center', 'baseline', 'stretch', 'start', 'end'],
  'justify-content': ['flex-start', 'flex-end', 'center', 'space-between', 'space-around', 'space-evenly', 'start', 'end'],
  'box-sizing': ['border-box', 'content-box'], 'font-style': ['normal', 'italic', 'oblique'],
  'font-variant': ['normal', 'small-caps'], 'font-stretch': ['normal'],
};
function canonical(property: string, raw: string, options: NormalizationOptions): { normalized?: string; reason?: string } {
  const value = raw.trim();
  const lower = value.toLowerCase();
  if (wide.test(value)) return { reason: 'CSS-wide keywords require cascade and inheritance context.' };
  if (!value) return { reason: 'Empty CSS value is not comparable.' };
  if (property.startsWith('--')) return { reason: 'Custom properties are resolved through their applicable scope.' };
  if (property === 'font-family') {
    const normalized = fontFamily(value);
    return normalized === undefined ? { reason: 'Unsupported font-family syntax.' } : { normalized };
  }
  if (property === 'font-weight') {
    const weight = lower === 'normal' ? 400 : lower === 'bold' ? 700 : numeric.test(value) ? Number(value) : NaN;
    return Number.isFinite(weight) && weight >= 1 && weight <= 1000 ? { normalized: numberText(weight) } : { reason: 'Font weight depends on inherited context or is invalid.' };
  }
  if (property === 'color' || property === 'background-color' || /^border-(top|right|bottom|left)-color$/.test(property)) {
    const normalized = color(value);
    return normalized === undefined ? { reason: 'Color is context-dependent or unsupported (for example currentColor or color()).' } : { normalized };
  }
  if (property === 'opacity') {
    const parsed = valueParser.unit(value);
    if (parsed && numeric.test(parsed.number) && ['', '%'].includes(parsed.unit) && Number.isFinite(Number(parsed.number))) return { normalized: numberText(Math.max(0, Math.min(1, Number(parsed.number) / (parsed.unit === '%' ? 100 : 1)))) };
    return { reason: 'Opacity is not a supported numeric value.' };
  }
  if (/^border-(top|right|bottom|left)-style$/.test(property)) {
    return /^(none|hidden|solid|dotted|dashed|double|groove|ridge|inset|outset)$/.test(lower) ? { normalized: lower } : { reason: 'Unsupported border style.' };
  }
  if (enums[property]) return enums[property]!.includes(lower) ? { normalized: lower } : { reason: 'Value requires unsupported layout or font context.' };
  if (property === 'line-height' || property === 'letter-spacing') {
    const parsed = valueParser.unit(value);
    if (parsed && numeric.test(parsed.number) && Number.isFinite(Number(parsed.number))) {
      const amount = Number(parsed.number);
      if (property === 'line-height' && amount >= 0 && ['', '%', 'em'].includes(parsed.unit)) {
        return { normalized: `${numberText(amount / (parsed.unit === '%' ? 100 : 1))}em` };
      }
      if (property === 'letter-spacing' && parsed.unit === 'em') return { normalized: `${numberText(amount)}em` };
    }
  }
  if (/^(width|height|min-width|min-height|max-width|max-height|gap|row-gap|column-gap|padding-(top|right|bottom|left)|margin-(top|right|bottom|left)|border-(top|right|bottom|left)-width|font-size|line-height|letter-spacing)$/.test(property)) {
    if (property === 'letter-spacing' && lower === 'normal') return { normalized: '0px' };
    const normalized = length(value, options);
    if (normalized !== undefined) {
      if (normalized.startsWith('-') && property !== 'letter-spacing' && !property.startsWith('margin-')) return { reason: 'Negative values are invalid for this CSS property.' };
      return { normalized };
    }
    return { reason: 'Length requires context or is unsupported: use px, or rem with a known base; em, %, calc(), auto and unitless line-height are not assumed.' };
  }
  if (/^border-(top-left|top-right|bottom-right|bottom-left)-radius$/.test(property)) {
    const parts = tokens(value);
    const normalized = parts.map(part => length(part, options));
    if (parts.length >= 1 && parts.length <= 2 && normalized.every((part): part is string => part !== undefined && !part.startsWith('-'))) return { normalized: normalized[0] === normalized[1] || parts.length === 1 ? normalized[0] : normalized.join(' ') };
    return { reason: 'Radius requires supported absolute dimensions; percentage radii depend on box geometry.' };
  }
  return { reason: 'Property is outside the comparable MVP subset.' };
}

function expand(property: string, raw: string): [string, string][] | undefined {
  const parts = tokens(raw);
  if (wide.test(raw.trim())) return undefined;
  if (property === 'padding' || property === 'margin' || /^border-(width|style|color)$/.test(property)) {
    const values = four(parts);
    if (!values) return undefined;
    return sides.map((side, index) => [property.startsWith('border-') ? `border-${side}-${property.slice(7)}` : `${property}-${side}`, values[index]!]);
  }
  if (property === 'gap') {
    if (parts.length < 1 || parts.length > 2) return undefined;
    return [['row-gap', parts[0]!], ['column-gap', parts[1] ?? parts[0]!]];
  }
  if (property === 'border-radius') {
    const slash = parts.indexOf('/');
    const horizontal = four(slash < 0 ? parts : parts.slice(0, slash));
    const vertical = slash < 0 ? horizontal : four(parts.slice(slash + 1));
    if (!horizontal || !vertical) return undefined;
    return corners.map((corner, index) => [`border-${corner}-radius`, horizontal[index] === vertical[index] ? horizontal[index]! : `${horizontal[index]} ${vertical[index]}`]);
  }
  if (property === 'border' || /^border-(top|right|bottom|left)$/.test(property)) {
    let width: string | undefined, style: string | undefined, tint: string | undefined;
    if (!parts.length || parts.length > 3) return undefined;
    for (const part of parts) {
      if (/^(none|hidden|solid|dotted|dashed|double|groove|ridge|inset|outset)$/i.test(part) && style === undefined) style = part;
      else if ((valueParser.unit(part) || /^(thin|medium|thick)$/i.test(part)) && width === undefined) width = part;
      else if ((color(part) !== undefined || part.toLowerCase() === 'currentcolor') && tint === undefined) tint = part;
      else return undefined;
    }
    const selected = property === 'border' ? sides : [property.slice(7)];
    return selected.flatMap(side => [[`border-${side}-width`, width ?? 'medium'], [`border-${side}-style`, style ?? 'none'], [`border-${side}-color`, tint ?? 'currentColor']] as [string, string][]);
  }
  if (property === 'background') return color(raw.trim()) === undefined ? undefined : [['background-color', raw]];
  if (property === 'flex-flow') {
    let direction: string | undefined, wrap: string | undefined;
    if (!parts.length || parts.length > 2) return undefined;
    for (const part of parts) {
      if (enums['flex-direction']!.includes(part.toLowerCase()) && !direction) direction = part;
      else if (enums['flex-wrap']!.includes(part.toLowerCase()) && !wrap) wrap = part;
      else return undefined;
    }
    return [['flex-direction', direction ?? 'row'], ['flex-wrap', wrap ?? 'nowrap']];
  }
  if (property === 'font') {
    const sizeIndex = parts.findIndex(part => { const parsed = valueParser.unit(part); return !!parsed && !!parsed.unit; });
    if (sizeIndex < 0) return undefined;
    let weight = 'normal', style = 'normal', variant = 'normal';
    for (const part of parts.slice(0, sizeIndex)) {
      if (/^(normal)$/i.test(part)) continue;
      if (/^(bold|[1-9]\d{0,2}|1000)$/i.test(part) && weight === 'normal') weight = part;
      else if (/^(italic|oblique)$/i.test(part) && style === 'normal') style = part;
      else if (/^small-caps$/i.test(part) && variant === 'normal') variant = part;
      else return undefined;
    }
    let familyIndex = sizeIndex + 1, lineHeight = 'normal';
    if (parts[familyIndex] === '/') { lineHeight = parts[familyIndex + 1] ?? ''; familyIndex += 2; }
    const family = parts.slice(familyIndex).join(' ');
    if (!family || fontFamily(family) === undefined) return undefined;
    return [['font-size', parts[sizeIndex]!], ['font-family', family], ['font-weight', weight], ['font-style', style], ['font-variant', variant], ['font-stretch', 'normal'], ['line-height', lineHeight]];
  }
  return [[property, raw]];
}

/** Expanded declarations preserve source order/importance and original raw values. */
export function normalizeDeclarations(declarations: ImportedDeclaration[], options: NormalizationOptions = {}): ImportedDeclaration[] {
  return declarations.flatMap(declaration => {
    const property = declaration.property.startsWith('--') ? declaration.property : declaration.property.toLowerCase();
    try {
      const resolved = resolve(declaration.value, options);
      const expanded = expand(property, resolved);
      if (!expanded) return [{ ...declaration, property, normalized: undefined, reason: 'Unsupported or context-dependent shorthand; its original value is preserved.' }];
      return expanded.map(([component, value]) => ({ ...declaration, property: component, value: component === property ? declaration.value : value, normalized: undefined, reason: undefined, ...canonical(component, value, options) }));
    } catch (error) {
      return [{ ...declaration, property, normalized: undefined, reason: error instanceof Error ? error.message : 'CSS value cannot be normalized.' }];
    }
  });
}
