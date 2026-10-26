import { ReactNode, useCallback, useMemo, useState } from 'react';
import type { GeoFrame } from '../../sdk/projection/geo-frame';
import type { Globe } from '../../sdk/projection/globe';
import { WorldContext, WorldState } from './world-context';

/**
 * World props
 * @expand
 */
export type WorldProps = {
  /**
   * The scene's frame on the Earth — the chosen field's, usually: world X/Z are its map's,
   * about its origin (at its `offset`). Changing it moves what is placed in the world, not
   * the camera.
   */
  frame: GeoFrame;
  children?: ReactNode;
};

/**
 * Where the scene lies on the Earth, said once. What is inside takes it from here:
 *
 * - a `UtmArea` in another frame (another UTM zone, a field 300 km off) places itself:
 *   where the world's map has its origin, turned and scaled to the world's grid there, and
 *   on the `Sky`'s globe when there is one. One in the world's own frame is not moved.
 * - a `Sky` takes its `observer`'s place from it, when the observer gives only a date, and
 *   hands the world its globe;
 * - a `SkyBoxStage`'s `relief` is read in it, when it gives no `frame` of its own.
 *
 * Renders nothing of its own. Without a `Sky` nothing curves: fields are placed flat, as on
 * a map. See `documents/world.md`.
 *
 * @example
 * <World frame={geoFrameFromCrs(crs)}>
 *   <Sky observer={{ date }} ocean>
 *     <SkyBoxStage bounds={bounds} relief={{ layers }} />
 *   </Sky>
 *   <UtmArea crsInstance={crs} origin={crs.originUtm}>{field}</UtmArea>
 *   <UtmArea frame={otherField}>{other}</UtmArea>
 * </World>
 *
 * @group Components
 */
export const World = ({ frame, children }: WorldProps) => {
  // By its content: a frame written inline is a new object every render.
  const key = JSON.stringify(frame);
  // eslint-disable-next-line react-hooks/exhaustive-deps -- keyed by content above
  const stable = useMemo(() => frame, [key]);
  const [globe, setGlobe] = useState<Globe | null>(null);
  const provideGlobe = useCallback((given: Globe) => {
    setGlobe(given);
    return () => setGlobe(current => (current === given ? null : current));
  }, []);
  const state = useMemo<WorldState>(
    () => ({ frame: stable, globe, provideGlobe }),
    [stable, globe, provideGlobe],
  );
  return (
    <WorldContext.Provider value={state}>{children}</WorldContext.Provider>
  );
};
