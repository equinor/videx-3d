import type { Meta, StoryObj } from '@storybook/react-vite';
import { useEffect, useState } from 'react';
import type { Anchor } from '../../../common/anchor';
import {
  reportReliefProgress,
  SCENERY_DEMO_RELIEF_LAYERS,
} from '../../../storybook/components/scenery-controls';
import { demoFrame } from '../../../storybook/data/demo-crs';
import { Canvas3dDecorator } from '../../../storybook/decorators/canvas-3d-decorator';
import { DataProviderDecorator } from '../../../storybook/decorators/data-provider-decorator';
import { GeneratorsProviderDecorator } from '../../../storybook/decorators/generators-provider-decorator';
import { SceneryGenerators } from '../../../storybook/decorators/scenery-generators';
import { GeoRelief } from '../../Layers/GeoRelief';
import { Scenery } from '../../Scenery/Scenery';
import { SceneryOcean } from '../../Scenery/SceneryOcean';
import { SceneryStage } from '../../Scenery/SceneryStage';
import { World } from '../../World/World';
import { AltitudeControl } from '../AltitudeControl/AltitudeControl';
import {
  GeoMapCameraMarker,
  GeoMapTargetMarker,
} from '../GeoMap/GeoMapMarkers';
import { GeoMapPoints, GeoMapPolyline } from '../GeoMap/layers/GeoMapLayers';
import { Overlay } from '../Overlay/Overlay';
import {
  Minimap,
  MINIMAP_CONTROLS,
  type MinimapControl,
  type MinimapProps,
  type MinimapZoom,
} from './Minimap';

// The inlet map over the demo reliefs around Volve (npm run generate-relief), in an
// Overlay over the 3D view with the altitude gadget: shaded or as an outline, zoomed by the
// camera's height or by level, with layers of its own; resized by its edges, closed into a
// button.

const LEVEL = 0;
const DEPTH = 100;
const LAYERS = SCENERY_DEMO_RELIEF_LAYERS;

// A marker per place, in the scene's X (east) and Z (south), from Volve.
const PLACES: { at: [number, number]; label: string }[] = [
  { at: [0, 0], label: 'Volve' },
  { at: [30000, 0], label: 'Volve edge' },
  { at: [123000, -7000], label: 'Trench' },
  { at: [215000, -40000], label: 'Coast' },
];
const SQUARE: [number, number][] = [
  [-2500, -2500],
  [2500, -2500],
  [2500, 2500],
  [-2500, 2500],
];
const STAGE_BOUNDS: [number, number, number, number] = [
  -8000, -8000, 8000, 8000,
];

// The zoom levels the story offers, passed as a host passes its own list: the library's
// default, and two past it for a projection of the whole world (`projection`).
const STORY_ZOOMS = [1000, 5000, 25000, 100000, 1000000, 5000000, 20000000];
const ANCHORS: Anchor[] = [
  'top-left',
  'top-center',
  'top-right',
  'left-center',
  'right-center',
  'bottom-left',
  'bottom-center',
  'bottom-right',
];
const ZOOM_OPTIONS = [
  'auto',
  ...STORY_ZOOMS.map(metres => `${metres / 1000} km`),
] as const;

type MinimapArgs = Omit<
  MinimapProps,
  | 'layers'
  | 'zoom'
  | 'children'
  | 'controls'
  | 'zooms'
  | 'altitude'
  | 'layout'
  | 'zoneBounds'
  | 'anchor'
> & {
  anchor: Anchor;
  zoneOutline: boolean;
  zoom: (typeof ZOOM_OPTIONS)[number];
  layerIds: string[];
  markers: boolean;
  controlButtons: MinimapControl[];
  markerColor: string;
  shapeColor: string;
  shape: 'cone' | 'circle' | 'none';
  // 0: the scale bar's length; else the reach in metres
  radiusMetres: number;
  targetMarker: boolean;
  draggable: boolean;
  altitudeReadout: boolean;
  altitudeGadget: boolean;
  altitudeMarker: 'camera' | 'target';
  altitudeAnchor: Anchor;
  altitudeMaxSpeed: number;
  altitudeBoost: number;
  compassAnchor: Anchor;
  readoutAnchor: Anchor;
  controlsAnchor: Anchor;
  controlsDirection: 'row' | 'column';
};

const zoomIndex = (zoom: MinimapArgs['zoom']): MinimapZoom =>
  zoom === 'auto' ? 'auto' : STORY_ZOOMS.indexOf(parseInt(zoom) * 1000);

