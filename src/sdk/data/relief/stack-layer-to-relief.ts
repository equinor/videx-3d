import { evaluateRelief } from '../../geometries/procedural-relief';
import type { ReliefFrame } from '../../geometries/relief-grid';
import type { StackSyntheticLayer } from '../../geometries/surface-stack';
import type { ReliefMeta } from '../types/ReliefMeta';
import { ComputedRelief, functionRelief } from './function-relief';

// ⚠️ Free of three.js: it runs where a store runs.

/**
 * What {@link stackLayerToRelief} names the relief, and the grid it is computed on.
 *
 * @group Data
 */
export type StackLayerToReliefOptions = {
  id: string;
  name: string;
  description?: string;
  /** the grid, in `frame.projection`'s map. `rotation` is ignored: the layer has none */
  grid: Omit<ReliefMeta['grid'], 'rotation'>;
};

/**
 * A synthetic chunk layer — a plane at `depth`, perturbed by its `relief` — as a relief,
 * computed when asked for (see {@link functionRelief}): the same procedural fields the
 * chunks evaluate, in the scene the layer is built in, placed on the map by `frame`. So
 * the relief and the column's layer are the same ground.
 *
 * @param frame where the layer's scene lies on the map (as a `UtmArea` places it); the
 *   relief is laid out in `frame.projection`
 * @throws for a layer given by `offset`: it is measured from the layer above it, which a
 *   relief does not have
 *
 * @group Data
 */
export function stackLayerToRelief(
  layer: StackSyntheticLayer,
  frame: ReliefFrame,
  options: StackLayerToReliefOptions,
): ComputedRelief {
  if (layer.depth === undefined) {
    throw new Error(
      'stackLayerToRelief: a layer given by `offset` hangs from the layer above it, and cannot be baked; give it a `depth`.',
    );
  }
  const base = -layer.depth;
  const { relief } = layer;
  const [ox, oy] = frame.origin;
  const [sx, sz] = frame.offset ?? [0, 0];
  const { grid, ...naming } = options;
  return functionRelief(
    {
      ...naming,
      crs: frame.projection,
      grid: { origin: grid.origin, cell: grid.cell, size: grid.size },
      ...(relief ? {} : { min: base, max: base }),
    },
    // Scene X runs east and Z south of the frame's origin.
    (x, y) =>
      relief ? base + evaluateRelief(relief, x - ox + sx, oy - y + sz) : base,
  );
}
