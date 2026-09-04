import { useTexture } from '@react-three/drei';
import type { Meta, StoryObj } from '@storybook/react-vite';
import { scaleOrdinal } from 'd3-scale';
import { ReactNode, Suspense, useCallback, useMemo } from 'react';
import {
  AdditiveBlending,
  Blending,
  NormalBlending,
  RepeatWrapping,
  SRGBColorSpace,
  Texture,
} from 'three';
import { ContourColorMode } from '../../../common/types';
import { WellboreSelectedEvent } from '../../../events/wellbore-events';
import { Vec2 } from '../../../sdk/types/common';
import { Canvas3dDecorator } from '../../../storybook/decorators/canvas-3d-decorator';
import { DataProviderDecorator } from '../../../storybook/decorators/data-provider-decorator';
import { EventEmitterDecorator } from '../../../storybook/decorators/event-emitter-decorator';
import { GeneratorsProviderDecorator } from '../../../storybook/decorators/generators-provider-decorator';
import { WellMapDecorator } from '../../../storybook/decorators/well-map-decorator';
import { useWellboreHeaders } from '../../../storybook/hooks/useWellboreHeaders';
import storyArgs from '../../../storybook/story-args.json';
import { EventEmitterCallbackEvent } from '../../EventEmitter/EventEmitterContext';
import { Highlighter } from '../../Highlighter/Highlighter';
import { useHighlighter } from '../../Highlighter/highlight-state';
import { UtmArea } from '../../UtmArea/UtmArea';
import { UtmPosition } from '../../UtmArea/UtmPosition';
import { Wellbore } from '../Wellbore/Wellbore';
import { WellboreBounds } from '../WellboreBounds/WellboreBounds';
import { Wells } from '../Wells/Wells';
import { Trajectory } from './Trajectory';
import { TrajectoryColorInterval } from './trajectory-defs';

const utmZone = storyArgs.utmZone;
const origin = storyArgs.origin as Vec2;

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

// Demo palette for interval colouring (deliberately short so bands repeat colours,
// exercising the material's colour de-duplication into a shared palette).
const intervalPalette = ['#e15759', '#4e79a7', '#f28e2c', '#76b7b2'];

/**
 * Builds contiguous measured-depth (MSL) colour bands of `bandSize` metres from 0 down
 * to ~6000 m, cycling `intervalPalette` (so several bands share a colour). Demonstrates
 * the `Trajectory.colorIntervals` data-colouring path.
 */
const buildColorBands = (bandSize: number): TrajectoryColorInterval[] => {
  const bands: TrajectoryColorInterval[] = [];
  for (let from = 0, i = 0; from < 6000; from += bandSize, i++) {
    bands.push({
      from,
      to: from + bandSize,
      color: intervalPalette[i % intervalPalette.length],
    });
  }
  return bands;
};

/**
 * Isolates the suspending `useTexture` hook in its own child so it never changes the
 * hook count of the story's `render` body. Hands the loaded texture down via a render
 * prop, applying wrap / colour space / repeat (with `needsUpdate` so the changes reach
 * the GPU — otherwise the texture stays on the default ClampToEdge and any repeat > 1
 * smears).
 */
const UvGrid = ({
  repeat,
  children,
}: {
  repeat: [number, number];
  children: (texture: Texture) => ReactNode;
}) => {
  const uvMap = useTexture('uv_grid.jpg');
  uvMap.wrapS = uvMap.wrapT = RepeatWrapping;
  uvMap.colorSpace = SRGBColorSpace;
  uvMap.repeat.set(repeat[0], repeat[1]);
  uvMap.needsUpdate = true;
  return <>{children(uvMap)}</>;
};

type TrajectoryArgs = {
  radius: number;
  minPixelRadius: number;
  opacity: number;
  radialSegments: number;
  lowRadialSegments: number;
  lodDistance: number;
  shadingColor: string;
  shadingStrength: number;
  shadingFalloff: number;
  applyMap: boolean;
  mapUvUnits: 'normalized' | 'world';
  mapRepeatU: number;
  mapRepeatV: number;
  depthMarkers: boolean;
  depthInterval: number;
  depthMarkerColorMode: ContourColorMode;
  depthMarkerColorModeFactor: number;
  depthMarkerColor: string;
  depthMarkerWidth: number;
  depthMarkerOffset: number;
  intervalColors: boolean;
  intervalColorBandSize: number;
  segmentsPerMeter: number;
  simplificationThreshold: number;
  fog: boolean;
  fogNear: number;
  fogFar: number;
  highlightColor: string;
  highlightOpacity: number;
  highlightBlending: Blending;
  picking: boolean;
};

