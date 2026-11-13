import { createContext, useContext } from 'react';
import type { WaterBody } from '../../sdk/materials/water-body';

/**
 * The body of water what is drawn lies in, if any: an `Ocean`, a `Scenery`'s sea or a
 * `ChunkStack`'s water hands its {@link WaterBody} down, so the library's materials under it
 * fade by the same water.
 */
export const WaterBodyContext = createContext<WaterBody | null>(null);

/** The {@link WaterBody} the enclosing sea hands down; `null` outside one. */
export function useWaterBody(): WaterBody | null {
  return useContext(WaterBodyContext);
}
