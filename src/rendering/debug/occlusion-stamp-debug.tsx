import { CameraControls } from '@react-three/drei';
import { Canvas, useThree } from '@react-three/fiber';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Color, DoubleSide, MeshStandardMaterial } from 'three';
import { Annotations } from '../../components/Annotations/Annotations';
import {
  useAnnotations,
  useAnnotationsState,
} from '../../components/Annotations/annotations-state';
import { AnnotationsLayer } from '../../components/Annotations/AnnotationsLayer';
import { CameraManager } from '../../sdk/managers/CameraManager';
import type { Vec3 } from '../../sdk/types/common';
import { profileFrames } from '../../storybook/debug/profile';
import {
  getStoryArgs,
  registerVidex3d,
  sceneBounds,
  setStoryArgs,
  waitForStableScene,
} from '../../storybook/debug/videx3d';
import { makeOitCompatible } from '../oit-material';
import type { Pass } from '../Pass';
import { AnnotationsPass } from '../passes/AnnotationsPass';
import { OITRenderPass } from '../passes/OITRenderPass';
import { OutputPass } from '../passes/OutputPass';
import { RenderPass } from '../passes/RenderPass';
import { RenderingPipeline } from '../RenderingPipeline';

/**
 * The OIT occlusion stamp (`OITRenderPass.occlusionDepthStamp`) on a scene small enough to
 * judge by eye: two see-through panels, an opaque block, and five annotations at known places
 * among them. A readout lists, per annotation, whether it should be hidden for the controls as
 * set, and whether the anchor test hid it.
 */
export type OcclusionStampArgs = {
  /** `oit`: OITRenderPass; `default`: RenderPass, where the panels write depth as three draws them */
  pipeline: 'oit' | 'default';
  stamp: boolean;
  threshold: number;
  frontOpacity: number;
  backOpacity: number;
  /** the stamp as a geometry pass of its own: the min-depth pass that otherwise carries it is off */
  skipFront: boolean;
  slices: 0 | 2 | 3;
  depthBuffer: 'log' | 'linear';
  antialias: 'none' | 'taa';
  debugTargets: boolean;
  profile: boolean;
};

/** One annotation's row in the readout. */
export type OcclusionStampRow = {
  id: string;
  name: string;
  expectedHidden: boolean;
  /** the anchor test's answer; null before its first */
  occluded: boolean | null;
};

/** The story's script handle (`window.videx3d.occlusionStamp`). */
export type OcclusionStampHandle = {
  /** the live OITRenderPass, null with the default pipeline */
  pass: () => OITRenderPass | null;
  report: () => {
    rows: OcclusionStampRow[];
    /** every row as expected */
    ok: boolean;
    /** GPU ms with `profile`: the min-depth pass and the stamp (-1 until measured) */
    timings: { minDepth: number; occlusion: number } | null;
  };
};

const LAYER = 'occlusion-stamp';
const SCOPE = 'labels';
const BACKGROUND = '#101014';

// The panels face the camera across x -1..3, y 0..3: the front one at z 2, the back one at 0.
const PANEL_SIZE: [number, number] = [4, 3];
const PANEL_CENTER_X = 1;
const FRONT_Z = 2;
const BACK_Z = 0;

type StampLabel = {
  id: string;
  name: string;
  position: Vec3;
  /** what lies between it and the default camera */
  behind: ('front' | 'back' | 'block')[];
};

const LABELS: StampLabel[] = [
  { id: 'a', name: 'A · in front', position: [0, 1.5, 3], behind: [] },
  {
    id: 'b',
    name: 'B · between the panels',
    position: [1, 1.5, 1],
    behind: ['front'],
  },
  {
    id: 'c',
    name: 'C · behind both',
    position: [2, 1.5, -1],
    behind: ['front', 'back'],
  },
  {
    id: 'd',
    name: 'D · behind the block',
    position: [-3, 1, -2.5],
    behind: ['block'],
  },
  {
    id: 'e',
    name: 'E · nothing in front',
    position: [4.5, 1.5, -1],
    behind: [],
  },
];