const baseArgs: TrajectoryArgs = {
  radius: 1,
  minPixelRadius: 1,
  opacity: 1,
  radialSegments: 16,
  lowRadialSegments: 4,
  lodDistance: 2000,
  shadingColor: '#000000',
  shadingStrength: 0.6,
  shadingFalloff: 2,
  applyMap: false,
  mapUvUnits: 'normalized',
  mapRepeatU: 1,
  mapRepeatV: 8,
  depthMarkers: false,
  depthInterval: 100,
  depthMarkerColorMode: ContourColorMode.darken,
  depthMarkerColorModeFactor: 0.5,
  depthMarkerColor: '#000000',
  depthMarkerWidth: 1,
  depthMarkerOffset: 0,
  intervalColors: false,
  intervalColorBandSize: 500,
  segmentsPerMeter: 0.1,
  simplificationThreshold: 0.000001,
  fog: false,
  fogNear: 15000,
  fogFar: 40000,
  highlightColor: '#ffffff',
  highlightOpacity: 1,
  highlightBlending: AdditiveBlending,
  picking: true,
};

/**
 * The unified `Trajectory` renders a wellbore path as a single instanced tube with a
 * screen-space ~1 px floor (so it reads as a thin line at field scale and thickens as
 * you approach), a radial-segment LOD driven by `WellboreBounds`, GPU picking and
 * `Highlighter` support, and optional rim shading, an albedo texture map, depth-marker
 * bands and data-driven interval colouring.
 *
 * With `picking` on, hover a wellbore to highlight it and click to fly the camera to
 * the picked point (ctrl-click selects without flying). Each named story presets a
 * different feature; all controls remain adjustable.
 */
