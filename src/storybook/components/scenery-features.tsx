import { scaleOrdinal } from 'd3-scale';
import { useMemo, type ReactNode } from 'react';
import { GeoMapCameraMarker } from '../../components/Html/GeoMap/GeoMapMarkers';
import { Minimap } from '../../components/Html/Minimap/Minimap';
import { Overlay } from '../../components/Html/Overlay/Overlay';
import { SceneryVoid } from '../../components/Scenery/SceneryVoid';
import { SceneryClouds } from '../../components/Scenery/SceneryClouds';
import { SceneryCutaway } from '../../components/Scenery/SceneryCutaway';
import { VoidBackground } from '../../components/Scenery/VoidBackground';
import { GeoGraticule } from '../../components/Layers/GeoGraticule';
import { GeoRelief } from '../../components/Layers/GeoRelief';
import { ScenerySea } from '../../components/Scenery/ScenerySea';
import type {
  SceneryVoidProps,
  ScenerySeaProps,
} from '../../components/Scenery/scenery-model';
import { Surface } from '../../components/Surfaces/Surface';
import { UtmArea, UtmPosition } from '../../components/UtmArea';
import { Trajectory } from '../../components/Wellbores/Trajectory/Trajectory';
import { Wellbore } from '../../components/Wellbores/Wellbore/Wellbore';
import { Wells } from '../../components/Wellbores/Wells/Wells';
import type { GeoFrame } from '../../sdk/projection/geo-frame';
import { demoCrs } from '../data/demo-crs';
import { useSurfaceMeta } from '../hooks/useSurfaceMeta';
import { useWellboreHeaders } from '../hooks/useWellboreHeaders';
import {
  reportReliefProgress,
  SCENERY_GLOBAL_RELIEF,
  SceneryArgs,
  sceneryVoidFromArgs,
  sceneryCloudsFromArgs,
  sceneryGraticuleFromArgs,
  sceneryMinimapLayers,
  scenerySeaFromArgs,
  sceneryVoidBackgroundFromArgs,
} from './scenery-controls';
import { sceneryCutawayFromArgs } from './scenery-cutaway-controls';

/**
 * A story's scenery features from its {@link SceneryArgs}, under its `<Scenery>`: the
 * graticule, the cutaway and the clouds (a sky preset, `clouds`) as the args set them, the sea
 * and the void with what only the story knows (their levels, a seabed of its own) laid over
 * the args', and with the sky off the void's gradient behind the scene (`voidBackground`).
 * `false` leaves one out (`clouds={false}` for a story drawing its own). With `weather`, the
 * sea takes its wind and swell from the enclosing `Weather` (`sceneryWeatherFromArgs`), and
 * draws its sea.
 */
export const SceneryArgsFeatures = ({
  args,
  sea,
  void: voidFeature,
  weather = false,
  clouds = true,
}: {
  args: SceneryArgs;
  sea: Partial<ScenerySeaProps> | false;
  void: Partial<SceneryVoidProps> | false;
  weather?: boolean;
  clouds?: boolean;
}) => {
  const graticule = sceneryGraticuleFromArgs(args);
  const cutaway = sceneryCutawayFromArgs(args);
  const voidBackground = sceneryVoidBackgroundFromArgs(args);
  // Kept out of a story's re-render every frame (a clock's): made again only as they change.
  const { clouds: preset, cloudsQuality } = args;
  const cloudsElement = useMemo(() => {
    const props = sceneryCloudsFromArgs({ clouds: preset, cloudsQuality });
    return props && <SceneryClouds {...props} />;
  }, [preset, cloudsQuality]);
  return (
    <>
      {graticule && <GeoGraticule {...graticule} />}
      {sea && <ScenerySea {...scenerySeaFromArgs(args, weather)} {...sea} />}
      {voidFeature && (
        <SceneryVoid {...sceneryVoidFromArgs(args)} {...voidFeature} />
      )}
      {cutaway && <SceneryCutaway {...cutaway} />}
      {clouds && cloudsElement}
      {voidBackground && <VoidBackground {...voidBackground} />}
    </>
  );
};

/**
 * The global demo relief alone (`SCENERY_GLOBAL_RELIEF`): the seabed of a story's sea, flat at
 * `depth` where it has no data, and the land the world over. In the story's `World`, inside a
 * `GeneratorsProvider` and a `DataProvider`.
 */
export const SceneryGlobalRelief = ({ depth }: { depth?: number }) => (
  <GeoRelief
    layers={SCENERY_GLOBAL_RELIEF}
    depth={depth}
    onProgress={reportReliefProgress}
  />
);

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

// The Hugin Fm. top: the demo field's reservoir, some 3 km down.
const DEMO_RESERVOIR_TOP = '1f7c7090ce5eaa5b2aa31e8093c7c3f7';

// A colour a well.
const wellColors = scaleOrdinal([
  'tomato',
  '#4e79a7',
  '#f28e2c',
  '#76b7b2',
  '#59a14f',
  '#edc949',
  '#af7aa1',
  '#ff9da7',
  '#9c755f',
  '#bab0ab',
]);

/**
 * The demo field for a scenery story, in its own `UtmArea`: every wellbore, a trajectory
 * `wellSize` times as thick as a plain one (0.1 m), coloured by well; and with `reservoir`,
 * the top of its reservoir (the Hugin Fm.), some 3 km down, coloured by depth. Inside the
 * story's `World` (its frame the field's, `demoFrame`), beside the `Scenery`.
 */
export const SceneryDemoField = ({
  wellSize = 50,
  reservoir = false,
}: {
  wellSize?: number;
  reservoir?: boolean;
}) => {
  const wellbores = useWellboreHeaders();
  const surfaces = useSurfaceMeta();
  const included = useMemo(() => wellbores.map(d => d.id), [wellbores]);
  const surface = reservoir
    ? surfaces.find(d => d.id === DEMO_RESERVOIR_TOP)
    : undefined;
  return (
    <UtmArea crsInstance={demoCrs} origin={demoCrs.originUtm}>
      {surface && (
        <UtmPosition
          easting={surface.header.xori}
          northing={surface.header.yori}
        >
          <Surface
            meta={surface}
            useColorRamp
            colorRamp={3}
            rampMin={surface.displayMin}
            rampMax={surface.displayMax}
            contours={{ interval: 25, major: 0 }}
          />
        </UtmPosition>
      )}
      <Wells
        wellbores={wellbores}
        included={included}
        renderWellbore={(wellbore, fromMsl) => (
          <UtmPosition easting={wellbore.easting} northing={wellbore.northing}>
            <Wellbore id={wellbore.id} fromMsl={fromMsl}>
              <Trajectory
                radius={0.1 * wellSize}
                color={wellColors(wellbore.well)}
              />
            </Wellbore>
          </UtmPosition>
        )}
      />
    </UtmArea>
  );
};
