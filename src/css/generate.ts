import type { InspectorNode, RGBA } from '../shared/contracts';

const finite = (value: unknown): value is number => typeof value === 'number' && Number.isFinite(value);
const nonnegative = (value: unknown): value is number => finite(value) && value >= 0;
const unitInterval = (value: unknown): value is number => finite(value) && value >= 0 && value <= 1;
const number = (value: number): string => String(Object.is(value, -0) ? 0 : value);
const px = (value: number): string => `${number(value)}px`;

function color(value: RGBA | undefined): string | undefined {
  if (!value || ![value.r, value.g, value.b, value.a].every(unitInterval)) return undefined;
  const channels = [value.r, value.g, value.b].map((channel) => Math.round(channel * 255));
  return value.a === 1
    ? `rgb(${channels.join(', ')})`
    : `rgba(${channels.join(', ')}, ${number(value.a)})`;
}

/** Quote CSS strings without allowing names to introduce declarations or comments. */
function quote(value: string): string {
  return `"${value.replace(/["\\\u0000-\u001f\u007f]/g, (character) => {
    if (character === '"' || character === '\\') return `\\${character}`;
    return `\\${character.charCodeAt(0).toString(16)} `;
  })}"`;
}

function tuple(value: number[], format: (value: number) => string): string | undefined {
  return value.length === 4 && value.every(nonnegative) ? value.map(format).join(' ') : undefined;
}

export interface CSSDeclaration {
  property: string;
  value: string;
  /** Complete declaration, including its trailing semicolon, without indentation. */
  declaration: string;
}

/** Single source of validated declarations for property rows and the complete CSS block. */
export function generateDeclarations(node: InspectorNode): CSSDeclaration[] {
  const declarations: CSSDeclaration[] = [];
  const add = (property: string, value: string | undefined): void => {
    if (value !== undefined) declarations.push({ property, value, declaration: `${property}: ${value};` });
  };
  if (nonnegative(node.width) || nonnegative(node.height)) add('box-sizing', 'border-box');
  if (nonnegative(node.width)) add('width', px(node.width));
  if (nonnegative(node.height)) add('height', px(node.height));

  const layout = node.layout;
  if (layout && (layout.direction === 'row' || layout.direction === 'column')) {
    add('display', 'flex');
    add('flex-direction', layout.direction);
    if (layout.alignItems && ['flex-start', 'center', 'flex-end', 'baseline'].includes(layout.alignItems)) {
      add('align-items', layout.alignItems);
    }
    if (layout.justifyContent && ['flex-start', 'center', 'flex-end', 'space-between'].includes(layout.justifyContent)) {
      add('justify-content', layout.justifyContent);
    }
    if (nonnegative(layout.gap)) add('gap', px(layout.gap));
    if (Array.isArray(layout.padding)) add('padding', tuple(layout.padding, px));
  }

  add('background-color', color(node.backgroundColor));
  add('color', color(node.color));
  if (node.border && nonnegative(node.border.width)) {
    const borderColor = color(node.border.color);
    if (borderColor) add('border', `${px(node.border.width)} solid ${borderColor}`);
  }
  if (nonnegative(node.borderRadius)) add('border-radius', px(node.borderRadius));
  else if (Array.isArray(node.borderRadius)) add('border-radius', tuple(node.borderRadius, px));
  if (unitInterval(node.opacity)) add('opacity', number(node.opacity));

  const typography = node.typography;
  if (typography) {
    if (typeof typography.fontFamily === 'string' && typography.fontFamily.trim()) {
      add('font-family', quote(typography.fontFamily));
    }
    if (nonnegative(typography.fontSize)) add('font-size', px(typography.fontSize));
    if (finite(typography.fontWeight) && typography.fontWeight >= 1 && typography.fontWeight <= 1000) {
      add('font-weight', number(typography.fontWeight));
    }
    const lineHeight = typography.lineHeight;
    if (lineHeight && nonnegative(lineHeight.value) && (lineHeight.unit === 'px' || lineHeight.unit === '%')) {
      add('line-height', `${number(lineHeight.value)}${lineHeight.unit}`);
    }
    const spacing = typography.letterSpacing;
    if (spacing && finite(spacing.value) && (spacing.unit === 'px' || spacing.unit === 'em')) {
      add('letter-spacing', `${number(spacing.value)}${spacing.unit}`);
    }
  }
  return declarations;
}

/** Generate only representable declarations from the API-independent inspector contract. */
export function generateCSS(node: InspectorNode): string {
  return ['.inspected-element {', ...generateDeclarations(node).map(item => `  ${item.declaration}`), '}'].join('\n');
}