const MinimapStory = ({
  zoom,
  orientation,
  center,
  layerIds,
  markers,
  controlButtons,
  markerColor,
  shapeColor,
  shape,
  radiusMetres,
  targetMarker,
  draggable,
  altitudeReadout,
  altitudeGadget,
  altitudeMarker,
  altitudeAnchor,
  altitudeMaxSpeed,
  altitudeBoost,
  compassAnchor,
  readoutAnchor,
  controlsAnchor,
  controlsDirection,
  zoneOutline,
  ...args
}: MinimapArgs) => {
  // The buttons, the wheel and the compass change these too: keep them, but follow the controls.
  const [currentZoom, setCurrentZoom] = useState<MinimapZoom>(zoomIndex(zoom));
  useEffect(() => setCurrentZoom(zoomIndex(zoom)), [zoom]);
  const [currentOrientation, setCurrentOrientation] = useState(orientation);
  useEffect(() => setCurrentOrientation(orientation), [orientation]);
  const [currentCenter, setCurrentCenter] = useState(center);
  useEffect(() => setCurrentCenter(center), [center]);
  const layers = LAYERS.filter(layer => layerIds.includes(layer.id));

  return (
    <World frame={demoFrame}>
      <SceneryGenerators>
        <Scenery>
          <SceneryOcean level={LEVEL} depth={DEPTH} />
          <SceneryStage boundary={STAGE_BOUNDS} />
        </Scenery>
        <GeoRelief
          layers={layers}
          depth={DEPTH}
          color={{ ramp: 'terrain' }}
          onProgress={reportReliefProgress}
        />
        <Overlay>
          <Minimap
            {...args}
            layers={layers}
            depth={DEPTH}
            zooms={STORY_ZOOMS}
            zoom={currentZoom}
            onZoomChange={setCurrentZoom}
            orientation={currentOrientation}
            onOrientationChange={setCurrentOrientation}
            center={currentCenter}
            onCenterChange={setCurrentCenter}
            controls={controlButtons}
            altitude={altitudeReadout}
            layout={{
              compass: { anchor: compassAnchor },
              altitude: { anchor: readoutAnchor },
              controls: {
                anchor: controlsAnchor,
                direction: controlsDirection,
              },
            }}
            level={LEVEL}
            zoneBounds={zoneOutline ? undefined : false}
            onMarkerDrop={(kind, at) =>
              console.info(`Minimap: ${kind} dropped at`, at)
            }
          >
            <GeoMapPolyline
              points={SQUARE}
              closed
              stroke="#ffd21a"
              fill="#ffd21a"
            />
            {markers && <GeoMapPoints points={PLACES} />}
            {targetMarker && (
              <GeoMapTargetMarker color={markerColor} draggable={draggable} />
            )}
            <GeoMapCameraMarker
              color={markerColor}
              shapeColor={shapeColor}
              shape={shape}
              radius={radiusMetres > 0 ? radiusMetres : undefined}
              draggable={draggable}
            />
          </Minimap>
          {altitudeGadget && (
            <AltitudeControl
              anchor={altitudeAnchor}
              marker={altitudeMarker}
              level={LEVEL}
              maxSpeed={altitudeMaxSpeed}
              boost={altitudeBoost}
            />
          )}
        </Overlay>
      </SceneryGenerators>
    </World>
  );
};

