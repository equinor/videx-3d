import { useThree } from '@react-three/fiber';
import type { Meta, StoryObj } from '@storybook/react-vite';
import proj4 from 'proj4';
import { useCallback, useEffect, useMemo } from 'react';
import { MeshStandardMaterial, SphereGeometry } from 'three';
import type { ReliefLayer } from '../../sdk/geometries/relief-tiles';
import {
  Boundary,
  boundaryDisc,
  boundaryOutline,
} from '../../sdk/geometries/boundary';
import { getProjectionDefFromUtmZone } from '../../sdk/projection/crs';
import { GeoFrame, geoFrameAt } from '../../sdk/projection/geo-frame';
import { carryCamera } from '../../sdk/utils/camera';
import { SCENERY_DEMO_RELIEF_LAYERS } from '../../storybook/components/scenery-controls';
import { demoFrame } from '../../storybook/data/demo-crs';
import { Canvas3dDecorator } from '../../storybook/decorators/canvas-3d-decorator';
import { DataProviderDecorator } from '../../storybook/decorators/data-provider-decorator';
import { GeneratorsProviderDecorator } from '../../storybook/decorators/generators-provider-decorator';
import { SceneryGenerators } from '../../storybook/decorators/scenery-generators';
import { GeoRelief, GeoReliefProps } from '../Layers/GeoRelief';
import { Scenery } from '../Scenery/Scenery';
import { ScenerySea } from '../Scenery/ScenerySea';
import { SceneryStage } from '../Scenery/SceneryStage';
import { UtmArea } from '../UtmArea/UtmArea';
import { World, WorldFrameChange } from './World';

// Fields placed on the Earth by a `World`: its `frame` says where the scene lies (the
// anchored field's map, about its origin), its `boundary` the anchored field's stage, over
// which the globe is cut flat. Each field is a `UtmArea` in a frame of its own, which the
// World places on the globe; a `Scenery` draws the sky, the sea and the stage about the
// anchored one. A field here is a few spheres: at the sea's level along its stage's outline,
// and at a reservoir's depth across its middle.

const LEVEL = 0;
const DEPTH = 100;
// Where the deep spheres lie, metres below the sea.
const RESERVOIR = 2500;
// The spheres' radii: at the sea's level (large enough to see from the default view, 50 km
// off), and at the reservoir's depth.
const SEA_MARK = 400;
const DEEP_MARK = 250;

const NO_LAYERS: ReliefLayer[] = [];
const RELIEF_COLOR: GeoReliefProps['color'] = { ramp: 'terrain' };

type FieldId = 'volve' | 'trench' | 'overlap';

type Field = {
  id: FieldId;
  frame: GeoFrame;
  /** its stage's area, in its own frame */
  boundary: Boundary;
  color: string;
};

// A point `east` and `north` metres from the demo field's origin, in its map.
const demoPoint = (east: number, north: number): [number, number] => [
  demoFrame.origin[0] + east,
  demoFrame.origin[1] + north,
];

const UTM_32N = getProjectionDefFromUtmZone('32N');

// Each field's stage a shape of its own: a circle, a turned box, a polygon.
const FIELDS: Record<FieldId, Field> = {
  // The demo field: a circle 18 km across.
  volve: {
    id: 'volve',
    frame: demoFrame,
    boundary: { centre: [0, 0], radius: 9000 },
    color: '#ff7a1a',
  },
  // 123 km east over the Norwegian Trench, in the next UTM zone: a box of 27 x 13 km,
  // turned 30° from its grid.
  trench: {
    id: 'trench',
    frame: {
      projection: UTM_32N,
      origin: proj4(demoFrame.projection, UTM_32N, demoPoint(123000, 7000)).map(
        Math.round,
      ) as [number, number],
    },
    boundary: { box: [-13500, -6500, 13500, 6500], rotation: Math.PI / 6 },
    color: '#e040fb',
  },
  // Overlapping Volve's stage, 10 km east and 4 km north, in a transverse Mercator about its
  // own middle: another map of the same ground. An L, 16 km on its long sides.
  overlap: {
    id: 'overlap',
    frame: geoFrameAt(
      ...(proj4(demoFrame.projection, 'WGS84', demoPoint(10000, 4000)) as [
        number,
        number,
      ]),
    ),
    boundary: [
      [-8000, -8000],
      [8000, -8000],
      [8000, 0],
      [0, 0],
      [0, 8000],
      [-8000, 8000],
    ],
    color: '#18ffff',
  },
};

const FIELD_LIST = Object.values(FIELDS);

const FIELD_LABELS: Record<FieldId, string> = {
  volve: 'Volve (orange)',
  trench: 'Trench (magenta)',
  overlap: 'Overlap (cyan)',
};

