import type { Meta, StoryObj } from '@storybook/react-vite';
import { scaleOrdinal } from 'd3-scale';
import { useEffect, useMemo, useState } from 'react';
import type { EventEmitterCallbackEvent } from '../../components/EventEmitter';
import { BoxGrid } from '../../components/Grids/BoxGrid/BoxGrid';
import { useHighlighter } from '../../components/Highlighter/highlight-state';
import { Highlighter } from '../../components/Highlighter/Highlighter';
import { Surface } from '../../components/Surfaces/Surface';
import { UtmArea } from '../../components/UtmArea/UtmArea';
import { UtmPosition } from '../../components/UtmArea/UtmPosition';
import { Trajectory } from '../../components/Wellbores/Trajectory/Trajectory';
import { Wellbore } from '../../components/Wellbores/Wellbore/Wellbore';
import { WellboreBounds } from '../../components/Wellbores/WellboreBounds/WellboreBounds';
import { WellboreLabel } from '../../components/Wellbores/WellboreLabel/WellboreLabel';
import { Wells } from '../../components/Wellbores/Wells/Wells';
import {
  WellboreSelectedEvent,
  wellboreSelectedEventType,
} from '../../events/wellbore-events';
import type { Vec2, Vec3 } from '../../sdk/types/common';
import { AnnotationsDecorator } from '../decorators/annotations-decorator';
import { Canvas3dDecorator } from '../decorators/canvas-3d-decorator';
import { DataProviderDecorator } from '../decorators/data-provider-decorator';
import { EventEmitterDecorator } from '../decorators/event-emitter-decorator';
import { GeneratorsProviderDecorator } from '../decorators/generators-provider-decorator';
import { WellMapDecorator } from '../decorators/well-map-decorator';
import { useSurfaceMetaDict } from '../hooks/useSurfaceMeta';
import { useWellboreHeaders } from '../hooks/useWellboreHeaders';
import storyArgs from '../story-args.json';

// A colour per sidetrack, the main bore first: the selected well's, in the scene and the map.
const colorScale = scaleOrdinal([
  'tomato',
  '#4e79a7',
  '#f28e2c',
  '#76b7b2',
  '#59a14f',
  '#edc949',
  '#af7aa1',
  '#ff9da7',
  '#9c755f',
  '#86a68c',
]);
const sidetrackColor = (wellbore: { name: string; well: string }) =>
  colorScale(wellbore.name.replace(wellbore.well, '') || 'Main');

const origin = storyArgs.origin as Vec2;
const utmZone = storyArgs.utmZone;
// The top of the Volve reservoir (the Hugin Formation): what most of the wells drill into.
const RESERVOIR_TOP = '1f7c7090ce5eaa5b2aa31e8093c7c3f7';
// The box around the wells and the surface, in 500 m cells: its centre and size in metres.
const GRID_CELL = 500;
const GRID_CENTER: Vec3 = [1250, -2000, -750];
const GRID_SIZE: Vec3 = [8500, 4000, 6500];

type GettingStartedProps = {
  /** each wellbore's name, as an annotation at the bottom of its trajectory */
  labels: boolean;
  /** the top of the reservoir, as a depth surface */
  surface: boolean;
  surfaceOpacity: number;
  /** depth contour lines on the surface, every 10 m, every fifth line major */
  contours: boolean;
  /** a box grid around the wells, its axes in UTM coordinates and depth */
  grid: boolean;
};

