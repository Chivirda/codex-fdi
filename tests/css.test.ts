import { describe, expect, it } from 'vitest';
import { generateCSS, generateDeclarations } from '../src/css/generate';
import type { InspectorNode } from '../src/shared/contracts';

const base: InspectorNode = { id: '1', name: 'Example', type: 'FRAME', warnings: [] };
const black = { r: 0, g: 0, b: 0, a: 1 };

describe('generateCSS', () => {
  it('generates dimensions for an ordinary frame without inventing flex properties', () => {
    expect(generateCSS({ ...base, width: 320, height: 200 })).toBe(
      '.inspected-element {\n  box-sizing: border-box;\n  width: 320px;\n  height: 200px;\n}',
    );
  });

  it('generates auto layout direction, alignment, gap and ordered padding', () => {
    expect(generateCSS({ ...base, layout: {
      direction: 'column', alignItems: 'center', justifyContent: 'space-between',
      gap: 12.5, padding: [8, 16, 24, 32],
    } })).toBe('.inspected-element {\n  display: flex;\n  flex-direction: column;\n  align-items: center;\n  justify-content: space-between;\n  gap: 12.5px;\n  padding: 8px 16px 24px 32px;\n}');
  });

  it('generates typography and text color independently from backgrounds', () => {
    const css = generateCSS({ ...base, type: 'TEXT', color: black, typography: {
      fontFamily: 'Inter', fontSize: 16, fontWeight: 450,
      lineHeight: { unit: '%', value: 150 }, letterSpacing: { unit: 'em', value: -0.02 },
    } });
    expect(css).toContain('color: rgb(0, 0, 0);');
    expect(css).toContain('font-family: "Inter";');
    expect(css).toContain('font-size: 16px;');
    expect(css).toContain('font-weight: 450;');
    expect(css).toContain('line-height: 150%;');
    expect(css).toContain('letter-spacing: -0.02em;');
    expect(css).not.toContain('background-color');
  });

  it('generates fills, uniform border, and independent layer opacity', () => {
    const css = generateCSS({ ...base, backgroundColor: { r: 1, g: 0.5, b: 0, a: 0.25 },
      border: { width: 2, color: black }, opacity: 0.5 });
    expect(css).toContain('background-color: rgba(255, 128, 0, 0.25);');
    expect(css).toContain('border: 2px solid rgb(0, 0, 0);');
    expect(css).toContain('opacity: 0.5;');
  });

  it('keeps padding and inside borders within the exported Figma dimensions', () => {
    const css = generateCSS({ ...base, width: 200, border: { width: 2, color: black },
      layout: { direction: 'row', padding: [8, 8, 8, 8] } });
    expect(css).toContain('box-sizing: border-box;');
    expect(css).toContain('width: 200px;');
    expect(css).toContain('padding: 8px 8px 8px 8px;');
    expect(css).toContain('border: 2px solid rgb(0, 0, 0);');
    expect(generateCSS({ ...base, height: 10 })).toContain('box-sizing: border-box;');
    expect(generateCSS(base)).not.toContain('box-sizing');
  });

  it('supports uniform and individual corner radii', () => {
    expect(generateCSS({ ...base, borderRadius: 8 })).toContain('border-radius: 8px;');
    expect(generateCSS({ ...base, borderRadius: [1, 2, 3, 4] })).toContain('border-radius: 1px 2px 3px 4px;');
  });

  it('omits absent and unsupported properties', () => {
    expect(generateCSS({ ...base, warnings: ['Mixed fill omitted.'] })).toBe('.inspected-element {\n}');
  });

  it('omits invalid finite/range values rather than emitting broken CSS', () => {
    expect(generateCSS({ ...base, width: NaN, height: -1, opacity: 2,
      borderRadius: [1, Infinity, 2, 3], backgroundColor: { ...black, r: 2 },
      border: { width: -1, color: black }, typography: { fontSize: Infinity, fontWeight: 1001,
        lineHeight: { unit: 'px', value: -1 } },
    })).toBe('.inspected-element {\n}');
  });

  it('preserves valid zero values and pixel text metrics', () => {
    const css = generateCSS({ ...base, width: 0, height: -0, opacity: 0, borderRadius: 0,
      typography: { lineHeight: { unit: 'px', value: 24 }, letterSpacing: { unit: 'px', value: 0 } } });
    expect(css).toContain('width: 0px;');
    expect(css).toContain('height: 0px;');
    expect(css).toContain('opacity: 0;');
    expect(css).toContain('border-radius: 0px;');
    expect(css).toContain('line-height: 24px;');
    expect(css).toContain('letter-spacing: 0px;');
  });

  it('escapes CSS string quotes, slashes and controls without interpolating layer names', () => {
    const css = generateCSS({ ...base, name: '*/ } body {', typography: { fontFamily: 'A"\\\nB' } });
    expect(css).toContain('font-family: "A\\"\\\\\\a B";');
    expect(css).not.toContain('body');
  });

  it('does not invent a border when its color cannot be represented', () => {
    expect(generateCSS({ ...base, border: { width: 1, color: { ...black, a: NaN } } })).not.toContain('border:');
  });
});

