import { createContext, useContext } from 'react';
import type { Boundary } from '../../sdk/geometries/boundary';
import type { GeoFrame } from '../../sdk/projection/geo-frame';
import type { Globe } from '../../sdk/projection/globe';

/**
 * What a {@link World} shares with what is placed in it.
 */
export type WorldState = {
  /** the scene's frame on the Earth: world X/Z are its map's, about its origin */
  frame: GeoFrame;
  /**
   * the anchored stage's area, in world X/Z: the globe is cut flat over the smallest disc that
   * holds it (`boundaryDisc`). Null when the `World` is given none, and a `SceneryStage` sets
   * the disc. The same object while its shape is the same
   */
  boundary: Boundary | null;
  /**
   * the Earth everything in the world is placed on, with or without a `Scenery`: lying on the
   * Earth where `frame` says, flat over the disc, curved or not as the `World`'s `globe` says
   */
  globe: Globe;
};

export const WorldContext = createContext<WorldState | null>(null);

/**
 * The enclosing {@link World}, or `null` when there is none: the world is optional, and
 * without one each `UtmArea` is the scene's frame, as before.
 */
export function useWorld() {
  return useContext(WorldContext);
}
