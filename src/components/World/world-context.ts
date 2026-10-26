import { createContext, useContext } from 'react';
import type { GeoFrame } from '../../sdk/projection/geo-frame';
import type { Globe } from '../../sdk/projection/globe';

/**
 * What a {@link World} shares with what is placed in it.
 */
export type WorldState = {
  /** the scene's frame on the Earth: world X/Z are its map's, about its origin */
  frame: GeoFrame;
  /** the globe what is placed in the world is set on: a `Sky`'s, while one is drawn; else null, and all is flat */
  globe: Globe | null;
  /** A `Sky` hands the world its globe; returns the release. */
  provideGlobe: (globe: Globe) => () => void;
};

export const WorldContext = createContext<WorldState | null>(null);

/**
 * The enclosing {@link World}, or `null` when there is none: the world is optional, and
 * without one each `UtmArea` is the scene's frame, as before.
 */
export function useWorld() {
  return useContext(WorldContext);
}
