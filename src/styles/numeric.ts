import valueParser from 'postcss-value-parser';

/** Float32 layout noise: 0.0001 px absolute plus 2e-7 relative.
 * Scalar opacity is tighter (1e-6); font weights remain exact.
 * Unknown syntax/units always falls back to exact canonical equality. */
export function equivalent(property: string, left: string | undefined, right: string | undefined): boolean {
  if (left === undefined || right === undefined) return false;
  if (left === right) return true;
  const a = valueParser(left).nodes.filter(node => node.type !== 'space');
  const b = valueParser(right).nodes.filter(node => node.type !== 'space');
  if (a.length !== b.length || !a.length) return false;
  return a.every((node, i) => {
    const other = b[i]!;
    if (node.type !== 'word' || other.type !== 'word') return false;
    const x = valueParser.unit(node.value), y = valueParser.unit(other.value);
    if (!x || !y || x.unit !== y.unit) return false;
    const number = /^[+-]?(?:\d*\.\d+|\d+)(?:e[+-]?\d+)?$/i;
    if (!number.test(x.number) || !number.test(y.number)) return false;
    const nx = Number(x.number), ny = Number(y.number);
    if (!Number.isFinite(nx) || !Number.isFinite(ny)) return false;
    const absolute = x.unit === 'px' ? 1e-4 : property === 'opacity' && x.unit === '' ? 1e-6 : 0;
    if (!absolute) return false;
    return Math.abs(nx - ny) <= absolute + (x.unit === 'px' ? 2e-7 * Math.max(Math.abs(nx), Math.abs(ny)) : 0);
  });
}

/** Presentation only; never feed rounded text back into comparison or imported CSS. */
export function formatMatchValue(value: string | undefined): string {
  if (value === undefined) return '—';
  const ast = valueParser(value);
  ast.walk(node => {
    if (node.type !== 'word') return;
    const parsed = valueParser.unit(node.value);
    if (!parsed || !/^[+-]?(?:\d*\.\d+|\d+)(?:e[+-]?\d+)?$/i.test(parsed.number)) return;
    const number = Number(parsed.number);
    if (Number.isFinite(number)) node.value = `${Number(number.toFixed(4))}${parsed.unit}`;
  });
  return ast.toString();
}
