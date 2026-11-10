import type { InspectorNode, InspectorState } from '../shared/contracts';
import { parseSectionState } from '../shared/sections';
import type { SectionState } from '../shared/sections';

type ObjectValue = Record<string, unknown>;
const object = (value: unknown): value is ObjectValue => typeof value === 'object' && value !== null && !Array.isArray(value);
const finite = (value: unknown): value is number => typeof value === 'number' && Number.isFinite(value);
const optional = (value: unknown, check: (value: unknown) => boolean): boolean => value === undefined || check(value);
const text = (value: unknown): value is string => typeof value === 'string';
const tuple = (value: unknown): boolean => Array.isArray(value) && value.length === 4 && value.every(finite);
const color = (value: unknown): boolean => object(value) && ['r', 'g', 'b', 'a'].every(key => finite(value[key]) && value[key] >= 0 && value[key] <= 1);
const choice = (value: unknown, choices: string[]): boolean => typeof value === 'string' && choices.includes(value);

export function parseResizeError(data: unknown): string | undefined {
  if (!object(data) || !object(data.pluginMessage)) return undefined;
  return data.pluginMessage.type === 'resize-error' && text(data.pluginMessage.message) ? data.pluginMessage.message : undefined;
}

export function parseSectionMessage(data: unknown): SectionState | undefined {
  if (!object(data) || !object(data.pluginMessage) || data.pluginMessage.type !== 'section-state') return undefined;
  return parseSectionState(data.pluginMessage.sections);
}

function node(value: unknown): value is InspectorNode {
  if (!object(value) || !text(value.id) || !text(value.name) || !text(value.type) || !Array.isArray(value.warnings) || !value.warnings.every(text)) return false;
  if (!['width', 'height', 'opacity'].every(key => optional(value[key], finite))) return false;
  if (!optional(value.characters, text)) return false;
  if (!['backgroundColor', 'color'].every(key => optional(value[key], color))) return false;
  if (!optional(value.borderRadius, item => finite(item) || tuple(item))) return false;
  if (!optional(value.border, item => object(item) && finite(item.width) && color(item.color))) return false;
  if (!optional(value.spacing, item => object(item) && (
    (item.status === 'unsupported' && text(item.message))
    || (item.status === 'ready' && text(item.parentName) && text(item.parentType)
      && Array.isArray(item.warnings) && item.warnings.every(text)
      && object(item.values) && ['top', 'right', 'bottom', 'left', 'x', 'y', 'width', 'height'].every(key => finite((item.values as ObjectValue)[key])))
  ))) return false;
  if (!optional(value.layout, item => object(item)
    && choice(item.direction, ['row', 'column'])
    && optional(item.alignItems, alignment => choice(alignment, ['flex-start', 'center', 'flex-end', 'baseline']))
    && optional(item.justifyContent, alignment => choice(alignment, ['flex-start', 'center', 'flex-end', 'space-between']))
    && optional(item.gap, finite) && optional(item.padding, tuple))) return false;
  return optional(value.typography, item => object(item)
    && optional(item.fontFamily, text)
    && optional(item.fontSize, finite)
    && optional(item.fontWeight, finite)
    && optional(item.lineHeight, height => object(height) && finite(height.value) && choice(height.unit, ['px', '%']))
    && optional(item.letterSpacing, spacing => object(spacing) && finite(spacing.value) && choice(spacing.unit, ['px', 'em'])));
}

/** Figma relays messages into the UI; MessageEvent.source is not a reliable host identity. */
export function parseInspectorMessage(data: unknown): InspectorState | undefined {
  if (!object(data) || !object(data.pluginMessage) || data.pluginMessage.type !== 'inspector-state') return undefined;
  const state = data.pluginMessage.state;
  if (!object(state)) return undefined;
  switch (state.status) {
    case 'loading': case 'empty': return { status: state.status };
    case 'multiple': return finite(state.count) && Number.isInteger(state.count) && state.count > 1 ? { status: 'multiple', count: state.count } : undefined;
    case 'error': return text(state.message) ? { status: 'error', message: state.message } : undefined;
    case 'ready': return node(state.node) && text(state.css) ? { status: 'ready', node: state.node, css: state.css } : undefined;
    default: return undefined;
  }
}
