export type SpacingUnit = 'px' | 'rem';
export const DEFAULT_REM_BASE = 16;

/** Display/copy formatting only. Geometry remains in parent-local pixels. */
export function formatSpacingValue(value: number, unit: SpacingUnit, base = DEFAULT_REM_BASE): string | undefined {
  if (!Number.isFinite(value) || (unit !== 'px' && unit !== 'rem')) return undefined;
  if (unit === 'rem' && (!Number.isFinite(base) || base <= 0)) return undefined;
  const converted = unit === 'rem' ? value / base : value;
  if (!Number.isFinite(converted)) return undefined;
  const rounded = Number(converted.toFixed(6));
  return `${Object.is(rounded, -0) ? 0 : rounded}${unit}`;
}
