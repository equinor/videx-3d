import type { Meta, StoryObj } from '@storybook/react-vite';
import { useFrame } from '@react-three/fiber';
import { useRef, useState } from 'react';
import { Vector3 } from 'three';
import { anchorStack, anchorStyle } from '../../../common/anchor';
import { geoFrameLonLat } from '../../../sdk/projection/geo-frame';
import { readCameraTarget } from '../../../sdk/utils/camera';
import { SCENERY_DEMO_RELIEF_LAYERS } from '../../../storybook/components/scenery-controls';
import { demoFrame } from '../../../storybook/data/demo-crs';
import { Canvas3dDecorator } from '../../../storybook/decorators/canvas-3d-decorator';
import { DataProviderDecorator } from '../../../storybook/decorators/data-provider-decorator';
import { GeneratorsProviderDecorator } from '../../../storybook/decorators/generators-provider-decorator';
import { SceneryGenerators } from '../../../storybook/decorators/scenery-generators';
import storyArgs from '../../../storybook/story-args.json';
import { GeoGraticule } from '../../Layers/GeoGraticule';
import { GeoRelief } from '../../Layers/GeoRelief';
import { Scenery } from '../../Scenery/Scenery';
import { SceneryOcean } from '../../Scenery/SceneryOcean';
import { SceneryStage } from '../../Scenery/SceneryStage';
import { World } from '../../World/World';
import { AltitudeControl } from '../AltitudeControl/AltitudeControl';
import { CanvasHtml } from '../CanvasHtml/CanvasHtml';
import { GeoMap } from '../GeoMap/GeoMap';
import { GeoMapCamera } from '../GeoMap/GeoMapCamera';
import { GeoMapIcon } from '../GeoMap/GeoMapIcons';
import {
  GeoMapCameraMarker,
  GeoMapTargetMarker,
} from '../GeoMap/GeoMapMarkers';
import { GeoMapFields } from '../GeoMap/layers/GeoMapFields';
import { GeoMapGraticule } from '../GeoMap/layers/GeoMapGraticule';
import { formatHudDistance, HUD_LABEL, setHudText } from '../hud';
import { Minimap } from '../Minimap/Minimap';
import { Panel } from '../Panel/Panel';
import { WellMap } from '../WellMap/WellMap';
import { Overlay, type OverlayProps } from './Overlay';
import { OverlayButton } from './OverlayButton';
import { OverlayItem } from './OverlayItem';

// The gadgets over a 3D view, organised by an Overlay: a well map in a sidebar docked on the
// left, the altitude control at the middle of the left edge beside it, a minimap bottom right,
// and top right a toolbar whose button opens a map filling the space between the docks, which
// shows, and can move, the camera.

const LEVEL = 0;
const DEPTH = 100;
const CENTER = geoFrameLonLat(demoFrame)(0, 0);
const STAGE_BOUNDS: [number, number, number, number] = [
  -8000, -8000, 8000, 8000,
];

type OverlayArgs = Pick<OverlayProps, 'inset' | 'gap'> & {
  minimap: boolean;
  altitude: boolean;
  wellMap: boolean;
};

const OverlayStory = ({ minimap, altitude, wellMap, ...args }: OverlayArgs) => {
  const [fullMap, setFullMap] = useState(false);
  const layers = SCENERY_DEMO_RELIEF_LAYERS;
  return (
    <World frame={demoFrame} boundary={STAGE_BOUNDS}>
      <SceneryGenerators>
        <Scenery>
          <SceneryOcean level={LEVEL} depth={DEPTH} />
          <SceneryStage />
        </Scenery>
        <GeoRelief layers={layers} depth={DEPTH} color={{ ramp: 'terrain' }} />
        <Overlay {...args}>
          <OverlayItem anchor="top-right" id="toolbar">
            <OverlayButton
              title={fullMap ? 'Back to the 3D view' : 'A map over the view'}
              active={fullMap}
              onClick={() => setFullMap(was => !was)}
            >
              <GeoMapIcon />
            </OverlayButton>
          </OverlayItem>
          {fullMap && (
            <OverlayItem anchor="fill" id="full-map">
              {/* The World's map: the camera on it, the fields, the graticule. */}
              <GeoMap
                layers={layers}
                depth={DEPTH}
                defaultView={{ center: CENTER, extent: 120000 }}
                background="rgba(8, 16, 24, 0.85)"
              >
                <GeoMapGraticule latLon labels />
                <GeoMapFields />
                <GeoMapCamera level={LEVEL}>
                  <GeoMapTargetMarker />
                  <GeoMapCameraMarker />
                </GeoMapCamera>
              </GeoMap>
            </OverlayItem>
          )}
          {minimap && !fullMap && (
            <Minimap
              anchor="bottom-right"
              id="minimap"
              layers={layers}
              depth={DEPTH}
              level={LEVEL}
            >
              <GeoMapFields />
              <GeoMapTargetMarker />
              <GeoMapCameraMarker />
            </Minimap>
          )}
          {altitude && (
            <AltitudeControl anchor="left-center" id="altitude" level={LEVEL} />
          )}
          {wellMap && (
            <Panel
              anchor="left"
              id="well-map"
              width={240}
              resizable
              closable
              collapsed={{ title: 'Show the well map' }}
              padding={6}
            >
              <WellMap wellIdentifier={storyArgs.defaultWell} />
            </Panel>
          )}
        </Overlay>
      </SceneryGenerators>
    </World>
  );
};

