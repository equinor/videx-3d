import type { CameraControls } from '@react-three/drei';
import { useThree } from '@react-three/fiber';
import type { Meta, StoryObj } from '@storybook/react-vite';
import proj4 from 'proj4';
import {
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import {
  BoxGeometry,
  CylinderGeometry,
  Group,
  MeshStandardMaterial,
  SphereGeometry,
  Vector3,
} from 'three';
import { getProjectionDefFromUtmZone } from '../../sdk/projection/crs';
import {
  Boundary,
  boundaryDisc,
  boundaryOutline,
} from '../../sdk/geometries/boundary';
import { GeoFrame, geoFrameAt } from '../../sdk/projection/geo-frame';
import {
  sceneryArgs,
  SceneryArgs,
  sceneryArgTypes,
  sceneryDecorators,
  sceneryProgressArgs,
  sceneryPropsFromArgs,
  sceneryReliefArgs,
  SceneryReliefArgs,
  sceneryReliefArgTypes,
  sceneryReliefFromArgs,
} from '../../storybook/components/scenery-controls';
import {
  SceneryDebugPanel,
  useSceneryTimelapse,
} from '../../storybook/components/scenery-debug-panel';
import { SceneryArgsFeatures } from '../../storybook/components/scenery-features';
import { SceneryStoryRendering } from '../../storybook/components/scenery-story-rendering';
import { demoFrame } from '../../storybook/data/demo-crs';
import { Canvas3dDecorator } from '../../storybook/decorators/canvas-3d-decorator';
import { DataProviderDecorator } from '../../storybook/decorators/data-provider-decorator';
import { EventEmitterDecorator } from '../../storybook/decorators/event-emitter-decorator';
import { GeneratorsProviderDecorator } from '../../storybook/decorators/generators-provider-decorator';
import {
  ProgressArgs,
  progressArgTypes,
  storyProgress,
} from '../../storybook/decorators/progress-decorator';
import { SceneryGenerators } from '../../storybook/decorators/scenery-generators';
import {
  EventEmitterCallback,
  EventEmitterCallbackEvent,
  useEventEmitter,
} from '../EventEmitter/EventEmitterContext';
import { GeoRelief } from '../Layers/GeoRelief';
import { Scenery } from '../Scenery/Scenery';
import { SceneryStage } from '../Scenery/SceneryStage';
import { useLevelHorizon } from '../Scenery/useLevelHorizon';
import { UtmArea } from '../UtmArea/UtmArea';
import { UtmAreaContext, UtmAreaContextProps } from '../UtmArea/UtmAreaContext';
import { Wgs84Position } from '../UtmArea/Wgs84Position';
import { World, WorldFrameChange } from './World';

// More than one field on the Earth (documents/world.md, step 7): three fields, each a frame,
// a stage and a few spheres for data. One of them is anchored: the World's frame, and the
// stage's area.

const LEVEL = 0;
const DEPTH = 100;
// Where the deep spheres lie, metres below the sea: a reservoir's depth.
const RESERVOIR = 2500;
// The spheres' radii: at the sea's level, and at the reservoir's depth.
const SEA_MARK = 100;
const DEEP_MARK = 250;

type FieldId = 'volve' | 'trench' | 'overlap';

type Field = {
  name: string;
  frame: GeoFrame;
  /** its stage's area, in its own frame */
  boundary: Boundary;
  color: string;
};

const FIELD_IDS: FieldId[] = ['volve', 'trench', 'overlap'];

// A point `east` and `north` metres from the demo field's origin, in its map.
const demoPoint = (east: number, north: number): [number, number] => [
  demoFrame.origin[0] + east,
  demoFrame.origin[1] + north,
];

const UTM_32N = getProjectionDefFromUtmZone('32N');

// Each field's area a shape of its own (a circle, a turned box, a polygon), so the relief's
// see-through over each shows that it follows the shape.
const FIELDS: Record<FieldId, Field> = {
  // The demo field: a circle 18 km across, a large field's size.
  volve: {
    name: 'Volve',
    frame: demoFrame,
    boundary: { centre: [0, 0], radius: 9000 },
    color: '#ff7a1a',
  },
  // Over the Norwegian Trench, 123 km east, in the next UTM zone, with a map of its own about
  // its point, to the metre; a stage of Troll's length, 27 x 13 km, turned 30° from its grid.
  trench: {
    name: 'Trench',
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
  // own middle: another projection over the same ground. An L, 16 km on its long sides.
  overlap: {
    name: 'Overlap',
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

// `field`'s point at its own X/Z, as `anchor`'s map has it: X east and Z south of its origin.
const pointIn = (
  anchor: Field,
  field: Field,
  [x, z]: [number, number],
): [number, number] => {
  const [e0, n0] = field.frame.origin;
  const [e, n] =
    field === anchor
      ? [e0 + x, n0 - z]
      : proj4(field.frame.projection, anchor.frame.projection, [
          e0 + x,
          n0 - z,
        ]);
  return [e - anchor.frame.origin[0], anchor.frame.origin[1] - n];
};

// A point of the Earth outside every field, 60 km east and 3 km north of Volve: longitude and
// latitude, where the marker stands.
const MARKER = proj4(demoFrame.projection, 'WGS84', demoPoint(60000, 3000)) as [
  number,
  number,
];

// The panel's places: each field's middle (its disc's) and the point of its outline farthest
// north-east, and the marker, in the anchor's map.
const placesIn = (anchor: Field) => {
  const [e, n] = proj4('WGS84', anchor.frame.projection, MARKER);
  return Object.fromEntries([
    ...FIELD_IDS.flatMap(id => {
      const field = FIELDS[id];
      const { centre } = boundaryDisc(field.boundary);
      const corner = boundaryOutline(field.boundary)[0].reduce((a, b) =>
        b[0] - b[1] > a[0] - a[1] ? b : a,
      );
      return [
        [field.name, pointIn(anchor, field, centre)],
        [`${field.name} corner`, pointIn(anchor, field, corner)],
      ];
    }),
    ['Marker', [e - anchor.frame.origin[0], anchor.frame.origin[1] - n]],
  ]) as Record<string, [number, number]>;
};

const SPHERE = new SphereGeometry(1, 32, 16);
const MAST = new CylinderGeometry(30, 30, 400, 16);
const FLAG = new BoxGeometry(20, 60, 160);

/**
 * A mast at a point of the Earth outside every field, placed by its longitude and latitude in
 * the `World` itself (`Wgs84Position`, no `UtmArea` around it): on the globe there, upright,
 * its flag toward true north, whichever field is anchored.
 */
const EarthMarker = () => {
  const material = useMemo(
    () => new MeshStandardMaterial({ color: '#ffffff', roughness: 0.5 }),
    [],
  );
  useEffect(() => () => material.dispose(), [material]);
  return (
    <Wgs84Position long={MARKER[0]} lat={MARKER[1]}>
      <mesh
        name="earth-marker"
        geometry={MAST}
        material={material}
        position={[0, 200, 0]}
      />
      <mesh
        name="earth-marker-flag"
        geometry={FLAG}
        material={material}
        position={[0, 370, -80]}
      />
    </Wgs84Position>
  );
};

// The spheres in a field's own frame: at the sea's level on its disc's middle and along its
// outline, where a flat field parts from the curved sea most; and three at the reservoir's
// depth, across its middle.
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

/**
 * A field's spheres, in its own frame. Its listener is registered with the field's area as
 * its `ref`, taken from where it is drawn (`UtmAreaContext`, inside the field's `UtmArea`), so
 * `onPick` is one handler for every field.
 */
const FieldMarks = ({
  field,
  onPick,
}: {
  field: Field;
  onPick: EventEmitterCallback;
}) => {
  const { atSea, deep } = useMemo(() => fieldMarks(field.boundary), [field]);
  const material = useMemo(
    () => new MeshStandardMaterial({ color: field.color, roughness: 0.6 }),
    [field],
  );
  useEffect(() => () => material.dispose(), [material]);
  const group = useRef<Group>(null);
  const emitter = useEventEmitter();
  const area = useContext(UtmAreaContext);
  useEffect(() => {
    if (!emitter || !group.current) return;
    return emitter.register({
      object: group.current,
      handlers: { click: onPick },
      ref: area,
    });
  }, [emitter, area, onPick]);
  return (
    <group ref={group}>
      {atSea.map(at => (
        <mesh
          key={at.join(',')}
          geometry={SPHERE}
          material={material}
          position={at}
          scale={SEA_MARK}
        />
      ))}
      {deep.map(at => (
        <mesh
          key={at.join(',')}
          geometry={SPHERE}
          material={material}
          position={at}
          scale={DEEP_MARK}
        />
      ))}
    </group>
  );
};

/** A field: its spheres, placed in the World's frame by its `UtmArea`, named by its id. */
const FieldSpheres = ({
  id,
  onPick,
}: {
  id: FieldId;
  onPick: EventEmitterCallback;
}) => {
  const field = FIELDS[id];
  return (
    <UtmArea id={id} frame={field.frame} boundary={field.boundary}>
      <FieldMarks field={field} onPick={onPick} />
    </UtmArea>
  );
};

// The host's side of a pick (world.md, step 7f): one handler for every field, told by the
// listener's `ref` which field it hit (its area) and so where, in that field's own frame and
// map. Shown over the view.
function usePickReadout() {
  const gl = useThree(state => state.gl);
  const [readout] = useState(() => {
    const element = document.createElement('div');
    Object.assign(element.style, {
      position: 'absolute',
      left: '50%',
      bottom: '12px',
      transform: 'translateX(-50%)',
      padding: '4px 10px',
      borderRadius: '4px',
      background: 'rgba(13, 26, 38, 0.8)',
      color: '#fff',
      font: '12px monospace',
      whiteSpace: 'pre',
      pointerEvents: 'none',
      zIndex: '4',
    });
    element.textContent = 'Click a sphere';
    return element;
  });
  useEffect(() => {
    (gl.domElement.parentElement ?? document.body).appendChild(readout);
    return () => readout.remove();
  }, [gl, readout]);
  return useCallback(
    ({ ref, position }: EventEmitterCallbackEvent) => {
      const area = ref as UtmAreaContextProps | null;
      if (!area || !position) return;
      const [x, y, z] = area.worldToArea(...position);
      const { easting, northing } = area.worldToUtm(...position);
      const name = FIELDS[area.id as FieldId]?.name ?? area.id;
      readout.textContent =
        `${name}: x ${x.toFixed(1)}, y ${y.toFixed(1)}, z ${z.toFixed(1)} in its frame; ` +
        `E ${easting.toFixed(1)}, N ${northing.toFixed(1)} in its map`;
    },
    [readout],
  );
}

// The host's side of levelling the horizon far off (useLevelHorizon), in the World.
const LevelHorizon = ({ enabled }: { enabled: boolean }) => {
  useLevelHorizon({ enabled });
  return null;
};

// How long the story's cover takes to close and to open, in ms.
const FADE = 250;
// The longest the cover waits for the progress reports to go quiet after a switch, in ms.
const FADE_WAIT = 3000;

/**
 * The story's cover for a switch: a curtain over the canvas, drawn in and away again. The
 * library draws none: covering a switch is the host's, as it likes.
 */
function useCurtain() {
  const gl = useThree(state => state.gl);
  const [curtain] = useState(() => {
    const element = document.createElement('div');
    Object.assign(element.style, {
      position: 'absolute',
      inset: '0',
      background: '#0d1a26',
      opacity: '0',
      pointerEvents: 'none',
      transition: `opacity ${FADE}ms ease`,
      zIndex: '5',
    });
    return element;
  });
  useEffect(() => {
    (gl.domElement.parentElement ?? document.body).appendChild(curtain);
    return () => curtain.remove();
  }, [gl, curtain]);
  return useMemo(
    () => ({
      close: () =>
        new Promise<void>(resolve => {
          curtain.style.opacity = '1';
          setTimeout(resolve, FADE);
        }),
      open: () => {
        curtain.style.opacity = '0';
      },
    }),
    [curtain],
  );
}

/** Resolves once nothing reports progress (the sky's bake, the relief's tiles), or after `most` ms. */
function progressQuiet(most: number) {
  const start = performance.now();
  return new Promise<void>(resolve => {
    const check = () => {
      const busy = storyProgress.getSnapshot().all.building;
      if (!busy || performance.now() - start > most) resolve();
      else setTimeout(check, 100);
    };
    // A beat first, for what the switch set off to start reporting.
    setTimeout(check, 100);
  });
}

/**
 * The host's side of a switch: carries the camera, its controls' target and its up to the
 * new frame by where they are on the Earth, so the view does not move.
 */
function useCarryCamera(enabled: boolean) {
  const camera = useThree(state => state.camera);
  const controls = useThree(
    state => state.controls,
  ) as unknown as CameraControls | null;
  return useCallback(
    ({ carry }: WorldFrameChange) => {
      if (!enabled) return;
      const position = controls
        ? controls.getPosition(new Vector3(), false)
        : camera.position.clone();
      const target = controls?.getTarget(new Vector3(), false) ?? null;
      const up = carry.direction(camera.up, position, new Vector3());
      carry.point(position, position);
      camera.up.copy(up);
      if (controls && target) {
        carry.point(target, target);
        controls.updateCameraUp();
        void controls.setLookAt(
          position.x,
          position.y,
          position.z,
          target.x,
          target.y,
          target.z,
          false,
        );
      } else {
        camera.position.copy(position);
      }
    },
    [enabled, camera, controls],
  );
}

type WorldFieldsArgs = SceneryArgs &
  SceneryReliefArgs &
  ProgressArgs & {
    anchor: FieldId;
    fade: boolean;
    carryCamera: boolean;
    scenery: boolean;
    reliefOpacity: number;
    reliefFieldOpacity: number;
    reliefShowLand: boolean;
    reliefShowSeabed: boolean;
    panel: boolean;
    levelHorizon: boolean;
  };

const WorldFields = (storyArgs: WorldFieldsArgs) => {
  const { args, timelapse } = useSceneryTimelapse(storyArgs);
  // The anchor drawn, which follows the control's once the curtain has closed.
  const [shown, setShown] = useState<FieldId>(args.anchor);
  const curtain = useCurtain();
  useEffect(() => {
    if (args.anchor === shown) return;
    if (!args.fade) {
      setShown(args.anchor);
      return;
    }
    let live = true;
    void curtain.close().then(() => {
      if (live) setShown(args.anchor);
    });
    return () => {
      live = false;
    };
  }, [args.anchor, args.fade, shown, curtain]);
  const onFrameChange = useCarryCamera(args.carryCamera);
  const onFrameSettled = useCallback(() => {
    void progressQuiet(FADE_WAIT).then(curtain.open);
  }, [curtain]);

  const anchor = FIELDS[shown];
  const places = useMemo(() => placesIn(anchor), [anchor]);
  const relief = sceneryReliefFromArgs(args);
  const onPick = usePickReadout();

  return (
    <World
      frame={anchor.frame}
      boundary={anchor.boundary}
      globe={args.globe}
      onFrameChange={onFrameChange}
      onFrameSettled={onFrameSettled}
    >
      <SceneryStoryRendering args={args} />
      <LevelHorizon enabled={args.levelHorizon} />
      {args.panel && (
        <SceneryDebugPanel
          args={args}
          level={LEVEL}
          positions={places}
          timelapse={timelapse}
        />
      )}
      <SceneryGenerators>
        {args.scenery && (
          <Scenery {...sceneryPropsFromArgs(args)}>
            <SceneryArgsFeatures
              args={args}
              ocean={{ level: LEVEL, depth: DEPTH }}
              abyss={{}}
            />
            {/* Its area is the World's: the anchored field's stage. */}
            <SceneryStage />
          </Scenery>
        )}
        {/* The Earth's: beside the Scenery, which only shades it. */}
        {relief && (
          <GeoRelief
            {...relief}
            opacity={args.reliefOpacity}
            fieldOpacity={args.reliefFieldOpacity}
            land={args.reliefShowLand}
            seabed={args.reliefShowSeabed}
          />
        )}
      </SceneryGenerators>
      {FIELD_IDS.map(id => (
        <FieldSpheres key={id} id={id} onPick={onPick} />
      ))}
      <EarthMarker />
    </World>
  );
};

const meta = {
  title: 'Spikes/World/Fields',
  component: WorldFields,
  decorators: [
    // Picks on the spheres, inside the canvas.
    EventEmitterDecorator,
    Canvas3dDecorator,
    // The reliefs' tiles, built from the store by a generator.
    GeneratorsProviderDecorator,
    DataProviderDecorator,
    ...sceneryDecorators,
  ],
  parameters: {
    scale: 1000,
    far: 3000000,
    autoClear: true,
    cameraPosition: [-12000, 9000, 20000],
    cameraTarget: [0, LEVEL - DEPTH, 0],
    // The Scenery lights the scene; without it, the decorator's lights do.
    ownLighting: (args: WorldFieldsArgs) => args.scenery,
  },
  argTypes: {
    ...sceneryArgTypes(),
    ...sceneryReliefArgTypes(),
    ...progressArgTypes,
    anchor: {
      control: { type: 'inline-radio' },
      options: FIELD_IDS,
      description:
        'The field the scene is anchored to: the `World`\u2019s frame, and the stage\u2019s area. Each field\u2019s area is a shape of its own (`boundary`). VOLVE: the demo field, a circle 18 km across, orange. TRENCH: 123 km east over the Norwegian Trench, in the next UTM zone (32N), a box of Troll\u2019s length (27 x 13 km) turned 30\u00b0, magenta. OVERLAP: 10 km east and 4 km north of Volve, overlapping its stage, in a transverse Mercator about its own middle, an L-shaped polygon 16 km across, cyan. Switched under a cover (`fade`), the camera carried by the `World`\u2019s `onFrameChange` (`carryCamera`).',
      table: { category: 'World' },
    },
    fade: {
      description:
        'Cover a switch of `anchor`, as a host might: a curtain over the canvas closes, the frame changes, and it opens once the `World` says it has settled (`onFrameSettled`) and the progress reports go quiet (at most 3 s). The library draws none. Off, the switch is seen as it is.',
      table: { category: 'World' },
    },
    carryCamera: {
      description:
        'Carry the camera, its target and its up to the new frame on `onFrameChange`, by where they are on the Earth (`change.carry`): the view stays where it was. Off, the camera keeps its coordinates, and the view jumps.',
      table: { category: 'World' },
    },
    scenery: {
      description:
        'Draw the `Scenery` (sky, sea, stage). Everything is placed on the `World`\u2019s globe either way: toggling it moves nothing. The relief stays, its tiles kept: shaded by the sky with it, plainly without it.',
      table: { category: 'World' },
    },
    reliefOpacity: {
      control: { type: 'range', min: 0, max: 1, step: 0.05 },
      description:
        'Without the scenery, how much of what lies under the relief it hides, everywhere (`GeoRelief`\u2019s `opacity`): below 1 all of it is drawn see-through. With the scenery, the sky decides.',
      table: { category: 'World' },
      if: { arg: 'relief' },
    },
    reliefFieldOpacity: {
      control: { type: 'range', min: 0, max: 1, step: 0.05 },
      description:
        'Without the scenery, the same over the anchored field\u2019s stage (`fieldOpacity`), the lower of the two there: below 1 the reservoir spheres show through it. With the scenery, the sea\u2019s `skySeabedOpacity` decides.',
      table: { category: 'World' },
      if: { arg: 'relief' },
    },
    reliefShowLand: {
      description:
        'Without the scenery, draw the relief\u2019s land: the ground at or above the sea\u2019s level (`GeoRelief`\u2019s `land`).',
      table: { category: 'World' },
      if: { arg: 'relief' },
    },
    reliefShowSeabed: {
      description:
        'Without the scenery, draw the relief\u2019s seabed: the ground below the sea\u2019s level (`GeoRelief`\u2019s `seabed`).',
      table: { category: 'World' },
      if: { arg: 'relief' },
    },
    panel: {
      description:
        'Buttons over the view: the camera\u2019s height, moves to set altitudes, each field\u2019s middle and north-east corner, and views.',
      table: { category: 'Debug' },
    },
    levelHorizon: {
      description:
        'Keeps the camera\u2019s horizon level far from the anchored field (`useLevelHorizon`).',
      table: { category: 'World' },
    },
  },
  args: {
    ...sceneryArgs,
    ...sceneryReliefArgs,
    ...sceneryProgressArgs,
    relief: true,
    reliefColor: 'ramp',
    anchor: 'volve',
    fade: true,
    carryCamera: true,
    scenery: true,
    reliefOpacity: 1,
    reliefFieldOpacity: 1,
    reliefShowLand: true,
    reliefShowSeabed: true,
    panel: true,
    levelHorizon: true,
  },
} satisfies Meta<typeof WorldFields>;

export default meta;
type Story = StoryObj<typeof meta>;

/**
 * Three fields, each a stage of its own shape, a frame and spheres: at the sea's level on its
 * stage's middle and along its outline, and at a reservoir's depth. Anchor each in turn —
 * covered by a fade, the camera carried — and toggle the scenery: nothing placed moves. Click
 * a sphere: one handler for all three is told which field it hit and where, in that field's
 * own frame and map.
 */
export const Default: Story = {};