// Whether what lies in front of `label` hides it: the block always; a panel as three draws
// it (writing depth) with the default pipeline; through OIT, at full opacity (drawn opaque) or
// where the stamp takes it. A panel at opacity 0 is not drawn.
function expectedHidden(label: StampLabel, args: OcclusionStampArgs) {
  return label.behind.some(what => {
    if (what === 'block') return true;
    const opacity = what === 'front' ? args.frontOpacity : args.backOpacity;
    if (opacity <= 0) return false;
    if (args.pipeline === 'default') return true;
    return opacity >= 1 || (args.stamp && opacity >= args.threshold);
  });
}

function stampReport(args: OcclusionStampArgs, pass: OITRenderPass | null) {
  const instances = new Map(
    useAnnotationsState
      .getState()
      .instances.filter(i => i.layer.id === LAYER)
      .map(i => [i.id, i]),
  );
  const rows = LABELS.map(label => {
    // As the annotations' state names its instances.
    const instance = instances.get(`${LAYER}_${SCOPE}_${label.id}`);
    return {
      id: label.id,
      name: label.name,
      expectedHidden: expectedHidden(label, args),
      occluded: instance?.state.inViewSpace ? !!instance.state.occluded : null,
    };
  });
  return {
    rows,
    ok: rows.every(r => r.occluded === r.expectedHidden),
    timings:
      pass && args.profile
        ? {
            minDepth: pass.timings.minDepth,
            occlusion: pass.timings.occlusion,
          }
        : null,
  };
}

const Panel = ({
  z,
  color,
  opacity,
}: {
  z: number;
  color: string;
  opacity: number;
}) => {
  const material = useMemo(
    () =>
      makeOitCompatible(
        new MeshStandardMaterial({
          color,
          transparent: true,
          side: DoubleSide,
          toneMapped: false,
        }),
        { side: DoubleSide },
      ),
    [color],
  );
  useEffect(() => {
    material.opacity = opacity;
  }, [material, opacity]);
  useEffect(() => () => material.dispose(), [material]);
  return (
    <mesh position={[PANEL_CENTER_X, PANEL_SIZE[1] / 2, z]} material={material}>
      <planeGeometry args={PANEL_SIZE} />
    </mesh>
  );
};

const Labels = () => {
  const { addAnnotations } = useAnnotations(LAYER, SCOPE);
  useEffect(
    () =>
      addAnnotations(
        LABELS.map(({ id, name, position }) => ({ id, name, position })),
      ),
    [addAnnotations],
  );
  // Each label's place marked, smaller than its anchor's pull toward the camera
  // (`anchorOcclusionRadius`), so the mark does not hide its own label.
  return (
    <>
      {LABELS.map(label => (
        <mesh key={label.id} position={label.position}>
          <sphereGeometry args={[0.04, 16, 8]} />
          <meshBasicMaterial color="#ffd54f" />
        </mesh>
      ))}
    </>
  );
};

