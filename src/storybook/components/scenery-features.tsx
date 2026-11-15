import type { ReactNode } from 'react';
import { GeoMapCameraMarker } from '../../components/Html/GeoMap/GeoMapMarkers';
import { Minimap } from '../../components/Html/Minimap/Minimap';
import { Overlay } from '../../components/Html/Overlay/Overlay';
import { SceneryAbyss } from '../../components/Scenery/SceneryAbyss';
import { SceneryCutaway } from '../../components/Scenery/SceneryCutaway';
import { GeoGraticule } from '../../components/Layers/GeoGraticule';
import { SceneryOcean } from '../../components/Scenery/SceneryOcean';
import type {
  SceneryAbyssProps,
  SceneryOceanProps,
} from '../../components/Scenery/scenery-model';
import type { GeoFrame } from '../../sdk/projection/geo-frame';
import {
  SceneryArgs,
  sceneryAbyssFromArgs,
  sceneryGraticuleFromArgs,
  sceneryMinimapLayers,
  sceneryOceanFromArgs,
} from './scenery-controls';
import { sceneryCutawayFromArgs } from './scenery-cutaway-controls';

/**
 * A story's scenery features from its {@link SceneryArgs}, under its `<Scenery>`: the
 * graticule and the cutaway as the args set them, and the sea and the void with what
 * only the story knows (their levels, a seabed of its own) laid over the args'. `false`
 * leaves one out. With `weather`, the sea takes its wind and swell from the enclosing
 * `Weather` (`sceneryWeatherFromArgs`), and draws its sea.
 */
export const SceneryArgsFeatures = ({
  args,
  ocean,
  abyss,
  weather = false,
}: {
  args: SceneryArgs;
  ocean: Partial<SceneryOceanProps> | false;
  abyss: Partial<SceneryAbyssProps> | false;
  weather?: boolean;
}) => {
  const graticule = sceneryGraticuleFromArgs(args);
  const cutaway = sceneryCutawayFromArgs(args);
  return (
    <>
      {graticule && <GeoGraticule {...graticule} />}
      {ocean && (
        <SceneryOcean {...sceneryOceanFromArgs(args, weather)} {...ocean} />
      )}
      {abyss && <SceneryAbyss {...sceneryAbyssFromArgs(args)} {...abyss} />}
      {cutaway && <SceneryCutaway {...cutaway} />}
    </>
  );
};

/**
 * A story's minimap (see `sceneryMinimapArgs`): the `Minimap`'s defaults and a camera marker,
 * over the demo reliefs ticked in `reliefLayers` (all by default), in the story's `frame`,
 * its heights over the sea at `level` (the sea's Y; default 0). Directly in the `Canvas`, in
 * an `Overlay` of its own, bottom right; inside a `GeneratorsProvider` with the
 * `sceneryReliefTile` generator.
 */
export const SceneryArgsMinimap = ({
  frame,
  reliefLayers,
  level,
  children,
}: {
  frame: GeoFrame;
  reliefLayers?: string[];
  level?: number;
  /** layers of the story's own, under the camera marker */
  children?: ReactNode;
}) => (
  <Overlay>
    <Minimap
      anchor="bottom-right"
      layers={sceneryMinimapLayers(reliefLayers)}
      frame={frame}
      level={level}
    >
      {children}
      <GeoMapCameraMarker />
    </Minimap>
  </Overlay>
);