// The same gadgets without an Overlay: a layout of the story's own on a CanvasHtml, placed
// with the anchor helpers. Bottom left the minimap, inline in a row with the altitude control
// (resized from its free edges, closed into its button where it was); top right a toolbar
// and a readout of the camera's distance in the gadgets' look.
const OwnLayoutStory = ({
  minimap,
  altitude,
  inset = 10,
  gap = 8,
}: OverlayArgs) => {
  const [graticule, setGraticule] = useState(false);
  const layers = SCENERY_DEMO_RELIEF_LAYERS;
  return (
    <World frame={demoFrame} boundary={STAGE_BOUNDS}>
      <SceneryGenerators>
        <Scenery>
          <SceneryOcean level={LEVEL} depth={DEPTH} />
          <SceneryStage />
          {graticule && <GeoGraticule latLon labels />}
        </Scenery>
        <GeoRelief layers={layers} depth={DEPTH} color={{ ramp: 'terrain' }} />
        <CanvasHtml>
          <div
            style={{
              position: 'absolute',
              ...anchorStyle('top-right', inset),
              display: 'flex',
              ...anchorStack('top-right', 'row'),
              alignItems: 'center',
              gap,
            }}
          >
            <OverlayButton
              title={graticule ? 'Hide the graticule' : 'Show the graticule'}
              active={graticule}
              onClick={() => setGraticule(was => !was)}
            >
              #
            </OverlayButton>
            <CameraDistance />
          </div>
          <div
            style={{
              position: 'absolute',
              ...anchorStyle('bottom-left', inset),
              display: 'flex',
              ...anchorStack('bottom-left', 'row'),
              gap,
            }}
          >
            {minimap && (
              <Minimap
                inline
                origin="bottom-left"
                layers={layers}
                depth={DEPTH}
                level={LEVEL}
              >
                {graticule && <GeoMapGraticule latLon labels />}
                <GeoMapFields />
                <GeoMapTargetMarker />
                <GeoMapCameraMarker />
              </Minimap>
            )}
            {altitude && <AltitudeControl level={LEVEL} />}
          </div>
        </CanvasHtml>
      </SceneryGenerators>
    </World>
  );
};

const cameraTarget = new Vector3();

// The camera's distance to what it looks at, written per frame without a render: R3F's
// useFrame works in a CanvasHtml, bridged.
const CameraDistance = () => {
  const label = useRef<HTMLSpanElement>(null);
  useFrame(({ camera, controls }) => {
    setHudText(
      label.current,
      readCameraTarget(controls, cameraTarget)
        ? formatHudDistance(camera.position.distanceTo(cameraTarget))
        : '–',
    );
  });
  return <span ref={label} style={HUD_LABEL} />;
};

const meta = {
  title: 'Components/Html/Overlay',
  component: OverlayStory,
  decorators: [
    Canvas3dDecorator,
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
    minimap: {
      description:
        'A `Minimap` bottom right: drag its top and left edges to resize it, its × to close it into a button.',
    },
    altitude: {
      description:
        'The `AltitudeControl` gadget on the left edge of the view: pull its knob up to climb, down to descend.',
    },
    wellMap: {
      description:
        'A `WellMap` in a sidebar: a `Panel` docked `left`, the full height of the view, resized by its inner edge and closable. It sees the data, bridged into the overlay.',
    },
    inset: {
      control: { type: 'range', min: 0, max: 40, step: 1 },
      description: 'Pixels between the view’s edges and the items.',
    },
    gap: {
      control: { type: 'range', min: 0, max: 24, step: 1 },
      description: 'Pixels between the items at one anchor.',
    },
  },
  args: {
    minimap: true,
    altitude: true,
    wellMap: true,
    inset: 10,
    gap: 8,
  },
} satisfies Meta<typeof OverlayStory>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Default: Story = {};

/**
 * No `Overlay`: the gadgets in a layout of your own on a `CanvasHtml`, placed with
 * `anchorStyle` and `anchorStack`, the minimap `inline`, a toolbar of `OverlayButton`s and a
 * readout with the HUD helpers.
 */
export const OwnLayout: Story = {
  render: args => <OwnLayoutStory {...args} />,
  argTypes: {
    wellMap: { table: { disable: true } },
    minimap: {
      description:
        'A `Minimap` `inline` in a row with the altitude control: drag its top and right edges to resize it, its × to close it into a button where it was.',
    },
  },
};