const StampScene = ({
  args,
  manager,
  onPass,
}: {
  args: OcclusionStampArgs;
  manager: CameraManager;
  onPass: (pass: OITRenderPass | null) => void;
}) => {
  const scene = useThree(state => state.scene);
  const camera = useThree(state => state.camera);
  const clock = useThree(state => state.clock);
  const pointer = useThree(state => state.pointer);
  const gl = useThree(state => state.gl);

  const passes = useMemo<Pass[]>(() => {
    const base =
      args.pipeline === 'oit'
        ? new OITRenderPass(scene, camera)
        : new RenderPass(scene, camera);
    base.clearColor = new Color(BACKGROUND);
    return [
      base,
      new AnnotationsPass(camera, clock, pointer, 50),
      new OutputPass(),
    ];
  }, [scene, camera, clock, pointer, args.pipeline]);
  const oit = passes[0] instanceof OITRenderPass ? passes[0] : null;

  useEffect(() => {
    if (!oit) return;
    oit.occlusionDepthStamp = args.stamp;
    oit.occlusionDepthThreshold = args.threshold;
    oit.skipFront = args.skipFront;
    oit.tailSlices = args.slices;
    oit.antialias = args.antialias;
    oit.debugTargets = args.debugTargets;
    oit.profile = args.profile;
  }, [
    oit,
    args.stamp,
    args.threshold,
    args.skipFront,
    args.slices,
    args.antialias,
    args.debugTargets,
    args.profile,
  ]);

  useEffect(() => onPass(oit), [oit, onPass]);

  const latest = useRef({ args, oit });
  latest.current = { args, oit };
  useEffect(
    () =>
      registerVidex3d({
        camera: manager,
        scene,
        ready: options => waitForStableScene(scene, options),
        bounds: () => sceneBounds(scene),
        setArgs: setStoryArgs,
        getArgs: getStoryArgs,
        profile: options => profileFrames(gl, scene, options),
        occlusionStamp: {
          pass: () => latest.current.oit,
          report: () => stampReport(latest.current.args, latest.current.oit),
        },
      }),
    [scene, gl, manager],
  );

  return (
    <>
      <RenderingPipeline passes={passes} />
      <ambientLight intensity={0.6} />
      <directionalLight position={[3, 6, 5]} intensity={1.4} />
      <mesh rotation={[-Math.PI / 2, 0, 0]}>
        <planeGeometry args={[20, 20]} />
        <meshStandardMaterial color="#3a3f47" />
      </mesh>
      <mesh position={[-2.6, 1, -1]}>
        <boxGeometry args={[1.2, 2, 1.2]} />
        <meshStandardMaterial color="#8a8f98" />
      </mesh>
      <Panel z={FRONT_Z} color="#3d7bd6" opacity={args.frontOpacity} />
      <Panel z={BACK_Z} color="#e0913a" opacity={args.backOpacity} />
      <Annotations maxVisible={50} autoUpdate={false}>
        <AnnotationsLayer
          id={LAYER}
          name="Occlusion stamp"
          anchorSize={5}
          anchorColor="#ffd54f"
          anchorOcclusionRadius={0.15}
          minDistance={0}
          maxDistance={1000}
          labelOffset={40}
        />
      </Annotations>
      <Labels />
    </>
  );
};

const READOUT_STYLE: React.CSSProperties = {
  position: 'absolute',
  top: 8,
  left: 8,
  zIndex: 2,
  padding: '6px 10px',
  font: '12px monospace',
  lineHeight: 1.6,
  color: '#e0e0e0',
  background: 'rgba(0,0,0,0.6)',
  pointerEvents: 'none',
};

const Readout = ({
  args,
  pass,
}: {
  args: OcclusionStampArgs;
  pass: OITRenderPass | null;
}) => {
  const [report, setReport] = useState(() => stampReport(args, pass));
  useEffect(() => {
    const update = () => setReport(stampReport(args, pass));
    update();
    const timer = setInterval(update, 250);
    return () => clearInterval(timer);
  }, [args, pass]);
  const mode =
    args.pipeline !== 'oit' || !args.stamp
      ? 'off'
      : args.skipFront
        ? 'a pass of its own'
        : 'carried by the min-depth pass';
  return (
    <div style={READOUT_STYLE}>
      <div style={{ fontWeight: 'bold' }}>
        stamp: {mode}
        {report.timings &&
          ` · min-depth ${report.timings.minDepth.toFixed(2)} ms · stamp ${report.timings.occlusion.toFixed(2)} ms`}
      </div>
      {report.rows.map(row => {
        const measured =
          row.occluded === null ? '…' : row.occluded ? 'hidden' : 'shown';
        const expected = row.expectedHidden ? 'hidden' : 'shown';
        const ok = row.occluded === null || row.occluded === row.expectedHidden;
        return (
          <div key={row.id} style={{ color: ok ? undefined : '#ff6b6b' }}>
            {row.name}: {measured}
            {!ok && ` (expected ${expected})`}
          </div>
        );
      })}
    </div>
  );
};

