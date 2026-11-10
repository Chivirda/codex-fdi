import { describe, expect, it } from 'vitest';
import { inspectSpacing } from '../src/adapter/spacing';
import type { Matrix } from '../src/shared/spacing';

const identity: Matrix = [[1, 0, 0], [0, 1, 0]];
const parent = (patch: Record<string, unknown> = {}): Record<string, unknown> => ({
  name: 'Parent', type: 'FRAME', width: 200, height: 150, absoluteTransform: identity, ...patch,
});
const node = (patch: Record<string, unknown> = {}): SceneNode => ({
  type: 'RECTANGLE', width: 999, height: 999, absoluteTransform: [[1, 0, 10], [0, 1, 20]],
  relativeTransform: [[1, 0, 800], [0, 1, 900]], parent: parent(), ...patch,
} as unknown as SceneNode);
const dimensions = { width: 30, height: 40 };

describe('spacing Figma boundary', () => {
  it('reuses normalized dimensions and absolute transforms instead of conflicting relativeTransform', () => {
    expect(inspectSpacing(node(), dimensions)).toMatchObject({ status: 'ready', values: {
      x: 10, y: 20, left: 10, top: 20, right: 160, bottom: 90, width: 30, height: 40,
    } });
  });
  it('supports all permitted immediate parent containers', () => {
    for (const type of ['FRAME', 'GROUP', 'COMPONENT', 'INSTANCE', 'COMPONENT_SET', 'SECTION']) {
      expect(inspectSpacing(node({ parent: parent({ type }) }), dimensions)).toMatchObject({ status: 'ready', parentType: type });
    }
  });
  it('measures a direct group child in the rotated group axes despite skipped relativeTransform', () => {
    const result = inspectSpacing(node({
      absoluteTransform: [[0, -1, 80], [1, 0, 210]],
      relativeTransform: [[1, 0, 80], [0, 1, 210]],
      parent: parent({ type: 'GROUP', absoluteTransform: [[0, -1, 100], [1, 0, 200]] }),
    }), dimensions);
    expect(result).toMatchObject({ status: 'ready', parentType: 'GROUP', values: { left: 10, top: 20, width: 30, height: 40, right: 160, bottom: 90 } });
  });
  it('does not confuse Auto Layout padding or item gap with measured distances', () => {
    const result = inspectSpacing(node({ parent: parent({ layoutMode: 'HORIZONTAL', paddingLeft: 100, paddingTop: 100, itemSpacing: 77 }) }), dimensions);
    expect(result).toMatchObject({ status: 'ready', values: { left: 10, top: 20, right: 160, bottom: 90 } });
    if (result.status === 'ready') {
      expect(Object.keys(result.values).sort()).toEqual(['bottom', 'height', 'left', 'right', 'top', 'width', 'x', 'y']);
      expect('margin' in result).toBe(false);
      expect('padding' in result).toBe(false);
    }
  });
  it('rejects page, missing or unsupported parents and missing normalized dimensions', () => {
    for (const value of [undefined, null, parent({ type: 'PAGE' }), parent({ type: 'DOCUMENT' }), parent({ type: 'TEXT' })]) {
      expect(inspectSpacing(node({ parent: value }), dimensions).status).toBe('unsupported');
    }
    expect(inspectSpacing(node(), { width: 30 }).status).toBe('unsupported');
    expect(inspectSpacing(node(), { height: 40 }).status).toBe('unsupported');
  });
  it('rejects missing, singular and nonfinite transforms without leaking API values', () => {
    const values = [undefined, Symbol('mixed'), [[1, 0, NaN], [0, 1, 0]], [[0, 0, 0], [0, 0, 0]]];
    for (const absoluteTransform of values) {
      const result = inspectSpacing(node({ absoluteTransform }), dimensions);
      expect(result.status).toBe('unsupported');
      expect(() => JSON.stringify(result)).not.toThrow();
      expect(inspectSpacing(node({ parent: parent({ absoluteTransform }) }), dimensions).status).toBe('unsupported');
    }
  });
});
