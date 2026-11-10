import { describe, expect, it } from 'vitest';
import { calculateSpacing } from '../src/geometry/spacing';
import type { GeometryInput, Matrix, SpacingValues } from '../src/shared/spacing';

const identity: Matrix = [[1, 0, 0], [0, 1, 0]];
const input = (patch: Partial<GeometryInput> = {}): GeometryInput => ({
  width: 30, height: 40, nodeTransform: [[1, 0, 10], [0, 1, 20]],
  parent: { name: 'Container', type: 'FRAME', width: 200, height: 150, transform: identity }, ...patch,
});
function expectValues(actual: ReturnType<typeof calculateSpacing>, expected: SpacingValues): void {
  expect(actual.status).toBe('ready');
  if (actual.status !== 'ready') throw new Error(actual.message);
  for (const key of Object.keys(expected) as (keyof SpacingValues)[]) expect(actual.values[key]).toBeCloseTo(expected[key], 8);
}
const plain: SpacingValues = { x: 10, y: 20, left: 10, top: 20, right: 160, bottom: 90, width: 30, height: 40 };

describe('parent-relative layout geometry', () => {
  it('reports all eight parent-local layout-box measurements', () => {
    const result = calculateSpacing(input());
    expectValues(result, plain);
    expect(result).toMatchObject({ parentName: 'Container', parentType: 'FRAME' });
  });
  it('removes a translated and rotated ancestor coordinate system', () => {
    expectValues(calculateSpacing(input({
      parent: { ...input().parent, transform: [[0, -1, 100], [1, 0, 200]] },
      nodeTransform: [[0, -1, 80], [1, 0, 210]],
    })), plain);
  });
  it('removes a scaled and skewed parent using its inverse rather than page subtraction', () => {
    expectValues(calculateSpacing(input({
      nodeTransform: [[1, 0.5, 120], [0.25, 1, 219]],
      parent: { ...input().parent, transform: [[1, 0.5, 100], [0.25, 1, 200]] },
    })), { x: 12, y: 16, left: 12, top: 16, right: 158, bottom: 94, width: 30, height: 40 });
  });
  it('retains negative coordinates and signed outside distances', () => {
    expectValues(calculateSpacing(input({ width: 220, height: 180, nodeTransform: [[1, 0, -10], [0, 1, -5]] })), {
      x: -10, y: -5, left: -10, top: -5, right: -10, bottom: -25, width: 220, height: 180,
    });
  });
  it('uses all four corners for a 90-degree rotation', () => {
    expectValues(calculateSpacing(input({ width: 30, height: 40, nodeTransform: [[0, -1, 70], [1, 0, 20]] })), {
      x: 30, y: 20, left: 30, top: 20, right: 130, bottom: 100, width: 40, height: 30,
    });
  });
  it('calculates the parent-axis bounding box at 45 degrees', () => {
    const c = Math.SQRT1_2;
    expectValues(calculateSpacing(input({ width: 20, height: 10, nodeTransform: [[c, -c, 50], [c, c, 30]] })), {
      x: 50 - 10 * c, y: 30, left: 50 - 10 * c, top: 30,
      right: 150 - 20 * c, bottom: 120 - 30 * c, width: 30 * c, height: 30 * c,
    });
  });
  it('supports a skewed node without confusing the origin and extrema', () => {
    expectValues(calculateSpacing(input({ width: 20, height: 40, nodeTransform: [[1, 0.5, 10], [0.25, 1, 20]] })), {
      x: 10, y: 20, left: 10, top: 20, right: 150, bottom: 85, width: 40, height: 45,
    });
  });
  it('supports reflected node and parent coordinate systems', () => {
    expectValues(calculateSpacing(input({ nodeTransform: [[-1, 0, 70], [0, 1, 20]] })), {
      x: 40, y: 20, left: 40, top: 20, right: 130, bottom: 90, width: 30, height: 40,
    });
    expectValues(calculateSpacing(input({ parent: { ...input().parent, transform: [[-1, 0, 200], [0, 1, 0]] },
      nodeTransform: [[-1, 0, 190], [0, 1, 20]],
    })), plain);
  });
  it('permits zero layout dimensions with an invertible transform', () => {
    expectValues(calculateSpacing(input({ height: 0 })), { ...plain, height: 0, bottom: 130 });
  });
  it('rejects singular or near-singular parent and node matrices', () => {
    const singular: Matrix[] = [ [[0, 0, 0], [0, 1, 0]], [[1, 1, 0], [1, 1, 0]], [[1, 0, 0], [0, 1e-12, 0]] ];
    for (const transform of singular) {
      expect(calculateSpacing(input({ parent: { ...input().parent, transform } })).status).toBe('unsupported');
      expect(calculateSpacing(input({ nodeTransform: transform })).status).toBe('unsupported');
    }
  });
  it('rejects nonfinite matrices, dimensions and arithmetic overflow', () => {
    for (const value of [NaN, Infinity, -Infinity]) {
      expect(calculateSpacing(input({ width: value })).status).toBe('unsupported');
      expect(calculateSpacing(input({ parent: { ...input().parent, height: value } })).status).toBe('unsupported');
      expect(calculateSpacing(input({ nodeTransform: [[1, 0, value], [0, 1, 20]] })).status).toBe('unsupported');
      expect(calculateSpacing(input({ parent: { ...input().parent, transform: [[1, value, 0], [0, 1, 0]] } })).status).toBe('unsupported');
    }
    expect(calculateSpacing(input({ width: -1 })).status).toBe('unsupported');
    expect(calculateSpacing(input({ parent: { ...input().parent, width: -1 } })).status).toBe('unsupported');
    expect(calculateSpacing(input({ width: 1e308, nodeTransform: [[10, 0, 0], [0, 10, 0]] })).status).toBe('unsupported');
  });
});
