import { useSceneryFeature } from './scenery-registry';
import type { SceneryCloudsProps } from './scenery-model';

/**
 * Still clouds over a {@link Scenery}'s sky: a band along the horizon, a deck overhead, or
 * both (see {@link SceneryCloudsProps}). A layer of its own, drawn over the sky and compiled
 * on its own: adding or removing it recompiles nothing else. Anywhere under the `Scenery`.
 *
 * @example
 * <Scenery>
 *   <SceneryClouds layers="both" coverage={0.3} />
 * </Scenery>
 *
 * @group Components
 */
export const SceneryClouds = (props: SceneryCloudsProps) => {
  useSceneryFeature('clouds', props);
  return null;
};