// The spheres in a field's own frame: at the sea's level on its disc's middle and along its
// outline, and three at the reservoir's depth across its middle.
const fieldMarks = (boundary: Boundary) => {
  const {
    centre: [cx, cz],
    radius,
  } = boundaryDisc(boundary);
  // Once each: a polygon's disc may be centred on one of its corners (the L's is).
  const atSea = [[cx, cz], ...boundaryOutline(boundary, 8)[0]]
    .filter(
      ([x, z], i, all) => all.findIndex(([u, v]) => u === x && v === z) === i,
    )
    .map(([x, z]): [number, number, number] => [x, LEVEL, z]);
  const deep = [cx - radius / 3, cx, cx + radius / 3].map(
    (x): [number, number, number] => [x, LEVEL - RESERVOIR, cz],
  );
  return { atSea, deep };
};

/** A field's spheres, drawn in its own frame (inside its `UtmArea`). */
const FieldMarks = ({ field }: { field: Field }) => {
  const { atSea, deep } = useMemo(() => fieldMarks(field.boundary), [field]);
  const sphere = useMemo(() => new SphereGeometry(1, 32, 16), []);
  const material = useMemo(
    () => new MeshStandardMaterial({ color: field.color, roughness: 0.6 }),
    [field],
  );
  useEffect(() => () => sphere.dispose(), [sphere]);
  useEffect(() => () => material.dispose(), [material]);
  return (
    <>
      {atSea.map(at => (
        <mesh
          key={at.join(',')}
          geometry={sphere}
          material={material}
          position={at}
          scale={SEA_MARK}
        />
      ))}
      {deep.map(at => (
        <mesh
          key={at.join(',')}
          geometry={sphere}
          material={material}
          position={at}
          scale={DEEP_MARK}
        />
      ))}
    </>
  );
};

type SceneArgs = {
  globe: boolean;
  relief: boolean;
  fieldOpacity: number;
};

type SceneProps = SceneArgs & {
  anchor: Field;
  fields: Field[];
  onFrameChange?: (change: WorldFrameChange) => void;
};

/** The World anchored to `anchor`, its sky, sea and stage, the relief, and every field. */
const FieldsScene = ({
  anchor,
  fields,
  globe,
  relief,
  fieldOpacity,
  onFrameChange,
}: SceneProps) => (
  <World
    frame={anchor.frame}
    boundary={anchor.boundary}
    globe={globe}
    onFrameChange={onFrameChange}
  >
    <SceneryGenerators>
      <Scenery>
        <ScenerySea level={LEVEL} depth={DEPTH} />
        {/* Its area is the World's `boundary`: the anchored field's stage. */}
        <SceneryStage />
      </Scenery>
      {/* The seabed: the demo reliefs, or without them flat at the sea's depth. */}
      <GeoRelief
        layers={relief ? SCENERY_DEMO_RELIEF_LAYERS : NO_LAYERS}
        depth={DEPTH}
        color={RELIEF_COLOR}
        fieldOpacity={fieldOpacity}
      />
    </SceneryGenerators>
    {fields.map(field => (
      <UtmArea
        key={field.id}
        id={field.id}
        frame={field.frame}
        boundary={field.boundary}
      >
        <FieldMarks field={field} />
      </UtmArea>
    ))}
  </World>
);

type DefaultArgs = SceneArgs & {
  stageRadius: number;
};

const DefaultStory = ({ stageRadius, ...scene }: DefaultArgs) => {
  const field = useMemo<Field>(
    () => ({
      ...FIELDS.volve,
      boundary: { centre: [0, 0], radius: stageRadius * 1000 },
    }),
    [stageRadius],
  );
  return <FieldsScene anchor={field} fields={[field]} {...scene} />;
};

type FieldsArgs = SceneArgs & {
  anchor: FieldId;
  keepView: boolean;
};

const FieldsStory = ({ anchor, keepView, ...scene }: FieldsArgs) => {
  const camera = useThree(state => state.camera);
  const controls = useThree(state => state.controls);
  // The host's side of a switch: carry the camera, its target and its up to the new frame
  // by where they are on the Earth. The library never moves the camera.
  const onFrameChange = useCallback(
    ({ carry }: WorldFrameChange) => {
      if (keepView) carryCamera(carry, camera, controls);
    },
    [keepView, camera, controls],
  );
  return (
    <FieldsScene
      anchor={FIELDS[anchor]}
      fields={FIELD_LIST}
      onFrameChange={onFrameChange}
      {...scene}
    />
  );
};

const WORLD = 'World';
const SCENE = 'Scene';

const sceneArgs: SceneArgs = {
  globe: true,
  relief: true,
  fieldOpacity: 0.6,
};

