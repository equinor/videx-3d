import { useSceneryFeature } from './scenery-registry';
import type { SceneryOceanProps } from './scenery-model';

/**
 * An endless sea under a {@link Scenery}'s sky, with a seabed `depth` below its surface, and
 * below that the void (see {@link SceneryOceanProps}): with a sea the void is always there,
 * a `SceneryAbyss` sets its look and walls. Its layers — the sea seen from the air, the view
 * from in the water, the surface — are drawn over the sky and the void, each compiled on its
 * own. A `SceneryStage` draws the same sea on real geometry, and a `SceneryCutaway` cuts it
 * open. Anywhere under the `Scenery`.
 *
 * @example
 * <Scenery>
 *   <SceneryOcean level={0} depth={120} />
 * </Scenery>
 *
 * @group Components
 */
export const SceneryOcean = (props: SceneryOceanProps) => {
  useSceneryFeature('ocean', props);
  return null;
};
