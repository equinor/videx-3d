import type { Meta, StoryObj } from '@storybook/react-vite';
import { useLayoutEffect, useMemo } from 'react';
import { Color, Uniform } from 'three';
import { geoFrameLocation } from '../../sdk/projection/geo-frame';
import { geoTileRegion } from '../../sdk/tiles/geo-tile-keys';
import { SCENERY_DEMO_RELIEF_LAYERS } from '../../storybook/components/scenery-controls';
import { demoFrame } from '../../storybook/data/demo-crs';
import { Canvas3dDecorator } from '../../storybook/decorators/canvas-3d-decorator';
import { DataProviderDecorator } from '../../storybook/decorators/data-provider-decorator';
import { GeneratorsProviderDecorator } from '../../storybook/decorators/generators-provider-decorator';
import { SceneryGenerators } from '../../storybook/decorators/scenery-generators';
import { Scenery } from '../Scenery/Scenery';
import { ScenerySea } from '../Scenery/ScenerySea';
import { SceneryStage } from '../Scenery/SceneryStage';
import { World } from '../World/World';
import { GeoRelief, GeoReliefProps } from './GeoRelief';
import {
  GeoTileLayer,
  GeoTileLayerShader,
  GeoTileLayerSource,
} from './GeoTileLayer';

// A geographic layer of your own, built on `GeoTileLayer`: no data to load (a `source`
// without `load`), a checkerboard worked out per pixel from where it lies on the Earth
// (`vGeoTileWorld`), over a disc about the demo field at Volve. `covers` keeps its tiles to
// the disc's box; the shader cuts the disc. Flat at a height over the sea, or draped on the
// relief.

const LEVEL = 0;
const DEPTH = 100;
const STAGE_BOUNDS: [number, number, number, number] = [
  -8000, -8000, 8000, 8000,
];
const RELIEF_COLOR: GeoReliefProps['color'] = { ramp: 'terrain' };

// A tile is split until each of its 16 cells along a side spans no more than 16 pixels:
// patches about 256 pixels across, fine enough to follow the globe's curve. The pattern
// itself is worked out per pixel, whatever the patch.
const SIZE = 16;
const CELL_PIXELS = 16;

// Where the field's origin lies on the Earth, and metres along a degree of latitude.
const FIELD = geoFrameLocation(demoFrame);
const METRES_PER_DEGREE = 111320;

/** Whether a geographic tile touches the box about the field holding a disc `radius` metres across each way. */
function coversDisc(radius: number): GeoTileLayerSource['covers'] {
  // A tenth more: the box in degrees is a little off the disc on the globe.
  const north = (1.1 * radius) / METRES_PER_DEGREE;
  const east = north / Math.cos((FIELD.latitude * Math.PI) / 180);
  return key => {
    const [west, top, span] = geoTileRegion(key);
    return (
      west < FIELD.longitude + east &&
      west + span > FIELD.longitude - east &&
      top > FIELD.latitude - north &&
      top - span < FIELD.latitude + north
    );
  };
}

// The premultiplied colour where the pixel lies: no texels to read, only `vGeoTileWorld`
// (the scene's X/Z here: metres east and south of the field's origin) and the uniforms.
// Its derivatives (fwidth) need the layer's `transition` 0.
const SAMPLE = /* glsl */ `
uniform float uCheckerSize;
uniform float uCheckerRadius;
uniform vec3 uCheckerColor;

// 1 on the coloured cells, 0 between, box-filtered over the pixel: far off, the cells blend
// rather than shimmer.
float checkerAt(vec2 p) {
  vec2 w = fwidth(p) + 1e-4;
  vec2 i = 2.0 * (abs(fract((p - 0.5 * w) * 0.5) - 0.5) - abs(fract((p + 0.5 * w) * 0.5) - 0.5)) / w;
  return 0.5 - 0.5 * i.x * i.y;
}

vec4 geoTileSample(float slot, vec2 uv, float texelMetres) {
  vec2 xz = vGeoTileWorld.xz;
  float r = length(xz);
  // Inside the disc, its edge smoothed over a pixel.
  float inside = clamp((uCheckerRadius - r) / max(fwidth(r), 1e-4) + 0.5, 0.0, 1.0);
  float alpha = 0.85 * inside * checkerAt(xz / uCheckerSize);
  return vec4(uCheckerColor * alpha, alpha);
}
`;

type GeoTileLayerArgs = {
  drape: boolean;
  height: number;
  water: 'fog' | 'clear';
  opacity: number;
  cellSize: number;
  radius: number;
  color: string;
};

