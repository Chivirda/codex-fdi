import type { GeometryInput, Matrix, SpacingResult } from '../shared/spacing';

const unsupported = (message: string): SpacingResult => ({ status: 'unsupported', message });
const finite = (value: unknown): value is number => typeof value === 'number' && Number.isFinite(value);
const dimension = (value: unknown): value is number => finite(value) && value >= 0;

function matrix(value: unknown): value is Matrix {
  return Array.isArray(value) && value.length === 2 && value.every(row =>
    Array.isArray(row) && row.length === 3 && row.every(finite));
}

/** Normalize before computing the determinant to avoid overflow/underflow. */
function inverse(value: Matrix): Matrix | undefined {
  const [[a, c, tx], [b, d, ty]] = value;
  const scale = Math.max(Math.abs(a), Math.abs(b), Math.abs(c), Math.abs(d));
  if (!finite(scale) || scale < 1e-12) return undefined;
  const an = a / scale, bn = b / scale, cn = c / scale, dn = d / scale;
  const determinant = an * dn - bn * cn;
  if (!finite(determinant) || Math.abs(determinant) <= 1e-10) return undefined;
  const factor = 1 / scale / determinant;
  const ia = dn * factor, ib = -bn * factor, ic = -cn * factor, id = an * factor;
  const result: Matrix = [[ia, ic, -(ia * tx + ic * ty)], [ib, id, -(ib * tx + id * ty)]];
  return matrix(result) ? result : undefined;
}

/** Layout-rectangle AABB in the immediate parent's local coordinate system. */
export function calculateSpacing(input: GeometryInput): SpacingResult {
  if (!input || !input.parent || !dimension(input.width) || !dimension(input.height)
    || !dimension(input.parent.width) || !dimension(input.parent.height)) {
    return unsupported('Spacing requires finite, nonnegative layout dimensions for the layer and its parent.');
  }
  if (!matrix(input.nodeTransform) || !matrix(input.parent.transform)) {
    return unsupported('Spacing requires valid finite absolute transforms.');
  }
  const parentInverse = inverse(input.parent.transform);
  if (!parentInverse || !inverse(input.nodeTransform)) {
    return unsupported('Spacing is unavailable for singular, near-singular or unstable transforms.');
  }
  const [[a, c], [b, d]] = parentInverse;
  const [[na, nc, ntx], [nb, nd, nty]] = input.nodeTransform;
  // Subtract origins before multiplying to avoid cancellation between two large
  // transformed translations. This is inverse(parentAbsolute) * nodeAbsolute.
  const dx = ntx - input.parent.transform[0][2];
  const dy = nty - input.parent.transform[1][2];
  const relative: Matrix = [
    [a * na + c * nb, a * nc + c * nd, a * dx + c * dy],
    [b * na + d * nb, b * nc + d * nd, b * dx + d * dy],
  ];
  if (!matrix(relative)) return unsupported('Spacing calculation overflowed the supported numeric range.');
  if (!inverse(relative)) return unsupported('Spacing is unavailable for an unstable parent-relative transform.');
  const [[ra, rc, rx], [rb, rd, ry]] = relative;
  const corners = [[0, 0], [input.width, 0], [0, input.height], [input.width, input.height]] as const;
  const xs = corners.map(([x, y]) => ra * x + rc * y + rx);
  const ys = corners.map(([x, y]) => rb * x + rd * y + ry);
  const left = Math.min(...xs), top = Math.min(...ys);
  const maxX = Math.max(...xs), maxY = Math.max(...ys);
  const values = {
    x: left, y: top, left, top,
    width: maxX - left, height: maxY - top,
    right: input.parent.width - maxX,
    bottom: input.parent.height - maxY,
  };
  if (![...xs, ...ys, ...Object.values(values)].every(finite)) {
    return unsupported('Spacing calculation overflowed the supported numeric range.');
  }
  // An offset so large that the rectangle disappears in floating-point arithmetic
  // cannot provide reliable measurements, even though its values remain finite.
  const expectedWidth = Math.abs(ra * input.width) + Math.abs(rc * input.height);
  const expectedHeight = Math.abs(rb * input.width) + Math.abs(rd * input.height);
  const tolerance = 1e-7;
  if (Math.abs(values.width - expectedWidth) > Math.max(1, expectedWidth) * tolerance
    || Math.abs(values.height - expectedHeight) > Math.max(1, expectedHeight) * tolerance) {
    return unsupported('Spacing is unavailable because coordinate precision is insufficient.');
  }
  const warnings = ['Measurements use the transformed layout rectangle, excluding path contours, strokes, shadows and other rendered effects.'];
  const linearScale = Math.max(1, Math.abs(ra), Math.abs(rb), Math.abs(rc), Math.abs(rd));
  if (Math.abs(rb) > 1e-10 * linearScale || Math.abs(rc) > 1e-10 * linearScale) {
    warnings.push('Rotation or skew is projected onto the parent axes; width and height describe the enclosing bounding box.');
  }
  if (input.parent.type === 'GROUP') warnings.push('Group bounds are derived from their children; spacing is relative to those derived bounds.');
  return { status: 'ready', parentName: input.parent.name, parentType: input.parent.type, values, warnings };
}
