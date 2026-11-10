import { describe, expect, it } from 'vitest';
import { normalizeNode } from '../src/adapter/normalize';

const node = (properties: Record<string, unknown> = {}): SceneNode => ({
  id: '1:1', name: 'Example', type: 'FRAME', width: 100, height: 50,
  ...properties,
} as unknown as SceneNode);
const solid = { type: 'SOLID', color: { r: 1, g: 0.5, b: 0 }, opacity: 0.5 };

describe('Figma adapter', () => {
  it('normalizes dimensions, paint alpha, and uniform inside strokes', () => {
    const actual = normalizeNode(node({ fills: [solid], opacity: 0.8, strokes: [solid], strokeWeight: 2, strokeAlign: 'INSIDE' }));
    expect(actual.backgroundColor).toEqual({ r: 1, g: 0.5, b: 0, a: 0.5 });
    expect(actual.opacity).toBe(0.8);
    expect(actual.border?.width).toBe(2);
    expect(actual.width).toBe(100);
  });
  it('omits mixed fills, multiple paints, and unsupported stroke alignment', () => {
    expect(normalizeNode(node({ fills: Symbol('mixed') })).backgroundColor).toBeUndefined();
    expect(normalizeNode(node({ fills: [solid, solid] })).warnings.length).toBeGreaterThan(0);
    const actual = normalizeNode(node({ strokes: [solid], strokeWeight: 2, strokeAlign: 'CENTER' }));
    expect(actual.border).toBeUndefined();
    expect(actual.warnings).toContain('Border: only uniform, solid, inside strokes are supported.');
  });
  it('maps Auto Layout and omits a negative gap', () => {
    const actual = normalizeNode(node({ layoutMode: 'HORIZONTAL', primaryAxisAlignItems: 'SPACE_BETWEEN', counterAxisAlignItems: 'CENTER', itemSpacing: -5, paddingTop: 1, paddingRight: 2, paddingBottom: 3, paddingLeft: 4 }));
    expect(actual.layout).toEqual({ direction: 'row', justifyContent: 'space-between', alignItems: 'center', padding: [1, 2, 3, 4] });
    expect(normalizeNode(node({ layoutMode: 'HORIZONTAL', layoutWrap: 'WRAP' })).layout).toBeUndefined();
  });
  it('reads text metrics and converts percentage letter spacing to em', () => {
    const actual = normalizeNode(node({ type: 'TEXT', fills: [solid], fontName: { family: 'Inter', style: 'Bold' }, fontSize: 20, fontWeight: 700, lineHeight: { unit: 'PERCENT', value: 120 }, letterSpacing: { unit: 'PERCENT', value: -2 } }));
    expect(actual.color?.a).toBe(0.5);
    expect(actual.backgroundColor).toBeUndefined();
    expect(actual.typography).toEqual({ fontFamily: 'Inter', fontSize: 20, fontWeight: 700, lineHeight: { unit: '%', value: 120 }, letterSpacing: { unit: 'em', value: -0.02 } });
  });
  it('does not guess mixed typography or automatic line height', () => {
    const actual = normalizeNode(node({ type: 'TEXT', fontName: Symbol(), fontSize: Symbol(), fontWeight: Symbol(), lineHeight: { unit: 'AUTO' }, letterSpacing: Symbol() }));
    expect(actual.typography).toBeUndefined();
    expect(actual.warnings).toHaveLength(5);
    expect(() => JSON.stringify(actual)).not.toThrow();
  });
  it('normalizes independent corner radii and rejects non-finite numbers', () => {
    const actual = normalizeNode(node({ cornerRadius: Symbol(), topLeftRadius: 1, topRightRadius: 2, bottomRightRadius: 3, bottomLeftRadius: 4, width: Infinity, opacity: NaN }));
    expect(actual.borderRadius).toEqual([1, 2, 3, 4]);
    expect(actual.width).toBeUndefined();
    expect(actual.opacity).toBeUndefined();
  });
  it('ignores hidden paints and refuses dashed, nonuniform and text strokes', () => {
    expect(normalizeNode(node({ fills: [{ ...solid, visible: false }, solid] })).backgroundColor?.a).toBe(0.5);
    for (const properties of [
      { dashPattern: [2, 2] }, { strokeTopWeight: 3 }, { type: 'TEXT' },
    ]) {
      const actual = normalizeNode(node({ strokes: [solid], strokeWeight: 2, strokeAlign: 'INSIDE', ...properties }));
      expect(actual.border).toBeUndefined();
      expect(actual.warnings.length).toBeGreaterThan(0);
    }
  });
});
