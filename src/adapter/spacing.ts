import type { InspectorNode } from '../shared/contracts';
import type { Matrix, SpacingResult } from '../shared/spacing';
import { calculateSpacing } from '../geometry/spacing';

const supportedParents = new Set(['FRAME', 'GROUP', 'COMPONENT', 'INSTANCE', 'COMPONENT_SET', 'SECTION']);

/** API boundary: capture immediate-parent geometry, then delegate all math. */
export function inspectSpacing(node: SceneNode, dimensions: Pick<InspectorNode, 'width' | 'height'>): SpacingResult {
  try {
    const parent = node.parent;
    if (!parent || !supportedParents.has(parent.type) || !('absoluteTransform' in parent) || !('width' in parent) || !('height' in parent)) {
      return { status: 'unsupported', message: 'Select a layer inside a finite frame, group, component, instance or section to measure parent spacing.' };
    }
    if (dimensions.width === undefined || dimensions.height === undefined) {
      return { status: 'unsupported', message: 'Spacing is unavailable because normalized layer dimensions are missing.' };
    }
    return calculateSpacing({
      width: dimensions.width,
      height: dimensions.height,
      nodeTransform: node.absoluteTransform as Matrix,
      parent: {
        name: parent.name,
        type: parent.type,
        width: parent.width,
        height: parent.height,
        transform: parent.absoluteTransform as Matrix,
      },
    });
  } catch {
    return { status: 'unsupported', message: 'Spacing geometry is unavailable for this layer or its immediate parent.' };
  }
}
