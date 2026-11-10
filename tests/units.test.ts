import { describe, expect, it } from 'vitest';
import { formatSpacingValue } from '../src/spacing/units';

describe('spacing unit formatting', () => {
  it('formats pixels and trims trailing fractional zeros', () => {
    expect(formatSpacingValue(24, 'px')).toBe('24px');
    expect(formatSpacingValue(1.25, 'px')).toBe('1.25px');
    expect(formatSpacingValue(-12.5, 'px')).toBe('-12.5px');
    expect(formatSpacingValue(-0, 'px')).toBe('0px');
    expect(formatSpacingValue(1.123456789, 'px')).toBe('1.123457px');
  });
  it('converts using default and user-defined rem bases without changing signs', () => {
    expect(formatSpacingValue(24, 'rem')).toBe('1.5rem');
    expect(formatSpacingValue(24, 'rem', 12)).toBe('2rem');
    expect(formatSpacingValue(-10, 'rem', 20)).toBe('-0.5rem');
    expect(formatSpacingValue(1, 'rem', 3)).toBe('0.333333rem');
    expect(formatSpacingValue(0, 'rem')).toBe('0rem');
  });
  it('rejects invalid values and invalid rem bases', () => {
    for (const value of [NaN, Infinity, -Infinity]) {
      expect(formatSpacingValue(value, 'px')).toBeUndefined();
      expect(formatSpacingValue(value, 'rem')).toBeUndefined();
    }
    for (const base of [0, -1, NaN, Infinity, -Infinity]) {
      expect(formatSpacingValue(16, 'rem', base)).toBeUndefined();
      expect(formatSpacingValue(16, 'px', base)).toBe('16px');
    }
  });
  it('rejects overflow during rem conversion and normalizes rounded negative zero', () => {
    expect(formatSpacingValue(Number.MAX_VALUE, 'rem', Number.MIN_VALUE)).toBeUndefined();
    expect(formatSpacingValue(-0.00000001, 'px')).toBe('0px');
    expect(formatSpacingValue(-0.00000001, 'rem')).toBe('0rem');
  });
});
