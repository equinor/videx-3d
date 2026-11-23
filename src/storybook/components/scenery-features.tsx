import { useMemo, type ReactNode } from 'react';
import { GeoMapCameraMarker } from '../../components/Html/GeoMap/GeoMapMarkers';
import { Minimap } from '../../components/Html/Minimap/Minimap';
import { Overlay } from '../../components/Html/Overlay/Overlay';
import { SceneryVoid } from '../../components/Scenery/SceneryVoid';
import { SceneryClouds } from '../../components/Scenery/SceneryClouds';
import { SceneryCutaway } from '../../components/Scenery/SceneryCutaway';
import { GeoGraticule } from '../../components/Layers/GeoGraticule';
import { SceneryOcean } from '../../components/Scenery/SceneryOcean';
import type {
  SceneryVoidProps,
  SceneryOceanProps,
} from '../../components/Scenery/scenery-model';
import type { GeoFrame } from '../../sdk/projection/geo-frame';
import {
  SceneryArgs,
  sceneryVoidFromArgs,
  sceneryCloudsFromArgs,
  sceneryGraticuleFromArgs,
  sceneryMinimapLayers,
  sceneryOceanFromArgs,
} from './scenery-controls';
import { sceneryCutawayFromArgs } from './scenery-cutaway-controls';

/**
 * A story's scenery features from its {@link SceneryArgs}, under its `<Scenery>`: the
 * graticule, the cutaway and the clouds (a sky preset, `clouds`) as the args set them, and the
 * sea and the void with what only the story knows (their levels, a seabed of its own) laid over
 * the args'. `false` leaves one out (`clouds={false}` for a story drawing its own). With
 * `weather`, the sea takes its wind and swell from the enclosing `Weather`
 * (`sceneryWeatherFromArgs`), and draws its sea.
 */
export const SceneryArgsFeatures = ({
  args,
  ocean,
  abyss,
  weather = false,
  clouds = true,
}: {
  args: SceneryArgs;
  ocean: Partial<SceneryOceanProps> | false;
  abyss: Partial<SceneryVoidProps> | false;
  weather?: boolean;
  clouds?: boolean;
}) => {
  const graticule = sceneryGraticuleFromArgs(args);
  const cutaway = sceneryCutawayFromArgs(args);
  // Kept out of a story's re-render every frame (a clock's): made again only as they change.
  const { clouds: sky, cloudsQuality } = args;
  const cloudsElement = useMemo(() => {
    const props = sceneryCloudsFromArgs({ clouds: sky, cloudsQuality });
    return props && <SceneryClouds {...props} />;
  }, [sky, cloudsQuality]);
  return (
    <>
      {graticule && <GeoGraticule {...graticule} />}
      {ocean && (
        <SceneryOcean {...sceneryOceanFromArgs(args, weather)} {...ocean} />
      )}
      {abyss && <SceneryVoid {...sceneryVoidFromArgs(args)} {...abyss} />}
      {cutaway && <SceneryCutaway {...cutaway} />}
      {clouds && cloudsElement}
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
