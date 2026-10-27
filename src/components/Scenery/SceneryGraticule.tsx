import { useSceneryFeature } from './scenery-registry';
import type { SceneryGraticuleProps } from './scenery-model';

/**
 * Lines on the Earth over a {@link Scenery}: latitude and longitude, the UTM zones and the
 * nautical time zones (see {@link SceneryGraticuleProps}), drawn on the sea's surface, the
 * land and a dry seabed, at any distance. Compiled into the layers that draw them and
 * switched by uniforms: adding, removing or restyling it recompiles nothing. Anywhere under
 * the `Scenery`.
 *
 * @example
 * <Scenery>
 *   <SceneryGraticule utm={{ color: '#ffd23f' }} />
 * </Scenery>
 *
 * @group Components
 */
export const SceneryGraticule = (props: SceneryGraticuleProps) => {
  useSceneryFeature('graticule', props);
  return null;
};