const GettingStarted = ({
  labels,
  surface,
  surfaceOpacity,
  contours,
  grid,
}: GettingStartedProps) => {
  const wellbores = useWellboreHeaders();
  const surfaces = useSurfaceMetaDict();
  const reservoir = surfaces[RESERVOIR_TOP];
  const included = useMemo(() => wellbores.map(d => d.id), [wellbores]);

  const [selected, setSelected] = useState<string>();
  const highlighter = useHighlighter();

  // A wellbore picked in the scene or in the well map.
  useEffect(() => {
    const onSelect = (event: WellboreSelectedEvent) =>
      setSelected(event.detail.id);
    addEventListener(wellboreSelectedEventType, onSelect);
    return () => removeEventListener(wellboreSelectedEventType, onSelect);
  }, []);
  useEffect(() => () => highlighter.removeAll(), [highlighter]);

  return (
    <>
      <Highlighter />
      <UtmArea origin={origin} utmZone={utmZone}>
        {surface && reservoir && (
          <UtmPosition
            easting={reservoir.header.xori}
            northing={reservoir.header.yori}
          >
            <Surface
              meta={reservoir}
              useColorRamp
              colorRamp={3}
              rampMin={reservoir.displayMin}
              rampMax={reservoir.displayMax}
              opacity={surfaceOpacity}
              contours={contours && { interval: 10, major: 5 }}
              doubleSide
            />
          </UtmPosition>
        )}
        <Wells
          wellbores={wellbores}
          included={included}
          selected={selected}
          renderWellbore={(wellbore, fromMsl, isSelected, isActiveWell) => (
            <UtmPosition
              easting={wellbore.easting}
              northing={wellbore.northing}
            >
              <Wellbore
                id={wellbore.id}
                fromMsl={fromMsl}
                onPointerClick={(event: EventEmitterCallbackEvent) =>
                  dispatchEvent(
                    new WellboreSelectedEvent({
                      id: event.ref,
                      position: event.position,
                      flyTo: !event.keys.ctrlKey,
                    }),
                  )
                }
                onPointerEnter={(event: EventEmitterCallbackEvent) => {
                  if (!isSelected) highlighter.highlight(event.target);
                  event.domElement.style.cursor = 'pointer';
                }}
                onPointerLeave={(event: EventEmitterCallbackEvent) => {
                  event.domElement.style.cursor = '';
                  highlighter.removeAll();
                }}
              >
                <WellboreBounds id={wellbore.id} fromMsl={fromMsl}>
                  <Trajectory
                    radius={2}
                    color={isActiveWell ? sidetrackColor(wellbore) : '#9aa0a6'}
                  />
                </WellboreBounds>
                {labels && <WellboreLabel color="cyan" size={14} />}
              </Wellbore>
            </UtmPosition>
          )}
        />
        {grid && (
          <BoxGrid
            size={GRID_SIZE}
            position={GRID_CENTER}
            cellSize={GRID_CELL}
            originValue={[origin[0], 0, origin[1]]}
            gridScale={[1, -1, -1]}
            gridLineWidth={6 / GRID_CELL}
            backgroundOpacity={0.1}
            axesColor="#eee"
          />
        )}
      </UtmArea>
    </>
  );
};

/**
 * The demo field (Volve, on the Norwegian continental shelf) with a few of the library's core
 * pieces, light enough to open in a moment:
 *
 * - **Wellbores**: `Wells` lays out every wellbore of the field, each a `Wellbore` holding a
 *   `Trajectory` (a tube that stays a line from far off), its name a `WellboreLabel`.
 * - **Picking**: hover a wellbore to highlight it (`Highlighter`); click it to select it and fly
 *   the camera to it (ctrl+click selects it without moving). The selected well is coloured by
 *   sidetrack, and the `WellMap` on the left lays out its wellbores by depth: drag its handle to
 *   move along them.
 * - **A depth surface**: the top of the reservoir, coloured by depth (`Surface`), with depth
 *   contour lines if you turn them on.
 * - **A box grid** around the wells (`BoxGrid`), its axes in UTM coordinates and depth.
 *
 * Everything is placed in one UTM area (`UtmArea`, `UtmPosition`). The data comes from the
 * story's own store: see [Data](/videx-3d/docs/documents/data.html) for how to connect yours.
 * The Components section has a page for each of these pieces; the other examples show more of
 * the library at once.
 */
const meta = {
  title: 'Examples/Getting Started',
  component: GettingStarted,
  // Light enough to show live on its Docs page too, the first page Storybook opens.
  tags: ['docs-preview'],
  decorators: [
    EventEmitterDecorator,
    AnnotationsDecorator,
    Canvas3dDecorator,
    GeneratorsProviderDecorator,
    WellMapDecorator,
    DataProviderDecorator,
  ],
  parameters: {
    scale: 1000,
    cameraPosition: [-1200, 3100, 3500],
    cameraTarget: [1000, -2200, -500],
    colorScale,
  },
  argTypes: {
    surfaceOpacity: {
      control: { type: 'range', min: 0, max: 1, step: 0.05 },
      if: { arg: 'surface' },
    },
    contours: { if: { arg: 'surface' } },
  },
  args: {
    labels: true,
    surface: true,
    surfaceOpacity: 0.8,
    contours: false,
    grid: true,
  },
} satisfies Meta<typeof GettingStarted>;

export default meta;
type Story = StoryObj<typeof meta>;

/** Click a wellbore to start. */
export const Default: Story = {};