const meta = {
  title: 'Components/Wellbores/Trajectory',
  argTypes: {
    radius: {
      control: { type: 'range', min: 0.1, max: 50, step: 0.1 },
      table: { category: 'Trajectory' },
    },
    minPixelRadius: {
      control: { type: 'range', min: 0, max: 8, step: 0.25 },
      table: { category: 'Trajectory' },
    },
    opacity: {
      control: { type: 'range', min: 0, max: 1, step: 0.05 },
      table: { category: 'Trajectory' },
    },
    radialSegments: {
      control: { type: 'range', min: 3, max: 24, step: 1 },
      table: { category: 'Trajectory' },
    },
    lowRadialSegments: {
      control: { type: 'range', min: 3, max: 12, step: 1 },
      table: { category: 'Trajectory' },
    },
    lodDistance: {
      control: { type: 'range', min: 0, max: 20000, step: 100 },
      table: { category: 'Trajectory' },
    },
    shadingColor: {
      control: { type: 'color' },
      table: { category: 'Shading' },
    },
    shadingStrength: {
      control: { type: 'range', min: 0, max: 1, step: 0.05 },
      table: { category: 'Shading' },
    },
    shadingFalloff: {
      control: { type: 'range', min: 0.5, max: 6, step: 0.1 },
      table: { category: 'Shading' },
    },
    applyMap: {
      control: { type: 'boolean' },
      table: { category: 'Texture' },
    },
    mapUvUnits: {
      options: ['normalized', 'world'],
      control: { type: 'inline-radio' },
      table: { category: 'Texture' },
    },
    mapRepeatU: {
      control: { type: 'range', min: 0.005, max: 10, step: 0.005 },
      table: { category: 'Texture' },
    },
    mapRepeatV: {
      control: { type: 'range', min: 0.005, max: 50, step: 0.005 },
      table: { category: 'Texture' },
    },
    depthMarkers: {
      control: { type: 'boolean' },
      table: { category: 'Depth markers' },
    },
    depthInterval: {
      control: { type: 'range', min: 10, max: 1000, step: 10 },
      table: { category: 'Depth markers' },
    },
    depthMarkerColorMode: {
      options: [0, 1, 2],
      control: {
        type: 'inline-radio',
        labels: { '0': 'darken', '1': 'lighten', '2': 'mixed' },
      },
      table: { category: 'Depth markers' },
    },
    depthMarkerColorModeFactor: {
      control: { type: 'range', min: 0, max: 1, step: 0.05 },
      table: { category: 'Depth markers' },
    },
    depthMarkerColor: {
      control: { type: 'color' },
      table: { category: 'Depth markers' },
    },
    depthMarkerWidth: {
      control: { type: 'range', min: 0.1, max: 20, step: 0.1 },
      table: { category: 'Depth markers' },
    },
    depthMarkerOffset: {
      control: { type: 'range', min: -1000, max: 1000, step: 1 },
      table: { category: 'Depth markers' },
    },
    intervalColors: {
      control: { type: 'boolean' },
      table: { category: 'Interval colors' },
    },
    intervalColorBandSize: {
      control: { type: 'range', min: 100, max: 2000, step: 50 },
      table: { category: 'Interval colors' },
    },
    segmentsPerMeter: {
      control: { type: 'range', min: 0.01, max: 1, step: 0.01 },
      table: { category: 'Data' },
    },
    simplificationThreshold: {
      control: { type: 'range', min: 0, max: 1, step: 0.01 },
      table: { category: 'Data' },
    },
    fog: {
      control: { type: 'boolean' },
      table: { category: 'Fog' },
    },
    fogNear: {
      control: { type: 'range', min: 0, max: 100000, step: 1000 },
      table: { category: 'Fog' },
    },
    fogFar: {
      control: { type: 'range', min: 0, max: 200000, step: 1000 },
      table: { category: 'Fog' },
    },
    highlightColor: {
      control: { type: 'color' },
      table: { category: 'Highlight' },
    },
    highlightOpacity: {
      control: { type: 'range', min: 0, max: 1, step: 0.05 },
      table: { category: 'Highlight' },
    },
    highlightBlending: {
      options: [NormalBlending, AdditiveBlending],
      control: {
        type: 'inline-radio',
        labels: {
          [NormalBlending]: 'normal',
          [AdditiveBlending]: 'additive',
        },
      },
      table: { category: 'Highlight' },
    },
    picking: {
      control: { type: 'boolean' },
      table: { category: 'Debug' },
    },
  },
  decorators: [
    EventEmitterDecorator,
    Canvas3dDecorator,
    GeneratorsProviderDecorator,
    WellMapDecorator,
    DataProviderDecorator,
  ],
  parameters: {
    scale: 1000,
    cameraPosition: [0, 10000, 10000],
    // Used by the WellMap panel (WellMapDecorator) to colour the well tracks.
    colorScale,
    logDepth: true,
    // The default R3F loop needs the buffer cleared each frame; the decorator leaves
    // autoClear off for pipeline stories, so without this panned/zoomed frames trail.
    autoClear: true,
  },
  render: (args: TrajectoryArgs) => {
    const wellbores = useWellboreHeaders();
    const included = wellbores.map(d => d.id);

    // Memoized so unrelated arg changes don't rebuild the interval textures.
    const colorBands = useMemo(
      () =>
        args.intervalColors
          ? buildColorBands(args.intervalColorBandSize)
          : undefined,
      [args.intervalColors, args.intervalColorBandSize],
    );

    const highlighter = useHighlighter();
    const handleEnter = useCallback(
      (e: EventEmitterCallbackEvent) => {
        highlighter.highlight(e.target);
      },
      [highlighter],
    );
    const handleLeave = useCallback(() => {
      highlighter.removeAll();
    }, [highlighter]);
    const handleClick = useCallback((e: EventEmitterCallbackEvent) => {
      dispatchEvent(
        new WellboreSelectedEvent({
          id: e.ref,
          position: e.position,
          flyTo: !e.keys.ctrlKey,
        }),
      );
    }, []);

    return (
      <>
        <Highlighter />
        {args.fog && (
          <fog attach="fog" args={['#000000', args.fogNear, args.fogFar]} />
        )}

        <Suspense fallback={null}>
          <UvGrid repeat={[args.mapRepeatU, args.mapRepeatV]}>
            {uvMap => (
              <UtmArea origin={origin} utmZone={utmZone}>
                <Wells
                  wellbores={wellbores}
                  included={included}
                  renderWellbore={(wellbore, fromMsl) => {
                    const color = colorScale(wellbore.id);

                    return (
                      <UtmPosition
                        easting={wellbore.easting}
                        northing={wellbore.northing}
                      >
                        <Wellbore
                          id={wellbore.id}
                          fromMsl={fromMsl}
                          segmentsPerMeter={args.segmentsPerMeter}
                          simplificationThreshold={args.simplificationThreshold}
                          onPointerClick={
                            args.picking ? handleClick : undefined
                          }
                          onPointerEnter={
                            args.picking ? handleEnter : undefined
                          }
                          onPointerLeave={
                            args.picking ? handleLeave : undefined
                          }
                        >
                          <WellboreBounds id={wellbore.id} fromMsl={fromMsl}>
                            <Trajectory
                              name="Trajectory"
                              color={color}
                              radius={args.radius}
                              minPixelRadius={args.minPixelRadius}
                              opacity={args.opacity}
                              shadingColor={args.shadingColor}
                              shadingStrength={args.shadingStrength}
                              shadingFalloff={args.shadingFalloff}
                              map={args.applyMap ? uvMap : undefined}
                              mapUvUnits={args.mapUvUnits}
                              depthMarkers={args.depthMarkers}
                              depthInterval={args.depthInterval}
                              depthMarkerColorMode={args.depthMarkerColorMode}
                              depthMarkerColorModeFactor={
                                args.depthMarkerColorModeFactor
                              }
                              depthMarkerColor={args.depthMarkerColor}
                              depthMarkerWidth={args.depthMarkerWidth}
                              depthMarkerOffset={args.depthMarkerOffset}
                              colorIntervals={colorBands}
                              radialSegments={args.radialSegments}
                              lowRadialSegments={args.lowRadialSegments}
                              lodDistance={args.lodDistance}
                              highlightColor={args.highlightColor}
                              highlightOpacity={args.highlightOpacity}
                              highlightBlending={args.highlightBlending}
                              priority={9}
                            />
                          </WellboreBounds>
                        </Wellbore>
                      </UtmPosition>
                    );
                  }}
                />
              </UtmArea>
            )}
          </UvGrid>
        </Suspense>
      </>
    );
  },
} satisfies Meta<TrajectoryArgs>;

