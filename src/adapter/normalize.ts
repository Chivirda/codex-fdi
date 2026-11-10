import type { InspectorNode, RGBA } from '../shared/contracts';

type Fields = Record<string, unknown>;
const fields = (value: unknown): Fields => value !== null && typeof value === 'object' ? value as Fields : {};
const finite = (value: unknown): value is number => typeof value === 'number' && Number.isFinite(value);
const nonnegative = (value: unknown): value is number => finite(value) && value >= 0;
const unit = (value: unknown): value is number => finite(value) && value >= 0 && value <= 1;

/** Reads resolved values only; never serializes API nodes, symbols, or mixed values. */
export function normalizeNode(node: SceneNode): InspectorNode {
  const source = fields(node);
  const result: InspectorNode = { id: node.id, name: node.name, type: node.type, warnings: [] };
  const warn = (message: string): void => { result.warnings.push(message); };
  for (const key of ['width', 'height'] as const) {
    if (nonnegative(source[key])) result[key] = source[key];
  }
  if (unit(source.opacity)) result.opacity = source.opacity;

  const paintColor = (value: unknown, label: string): RGBA | undefined => {
    if (value === undefined) return undefined;
    if (!Array.isArray(value)) { warn(`${label}: mixed or unavailable paints were omitted.`); return undefined; }
    const visible = value.map(fields).filter(paint => paint.visible !== false);
    if (!visible.length) return undefined;
    if (visible.length !== 1 || visible[0]?.type !== 'SOLID') {
      warn(`${label}: only a single solid paint is supported.`); return undefined;
    }
    const paint = visible[0];
    if (paint.blendMode !== undefined && paint.blendMode !== 'NORMAL') {
      warn(`${label}: paint blending cannot be represented by a CSS color.`); return undefined;
    }
    const color = fields(paint.color);
    const alpha = paint.opacity === undefined ? 1 : paint.opacity;
    if (unit(color.r) && unit(color.g) && unit(color.b) && unit(alpha)) {
      return { r: color.r, g: color.g, b: color.b, a: alpha };
    }
    warn(`${label}: invalid color was omitted.`);
    return undefined;
  };
  const fill = paintColor(source.fills, node.type === 'TEXT' ? 'Text color' : 'Background');
  if (fill) {
    if (node.type === 'TEXT') result.color = fill;
    else result.backgroundColor = fill;
  }

  const strokeColor = paintColor(source.strokes, 'Border');
  if (strokeColor) {
    const sides = ['strokeTopWeight', 'strokeRightWeight', 'strokeBottomWeight', 'strokeLeftWeight'];
    const unequalSides = sides.some(side => source[side] !== undefined && source[side] !== source.strokeWeight);
    const dashed = Array.isArray(source.dashPattern) && source.dashPattern.length > 0;
    if (node.type === 'TEXT' || node.type === 'VECTOR' || node.type === 'LINE' || node.type === 'BOOLEAN_OPERATION' || node.type === 'STAR' || node.type === 'POLYGON' || node.type === 'ELLIPSE') {
      warn('Border: path and text strokes do not map to a rectangular CSS border.');
    } else if (!nonnegative(source.strokeWeight) || unequalSides || dashed || source.strokeAlign !== 'INSIDE') {
      warn('Border: only uniform, solid, inside strokes are supported.');
    } else if (source.strokeWeight > 0) result.border = { width: source.strokeWeight, color: strokeColor };
  }

  if (nonnegative(source.cornerRadius)) result.borderRadius = source.cornerRadius;
  else if ('cornerRadius' in source) {
    const corners = [source.topLeftRadius, source.topRightRadius, source.bottomRightRadius, source.bottomLeftRadius];
    if (corners.every(nonnegative)) result.borderRadius = corners as [number, number, number, number];
    else warn('Border radius: mixed or unavailable corners were omitted.');
  }
  if (finite(source.cornerSmoothing) && source.cornerSmoothing > 0) warn('Corner smoothing is not represented in CSS.');

  if (source.layoutMode === 'HORIZONTAL' || source.layoutMode === 'VERTICAL') {
    if (source.layoutWrap === 'WRAP') warn('Wrapped Auto Layout is not supported; flex layout was omitted.');
    else {
      const layout: NonNullable<InspectorNode['layout']> = { direction: source.layoutMode === 'HORIZONTAL' ? 'row' : 'column' };
      switch (source.primaryAxisAlignItems) {
        case 'MIN': layout.justifyContent = 'flex-start'; break;
        case 'CENTER': layout.justifyContent = 'center'; break;
        case 'MAX': layout.justifyContent = 'flex-end'; break;
        case 'SPACE_BETWEEN': layout.justifyContent = 'space-between'; break;
      }
      switch (source.counterAxisAlignItems) {
        case 'MIN': layout.alignItems = 'flex-start'; break;
        case 'CENTER': layout.alignItems = 'center'; break;
        case 'MAX': layout.alignItems = 'flex-end'; break;
        case 'BASELINE': layout.alignItems = 'baseline'; break;
      }
      if (nonnegative(source.itemSpacing)) {
        if (source.primaryAxisAlignItems !== 'SPACE_BETWEEN') layout.gap = source.itemSpacing;
      } else if (source.itemSpacing !== undefined) warn('Negative or mixed Auto Layout gap was omitted.');
      const padding = [source.paddingTop, source.paddingRight, source.paddingBottom, source.paddingLeft];
      if (padding.every(nonnegative)) layout.padding = padding as [number, number, number, number];
      result.layout = layout;
    }
  } else if (source.layoutMode !== undefined && source.layoutMode !== 'NONE') warn('This layout mode is not supported.');

  if (node.type === 'TEXT') {
    const typography: NonNullable<InspectorNode['typography']> = {};
    const font = fields(source.fontName);
    if (typeof font.family === 'string' && font.family.length) typography.fontFamily = font.family;
    else warn('Font family: mixed or unavailable value was omitted.');
    if (nonnegative(source.fontSize)) typography.fontSize = source.fontSize;
    else warn('Font size: mixed or unavailable value was omitted.');
    if (finite(source.fontWeight) && source.fontWeight >= 1 && source.fontWeight <= 1000) typography.fontWeight = source.fontWeight;
    else warn('Font weight: mixed or unavailable value was omitted; style names are not guessed.');
    const lineHeight = fields(source.lineHeight);
    if (nonnegative(lineHeight.value) && (lineHeight.unit === 'PIXELS' || lineHeight.unit === 'PERCENT')) {
      typography.lineHeight = { unit: lineHeight.unit === 'PIXELS' ? 'px' : '%', value: lineHeight.value };
    } else warn('Line height: automatic, mixed or unavailable value was omitted.');
    const letterSpacing = fields(source.letterSpacing);
    if (finite(letterSpacing.value) && (letterSpacing.unit === 'PIXELS' || letterSpacing.unit === 'PERCENT')) {
      typography.letterSpacing = { unit: letterSpacing.unit === 'PIXELS' ? 'px' : 'em', value: letterSpacing.unit === 'PIXELS' ? letterSpacing.value : letterSpacing.value / 100 };
    } else warn('Letter spacing: mixed or unavailable value was omitted.');
    if (Object.keys(typography).length) result.typography = typography;
  }
  if (Array.isArray(source.effects) && source.effects.some(effect => fields(effect).visible !== false)) warn('Effects such as shadows and blur are outside this MVP.');
  if (source.blendMode !== undefined && source.blendMode !== 'NORMAL' && source.blendMode !== 'PASS_THROUGH') warn('Node blend mode is not represented in CSS.');
  if (source.visible === false) warn('This layer is hidden in Figma; visibility is not included in CSS.');
  if (['VECTOR', 'LINE', 'BOOLEAN_OPERATION', 'STAR', 'POLYGON', 'ELLIPSE'].includes(node.type)) {
    warn('Shape geometry is not exported; these properties alone do not recreate the shape.');
  }
  return result;
}
