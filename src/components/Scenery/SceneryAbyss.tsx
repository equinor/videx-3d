import { useSceneryFeature } from './scenery-registry';
import type { SceneryAbyssProps } from './scenery-model';

/**
 * The void below a level (with a `SceneryOcean`, below its seabed) under a {@link Scenery}'s
 * sky: an endless lid overhead and a bottomless gradient below the horizon, and optionally
 * walls about the stage (see {@link SceneryAbyssProps}). A layer of its own, compiled on its
 * own. Anywhere under the `Scenery`.
 *
 * @example
 * <Scenery>
 *   <SceneryAbyss level={-120} walls />
 * </Scenery>
 *
 * @group Components
 */
export const SceneryAbyss = (props: SceneryAbyssProps) => {
  useSceneryFeature('abyss', props);
  return null;
};