describe('generateDeclarations', () => {
  it('provides ordered property values and complete copyable declarations', () => {
    expect(generateDeclarations({ ...base, width: 120, opacity: 0.5 })).toEqual([
      { property: 'box-sizing', value: 'border-box', declaration: 'box-sizing: border-box;' },
      { property: 'width', value: '120px', declaration: 'width: 120px;' },
      { property: 'opacity', value: '0.5', declaration: 'opacity: 0.5;' },
    ]);
  });

  it('is the single source of the CSS block for all supported property groups', () => {
    const node: InspectorNode = { ...base, width: 320, height: 200,
      layout: { direction: 'row', alignItems: 'center', justifyContent: 'flex-start', gap: 12, padding: [4, 8, 4, 8] },
      backgroundColor: black, color: { ...black, a: 0.5 }, border: { width: 1, color: black },
      borderRadius: [1, 2, 3, 4], opacity: 0.8,
      typography: { fontFamily: 'Inter', fontSize: 16, fontWeight: 400,
        lineHeight: { unit: '%', value: 150 }, letterSpacing: { unit: 'em', value: -0.02 } },
    };
    const declarations = generateDeclarations(node);
    expect(declarations).toHaveLength(19);
    expect(generateCSS(node)).toBe(['.inspected-element {', ...declarations.map(item => `  ${item.declaration}`), '}'].join('\n'));
    for (const item of declarations) {
      expect(item.declaration).toBe(`${item.property}: ${item.value};`);
      expect(item.declaration.endsWith(';')).toBe(true);
    }
  });

  it('omits unsupported and invalid values from both the list and full block', () => {
    const node: InspectorNode = { ...base, width: Infinity, height: -5, opacity: 2,
      backgroundColor: { ...black, a: NaN }, borderRadius: [0, 1, -1, 3],
      typography: { fontFamily: '', fontWeight: 0, lineHeight: { unit: 'px', value: NaN } },
      warnings: ['Unsupported paints were omitted.'],
    };
    expect(generateDeclarations(node)).toEqual([]);
    expect(generateCSS(node)).toBe('.inspected-element {\n}');
  });

  it('returns the same escaped font string for property copying and full CSS', () => {
    const node: InspectorNode = { ...base, typography: { fontFamily: 'A"\\\nB' } };
    const expected = '"A\\"\\\\\\a B"';
    expect(generateDeclarations(node)).toEqual([
      { property: 'font-family', value: expected, declaration: `font-family: ${expected};` },
    ]);
    expect(generateCSS(node)).toBe(`.inspected-element {\n  font-family: ${expected};\n}`);
  });
});