/** The story: its own canvas, remounted when the depth buffer changes (a construction flag). */
export const OcclusionStampStory = (args: OcclusionStampArgs) => {
  const [manager] = useState(() => new CameraManager());
  const [pass, setPass] = useState<OITRenderPass | null>(null);
  useEffect(() => () => manager.dispose(), [manager]);
  const initControls = useCallback(
    (controls: CameraControls | null) => {
      manager.setControls(controls);
      if (controls) manager.setTarget([0.5, 1.2, 0]);
    },
    [manager],
  );
  return (
    <div style={{ position: 'absolute', inset: 0, background: BACKGROUND }}>
      <Readout args={args} pass={pass} />
      <Canvas
        key={args.depthBuffer}
        camera={{ near: 0.1, far: 200, position: [0.5, 2.5, 10], fov: 50 }}
        flat
        gl={{
          logarithmicDepthBuffer: args.depthBuffer === 'log',
          antialias: false,
        }}
      >
        <StampScene args={args} manager={manager} onPass={setPass} />
        <CameraControls ref={initControls} makeDefault />
      </Canvas>
    </div>
  );
};

export const OCCLUSION_STAMP_ARGS: OcclusionStampArgs = {
  pipeline: 'oit',
  stamp: true,
  threshold: 0.5,
  frontOpacity: 0.6,
  backOpacity: 0.3,
  skipFront: false,
  slices: 0,
  depthBuffer: 'log',
  antialias: 'none',
  debugTargets: false,
  profile: false,
};

export const OCCLUSION_STAMP_ARG_TYPES = {
  pipeline: {
    control: 'inline-radio',
    options: ['oit', 'default'],
    description:
      '`oit`: OITRenderPass. `default`: RenderPass, the reference: the panels write depth as three draws them, so they hide what lies behind at any opacity.',
    table: { category: 'Pipeline' },
  },
  depthBuffer: {
    control: 'inline-radio',
    options: ['log', 'linear'],
    description:
      'The renderer’s depth buffer: the stamp writes depth in its encoding. Remounts the canvas.',
    table: { category: 'Pipeline' },
  },
  antialias: {
    control: 'inline-radio',
    options: ['none', 'taa'],
    if: { arg: 'pipeline', eq: 'oit' },
    table: { category: 'Pipeline' },
  },
  stamp: {
    control: 'boolean',
    description:
      '`occlusionDepthStamp`: transparent surfaces whose alpha clears the threshold hide the annotations behind them.',
    if: { arg: 'pipeline', eq: 'oit' },
    table: { category: 'Stamp' },
  },
  threshold: {
    control: { type: 'range', min: 0, max: 1, step: 0.05 },
    description: '`occlusionDepthThreshold`.',
    if: { arg: 'stamp' },
    table: { category: 'Stamp' },
  },
  skipFront: {
    control: 'boolean',
    description:
      '`skipFront`: no min-depth pass, so the stamp draws the transparent geometry in a pass of its own (as it did before it rode along with that pass).',
    if: { arg: 'stamp' },
    table: { category: 'Stamp' },
  },
  slices: {
    control: 'inline-radio',
    options: [0, 2, 3],
    description:
      '`tailSlices`: with slices the min-depth target holds four channels, the stamp’s occluders in the third.',
    if: { arg: 'pipeline', eq: 'oit' },
    table: { category: 'Stamp' },
  },
  frontOpacity: {
    control: { type: 'range', min: 0, max: 1, step: 0.05 },
    table: { category: 'Scene' },
  },
  backOpacity: {
    control: { type: 'range', min: 0, max: 1, step: 0.05 },
    table: { category: 'Scene' },
  },
  debugTargets: {
    control: 'boolean',
    description:
      '`debugTargets`: thumbnails of the min-depth target, the stamp’s occluders (while the min-depth pass carries it) and the tail.',
    if: { arg: 'pipeline', eq: 'oit' },
    table: { category: 'Debug' },
  },
  profile: {
    control: 'boolean',
    description:
      'GPU timings of the min-depth pass and the stamp, in the readout.',
    if: { arg: 'pipeline', eq: 'oit' },
    table: { category: 'Debug' },
  },
} as const;
