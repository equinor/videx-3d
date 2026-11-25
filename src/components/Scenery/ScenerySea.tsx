import { useSceneryFeature } from './scenery-registry';
import type { ScenerySeaProps } from './scenery-model';

/**
 * An endless sea under a {@link Scenery}'s sky, with a seabed `depth` below its surface, and
 * below that the void (see {@link ScenerySeaProps}): with a sea the void is always there,
 * a `SceneryVoid` sets its look and its hollow. Its layers — the sea seen from the air, the view
 * from in the water, the surface — are drawn over the sky and the void, each compiled on its
 * own. A `SceneryStage` draws the same sea on real geometry, and a `SceneryCutaway` cuts it
 * open. Anywhere under the `Scenery`.
 *
 * @example
 * <Scenery>
 *   <ScenerySea level={0} depth={120} />
 * </Scenery>
 *
 * @group Components
 */
export const ScenerySea = (props: ScenerySeaProps) => {
  useSceneryFeature('sea', props);
  return null;
};