const sceneArgTypes = {
  globe: {
    control: { type: 'boolean' },
    description:
      'The Earth is curved (`globe`): the sea, the relief and every field lie on a sphere, cut flat over the anchored stage\u2019s disc. Off, everything lies on the level plane, as on a map.',
    table: { category: WORLD },
  },
  relief: {
    control: { type: 'boolean' },
    description:
      'The demo reliefs\u2019 land and seabed (`GeoRelief` `layers`), read in the World\u2019s frame: see-through over each field\u2019s stage, its shape followed. Off, the relief has no layers: the seabed lies flat at the sea\u2019s depth.',
    table: { category: SCENE },
  },
  fieldOpacity: {
    control: { type: 'range', min: 0, max: 1, step: 0.05 },
    description:
      'How much of what lies under the seabed it hides over the fields (`GeoRelief`\u2019s `fieldOpacity`): below 1 the spheres at the reservoir\u2019s depth show through.',
    table: { category: SCENE },
  },
} as const;

/**
 * `World` says where the scene lies on the Earth (`frame`) and places everything in it on the
 * globe. Each field is a `UtmArea` in a map of its own, which the world places where its map
 * has it; the sky and the sea (`Scenery`) and the relief (`GeoRelief`) lie on the same globe,
 * cut flat over the anchored field's stage (`boundary`).
 *
 * Here a field is a few spheres: large ones at sea level in its middle and round the edge of
 * its stage, and three smaller ones across its middle at a reservoir's depth, 2500 m down.
 * Turn the Earth's curve off (`globe`), leave out the demo relief (`relief`), or see under the
 * seabed over the fields (`fieldOpacity`).
 */
const meta = {
  title: 'Components/Georeferencing/World',
  decorators: [
    Canvas3dDecorator,
    // The relief's tiles, built from the store by a generator.
    GeneratorsProviderDecorator,
    DataProviderDecorator,
  ],
  parameters: {
    scale: 1000,
    far: 3000000,
    autoClear: true,
    // West of the field, looking east past its marks to the coast and the Earth's curve.
    cameraPosition: [-39000, 23000, 0],
    cameraTarget: [5000, LEVEL - DEPTH, 0],
    // The Scenery lights the scene.
    ownLighting: () => true,
  },
} satisfies Meta;

export default meta;

/**
 * The demo field alone: its map is the world's `frame`, and its stage, a circle of
 * `stageRadius` km, is the `boundary` the globe is cut flat over and the `SceneryStage` is
 * drawn in. Change the radius and the spheres along the edge follow.
 */
export const Default: StoryObj<DefaultArgs> = {
  args: { ...sceneArgs, stageRadius: 9 },
  argTypes: {
    ...sceneArgTypes,
    stageRadius: {
      control: { type: 'range', min: 2, max: 20, step: 1 },
      description:
        'The stage\u2019s radius, km: the `World`\u2019s `boundary` (a circle), the area the sky\u2019s stage draws and the globe is flat over. Its spheres stand along it.',
      table: { category: WORLD },
    },
  },
  render: args => <DefaultStory {...args} />,
};

/**
 * Three fields, each with a map and a stage shape of its own: the demo field (orange, a circle),
 * one 123 km east in the next UTM zone (magenta, a turned box), and one overlapping the demo
 * field in a map about its own middle (cyan, an L). Switch the field the world is anchored to
 * (`anchor`) and everything is placed anew in its frame before the next frame is drawn; with
 * `keepView` the camera is carried along (`onFrameChange`) and stays where it was on the Earth.
 */
export const Fields: StoryObj<FieldsArgs> = {
  args: { ...sceneArgs, anchor: 'volve', keepView: false },
  argTypes: {
    anchor: {
      options: Object.keys(FIELDS),
      control: { type: 'inline-radio', labels: FIELD_LABELS },
      description:
        'The field the scene is anchored to (`frame`, `boundary`). VOLVE: the demo field, a circle 18 km across. TRENCH: 123 km east, in the next UTM zone (32N), a box 27 x 13 km turned 30\u00b0. OVERLAP: 10 km east and 4 km north, overlapping Volve, in a transverse Mercator about its own middle, an L.',
      table: { category: WORLD },
    },
    keepView: {
      control: { type: 'boolean' },
      description:
        'On a switch, carry the camera to the new frame (`onFrameChange`\u2019s `carry`, `carryCamera`): the view stays where it was on the Earth, and the stage moves to the new field. Off, the camera keeps its coordinates: it looks at the new field as it did at the old.',
      table: { category: WORLD },
    },
    ...sceneArgTypes,
  },
  render: args => <FieldsStory {...args} />,
};
