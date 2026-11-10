/** Figma's affine 2x3 matrix; columns map local coordinates to page coordinates. */
export type Matrix = [[number, number, number], [number, number, number]];
export interface GeometryInput {
  width: number;
  height: number;
  nodeTransform: Matrix;
  parent: { name: string; type: string; width: number; height: number; transform: Matrix };
}
export type SpacingKey = 'top' | 'right' | 'bottom' | 'left' | 'x' | 'y' | 'width' | 'height';
export type SpacingValues = Record<SpacingKey, number>;
export type SpacingResult =
  | { status: 'ready'; parentName: string; parentType: string; values: SpacingValues; warnings: string[] }
  | { status: 'unsupported'; message: string };