export default meta;
type Story = StoryObj<TrajectoryArgs>;

/**
 * The base tube: adjust `radius`, the screen-space `minPixelRadius` floor, `opacity`
 * and the rim `shading`. Hover to highlight, click to fly to a wellbore.
 */
export const Default: Story = {
  args: baseArgs,
};

/**
 * An albedo texture mapped onto the tube. `mapUvUnits` switches between `normalized`
 * (the texture fits the whole well) and `world` (a metre-based texel density set via
 * `mapRepeatU`/`mapRepeatV`). Click a wellbore to fly in and inspect the mapping.
 */
export const Textured: Story = {
  args: {
    ...baseArgs,
    applyMap: true,
  },
};

/**
 * Depth-marker bands drawn every `depthInterval` metres of measured depth (MSL),
 * modulating the tube colour (darken / lighten / mixed) — a lightweight depth
 * reference along the path.
 */
export const DepthMarkers: Story = {
  args: {
    ...baseArgs,
    depthMarkers: true,
  },
};

/**
 * Data-driven interval colouring: an array of measured-depth (MSL) `{ from, to, color }`
 * intervals recolours the tube by data instead of a single diffuse colour. Here a demo
 * set of contiguous bands is generated; `intervalColorBandSize` sets their size.
 */
export const IntervalColors: Story = {
  args: {
    ...baseArgs,
    intervalColors: true,
  },
};

/**
 * Semi-transparent tubes (`opacity` < 1). The material is OIT-compatible, so under an
 * `OITRenderPass` the transparency resolves order-independently; with the default R3F
 * loop it uses standard alpha blending.
 */
export const Transparent: Story = {
  args: {
    ...baseArgs,
    opacity: 0.5,
  },
};