const meta = {
  title: 'Components/Html/Minimap',
  component: MinimapStory,
  decorators: [
    Canvas3dDecorator,
    // The reliefs, resampled onto longitude and latitude by a generator.
    GeneratorsProviderDecorator,
    DataProviderDecorator,
  ],
  parameters: {
    scale: 1000,
    far: 3000000,
    autoClear: true,
    cameraPosition: [9000, 2500, 9000],
    cameraTarget: [0, LEVEL - DEPTH, 0],
    ownLighting: () => true,
  },
  argTypes: {
    layerIds: {
      control: { type: 'check' },
      options: LAYERS.map(layer => layer.id),
      description:
        'The reliefs it merges, coarse to fine, as a `GeoRelief` merges its `layers`.',
      table: { category: 'Data' },
    },
    mode: {
      control: { type: 'inline-radio' },
      options: ['shaded', 'outline'],
      description:
        'SHADED: coloured by height and lit by the slope. OUTLINE: the coast and the contours as lines.',
      table: { category: 'Look' },
    },
    orientation: {
      control: { type: 'inline-radio' },
      options: ['north-up', 'heading-up'],
      description:
        'What points up the map: the scene’s north, or where the camera looks.',
      table: { category: 'Look' },
    },
    contours: {
      control: { type: 'boolean' },
      description: 'Contour lines, every 100 m.',
      table: { category: 'Look' },
    },
    center: {
      control: { type: 'inline-radio' },
      options: ['camera', 'target'],
      description:
        'What the map is centred on: the camera, or what it looks at (the controls’ target, at the sea’s level). The marker button toggles it.',
      table: { category: 'Look' },
    },
    projection: {
      control: { type: 'inline-radio' },
      options: [
        'scene',
        'web-mercator',
        'equal-earth',
        'lambert-conformal-conic',
        'auto',
      ],
      description:
        'What the map is drawn in: SCENE, the scene’s own map (UTM here); WEB-MERCATOR, EQUAL-EARTH or LAMBERT-CONFORMAL-CONIC (its standard parallels following the view), a projection about the meridian under the map’s middle; AUTO, the scene’s map up to the global extent below and the global projection past it. A change cross-fades. Zoom out to 5000 km or more to see a projection’s use.',
      table: { category: 'Projection' },
    },
    globalProjection: {
      control: { type: 'inline-radio' },
      options: ['web-mercator', 'equal-earth', 'lambert-conformal-conic'],
      description: 'AUTO: the projection past the global extent.',
      table: { category: 'Projection' },
    },
    globalFrom: {
      control: { type: 'range', min: 500000, max: 10000000, step: 100000 },
      description:
        'AUTO: the extent, metres across the shorter side, from which the global projection draws the map (back to the scene’s below 80 % of it).',
      table: { category: 'Projection' },
    },
    zoneOutline: {
      control: { type: 'boolean' },
      description:
        'The bounds of the scene’s UTM zone (31N here, 0–6°E), dashed, while the map is in the scene’s map: its meridians bend toward the pole as they lie in it.',
      table: { category: 'Projection' },
    },
    zoom: {
      control: { type: 'select' },
      options: [...ZOOM_OPTIONS],
      description:
        'AUTO follows the camera’s height over the sea (the map is 4 times as wide as the camera is high); the others are the levels, metres across the shorter side. The buttons and the wheel change it too.',
      table: { category: 'Zoom' },
    },
    autoZoomFactor: {
      control: { type: 'range', min: 1, max: 12, step: 0.5 },
      table: { category: 'Zoom' },
    },
    anchor: {
      control: { type: 'select' },
      options: ANCHORS,
      description: 'Where it sits in the overlay.',
      table: { category: 'Panel' },
    },
    width: {
      control: { type: 'range', min: 120, max: 600, step: 10 },
      description: 'The width it starts at; drag its edges to resize it.',
      table: { category: 'Panel' },
    },
    height: {
      control: { type: 'range', min: 120, max: 600, step: 10 },
      description: 'The height it starts at.',
      table: { category: 'Panel' },
    },
    resizable: {
      control: { type: 'boolean' },
      description:
        'Resized by dragging its edges and corner away from where it sits.',
      table: { category: 'Panel' },
    },
    closable: {
      control: { type: 'boolean' },
      description:
        'Its × closes it into a button where it sat, which opens it again: closed, the map is unmounted (its WebGL context given back), and keeps its size, zoom, orientation and centre.',
      table: { category: 'Panel' },
    },
    controlButtons: {
      control: { type: 'check' },
      options: MINIMAP_CONTROLS,
      description: 'The buttons shown, in this order.',
      table: { category: 'Panel' },
    },
    compass: {
      description:
        'The compass, which a click turns between north-up and heading-up.',
      table: { category: 'Panel' },
    },
    pan: {
      description:
        'Drag the map to look around (left button, or a finger); it eases back to its centre on release. The markers are taken first.',
      table: { category: 'Panel' },
    },
    altitudeReadout: {
      description:
        'The altitude readout: the height of what the map is centred on, as text.',
      table: { category: 'Panel' },
    },
    markers: {
      description:
        'Layers of its own: Volve, the trench and the coast as points.',
      table: { category: 'Layers' },
    },
    targetMarker: {
      description: 'A marker on the camera’s target.',
      table: { category: 'Layers' },
    },
    draggable: {
      description:
        'Drag the camera’s arrow or the target marker and drop them on the map to move the camera controls (the camera flies there with its target; the target re-aims the camera), at the heights they have. Drop outside the map, or press Escape, to cancel. Drops are logged to the console.',
      table: { category: 'Layers' },
    },
    dragControls: {
      description:
        'Whether a drop and the home button move the controls; off, a drop is only reported (`onMarkerDrop`).',
      table: { category: 'Layers' },
    },
    shape: {
      control: { type: 'inline-radio' },
      options: ['cone', 'circle', 'none'],
      description:
        'Round the camera’s arrow: its field of view as a CONE, or a CIRCLE, reaching as far as the scale bar measures (or the radius below).',
      table: { category: 'Layers' },
    },
    radiusMetres: {
      control: { type: 'range', min: 0, max: 500000, step: 500 },
      description:
        'The circle’s radius, or the cone’s reach, in metres; 0 for the scale bar’s length, which reads as the distance the bar shows at every zoom.',
      table: { category: 'Layers' },
    },
    markerColor: {
      control: { type: 'color' },
      description: 'The camera’s arrow and the target marker.',
      table: { category: 'Layers' },
    },
    shapeColor: {
      control: { type: 'color' },
      description: 'The cone or circle.',
      table: { category: 'Layers' },
    },
    altitudeGadget: {
      description:
        'The altitude control, a gadget of the overlay anchored to the 3D view: pull its knob up to climb, down to descend; let go and it springs back. Escape puts the height back.',
      table: { category: 'Altitude' },
    },
    altitudeMarker: {
      control: { type: 'inline-radio' },
      options: ['camera', 'target'],
      description:
        'Whose height it changes: the camera’s (its target comes along) or its target’s alone.',
      table: { category: 'Altitude' },
    },
    altitudeAnchor: {
      control: { type: 'select' },
      options: ANCHORS,
      table: { category: 'Altitude' },
    },
    altitudeMaxSpeed: {
      control: { type: 'range', min: 1, max: 1000, step: 1 },
      description:
        'Metres a second with the knob at the end of its travel: the knob sets the speed directly, growing with the square of how far it is from the middle.',
      table: { category: 'Altitude' },
    },
    altitudeBoost: {
      control: { type: 'range', min: 1, max: 1000, step: 1 },
      description:
        'How many times that speed it can accelerate to, held at the end of the travel. 1: no acceleration.',
      table: { category: 'Altitude' },
    },
    compassAnchor: {
      control: { type: 'select' },
      options: ANCHORS,
      description:
        'Layout: where each item sits on the map, a corner or the middle of an edge.',
      table: { category: 'Layout' },
    },
    readoutAnchor: {
      control: { type: 'select' },
      options: ANCHORS,
      table: { category: 'Layout' },
    },
    controlsAnchor: {
      control: { type: 'select' },
      options: ANCHORS,
      table: { category: 'Layout' },
    },
    controlsDirection: {
      control: { type: 'inline-radio' },
      options: ['column', 'row'],
      table: { category: 'Layout' },
    },
  },
  args: {
    layerIds: LAYERS.map(layer => layer.id),
    mode: 'shaded',
    orientation: 'north-up',
    center: 'camera',
    contours: false,
    projection: 'auto',
    globalProjection: 'web-mercator',
    globalFrom: 2000000,
    zoneOutline: true,
    zoom: 'auto',
    autoZoomFactor: 4,
    anchor: 'bottom-right',
    width: 240,
    height: 240,
    resizable: true,
    closable: true,
    controlButtons: MINIMAP_CONTROLS,
    compass: true,
    pan: true,
    altitudeReadout: true,
    markers: true,
    targetMarker: true,
    draggable: true,
    dragControls: true,
    shape: 'cone',
    radiusMetres: 0,
    markerColor: '#ffffff',
    shapeColor: '#ffffff',
    altitudeGadget: true,
    altitudeMarker: 'camera',
    altitudeAnchor: 'left-center',
    altitudeMaxSpeed: 100,
    altitudeBoost: 200,
    compassAnchor: 'top-left',
    readoutAnchor: 'top-center',
    controlsAnchor: 'top-right',
    controlsDirection: 'column',
  },
} satisfies Meta<typeof MinimapStory>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Default: Story = {};

/** The coast and the contours as lines, heading-up: the map turns with the camera. */
export const OutlineHeadingUp: Story = {
  args: { mode: 'outline', orientation: 'heading-up', contours: true },
};

/** From 400 km up: the adaptive zoom is at its widest, 1000 km across. */
export const FromHigh: Story = {
  parameters: { cameraPosition: [0, 400000, 1], cameraTarget: [0, 0, 0] },
};

/** Centred on what the camera looks at, with a circle round the camera as far as the scale bar measures. */
export const CentredOnTarget: Story = {
  args: { center: 'target', shape: 'circle' },
};

/** The camera under the sea, 300 m down: the altitude gadget reaches below the sea's level. */
export const Subsurface: Story = {
  parameters: {
    cameraPosition: [3000, -300, 3000],
    cameraTarget: [0, -100, 0],
  },
};

/** Larger, top left, and closed into its button to start with: open it, resize it, close it again. */
export const Closed: Story = {
  args: {
    anchor: 'top-left',
    width: 360,
    height: 280,
    defaultOpen: false,
  },
};
