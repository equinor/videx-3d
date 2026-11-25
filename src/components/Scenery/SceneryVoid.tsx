import { useSceneryFeature } from './scenery-registry';
import type { SceneryVoidProps } from './scenery-model';

/**
 * The void under a {@link Scenery}'s sky, below a level (with a `ScenerySea`, below its
 * seabed). By default a hollow in the crust about the field ({@link SceneryHollow}): crater
 * walls down to a floor some 35 km under the seabed, the seabed its lid. Peeling the seabed
 * (`ScenerySea`'s `seabed={false}`) opens it: the relief and the seabed are cut away inside
 * its rim, and the data under the field is seen against the crater. Past its walls and under
 * its floor the void is solid rock: black, with the lid overhead. With `hollow={false}`, the
 * plain void: an endless lid overhead and a bottomless gradient below the horizon. A layer of
 * its own, compiled on its own; nothing it changes re-bakes. Anywhere under the `Scenery`.
 *
 * @example
 * <Scenery>
 *   <ScenerySea seabed={false} />
 *   <SceneryVoid hollow={{ radius: 400000, pulse: 0.1 }} />
 * </Scenery>
 *
 * @group Components
 */
export const SceneryVoid = (props: SceneryVoidProps) => {
  useSceneryFeature('void', props);
  return null;
};