const GeoTileLayerStory = ({
  drape,
  height,
  water,
  opacity,
  cellSize,
  radius,
  color,
}: GeoTileLayerArgs) => {
  // Where there is something: a new source chooses its tiles anew.
  const source = useMemo<GeoTileLayerSource>(
    () => ({ size: SIZE, covers: coversDisc(radius * 1000) }),
    [radius],
  );
  // One material, kept: the uniforms' objects stay, their values are set.
  const uniforms = useMemo(
    () => ({
      uCheckerSize: new Uniform(1000),
      uCheckerRadius: new Uniform(10000),
      uCheckerColor: new Uniform(new Color()),
    }),
    [],
  );
  const shader = useMemo<GeoTileLayerShader>(
    () => ({ sample: SAMPLE, uniforms }),
    [uniforms],
  );
  useLayoutEffect(() => {
    uniforms.uCheckerSize.value = cellSize;
    uniforms.uCheckerRadius.value = radius * 1000;
    uniforms.uCheckerColor.value.set(color);
  }, [uniforms, cellSize, radius, color]);

  return (
    <World frame={demoFrame}>
      <SceneryGenerators>
        <Scenery>
          <ScenerySea level={LEVEL} depth={DEPTH} />
          <SceneryStage boundary={STAGE_BOUNDS} />
          <GeoTileLayer
            source={source}
            shader={shader}
            drape={drape}
            height={height}
            water={water}
            opacity={opacity}
            texelPixels={CELL_PIXELS}
            transition={0}
          />
        </Scenery>
        <GeoRelief
          layers={SCENERY_DEMO_RELIEF_LAYERS}
          depth={DEPTH}
          color={RELIEF_COLOR}
        />
      </SceneryGenerators>
    </World>
  );
};

const LAYER = 'Layer';
const PATTERN = 'Pattern';

/**
 * `GeoTileLayer` draws anything on the Earth from geographic tiles of its own, in longitude and
 * latitude: tiles are chosen only where its `source` says there is something (`covers`), filled
 * by the source's `load` and coloured per pixel by a GLSL `shader` of yours. It lies flat at a
 * height over the sea, or on the relief as drawn (`drape`). `GeoPolygons` and `GeoGraticule`
 * are built on it. Use it for other area data, such as a raster or a heat map; for lines and
 * points from data, use `GeoTubes` and `GeoSymbols`.
 */
const meta = {
  title: 'Components/Geo layers/GeoTileLayer',
  component: GeoTileLayerStory,
  decorators: [
    Canvas3dDecorator,
    GeneratorsProviderDecorator,
    DataProviderDecorator,
  ],
  parameters: {
    scale: 1000,
    far: 3000000,
    autoClear: true,
    cameraPosition: [0, 25000, 32000],
    cameraTarget: [0, LEVEL, 0],
    // The Scenery lights the scene.
    ownLighting: () => true,
  },
  args: {
    drape: true,
    height: 0,
    water: 'clear',
    opacity: 1,
    cellSize: 1000,
    radius: 15,
    color: '#f28e2c',
  },
  argTypes: {
    drape: {
      control: { type: 'boolean' },
      description:
        'Lie on the relief (`GeoRelief`) as drawn, its land and its seabed (`drape`); off, flat at `height` everywhere.',
      table: { category: LAYER },
    },
    height: {
      control: { type: 'range', min: -400, max: 1000, step: 10 },
      description:
        'Metres over the sea\u2019s level where the layer lies flat (`height`): with `drape` off, or where no relief is drawn.',
      table: { category: LAYER },
    },
    water: {
      options: ['fog', 'clear'],
      control: { type: 'inline-radio' },
      description:
        'FOG: seen through the sea as the seabed is, dimmed with the water in front, and under the sea\u2019s surface. CLEAR: drawn over everything see-through, as a map is (`water`).',
      table: { category: LAYER },
    },
    opacity: {
      control: { type: 'range', min: 0, max: 1, step: 0.05 },
      description: 'The whole layer\u2019s (`opacity`).',
      table: { category: LAYER },
    },
    cellSize: {
      control: { type: 'range', min: 100, max: 5000, step: 100 },
      description:
        'Metres a side of the checkerboard\u2019s cells: a uniform of the layer\u2019s own shader, set without a new material.',
      table: { category: PATTERN },
    },
    radius: {
      control: { type: 'range', min: 2, max: 50, step: 1 },
      description:
        'The disc\u2019s radius about the field, km: in the shader, and in `source.covers`, so no tile is chosen or drawn beyond it.',
      table: { category: PATTERN },
    },
    color: {
      control: { type: 'color' },
      description: 'The coloured cells\u2019; the others are see-through.',
      table: { category: PATTERN },
    },
  },
} satisfies Meta<typeof GeoTileLayerStory>;

export default meta;
type Story = StoryObj<typeof meta>;

/**
 * A checkerboard over a disc about the demo field, draped on the relief. Its source loads
 * nothing (no `load`): the shader works the pattern out from where each pixel lies. Set the
 * cells' size and colour and the disc's `radius` in the Pattern group, lay it flat at a
 * `height` (`drape` off), and see it through the sea (`water: fog`).
 */
export const Default: Story = {};
