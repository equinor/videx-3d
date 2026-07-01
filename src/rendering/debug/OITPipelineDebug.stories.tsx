import { CameraControls } from '@react-three/drei';
import { Canvas, useFrame, useThree } from '@react-three/fiber';
import type { Meta, StoryObj } from '@storybook/react-vite';
import { useEffect, useMemo, useRef, useState } from 'react';
import {
  ACESFilmicToneMapping,
  AgXToneMapping,
  BufferAttribute,
  BufferGeometry,
  CineonToneMapping,
  Color,
  DoubleSide,
  LineBasicMaterial,
  LinearSRGBColorSpace,
  Mesh,
  MeshStandardMaterial,
  NeutralToneMapping,
  NoToneMapping,
  ReinhardToneMapping,
  SRGBColorSpace,
  Line as ThreeLine,
  ToneMapping,
  Vector2,
} from 'three';
import { OITRenderPass, Pass, RenderPass } from '../../main.ts';
import { makeOitCompatible } from '../oit-material.ts';
import { FXAAPass } from '../passes/FXAAPass.ts';
import { OutputPass } from '../passes/OutputPass.ts';
import { RenderingPipeline } from '../RenderingPipeline.tsx';
import { DebugBoxOutputPass } from './DebugBoxOutputPass.ts';
import { DebugPattern, DebugPatternPass } from './DebugPatternPass.ts';

/**
 * Standalone pipeline debug harness for the OIT / rendering pipeline.
 *
 * It deliberately does NOT use the shared Canvas3dDecorator: it mounts its own
 * canvas(es) so the renderer construction flags and per-frame state that the
 * decorator hard-codes become test variables — logarithmic depth buffer (a
 * construction-time flag, hence the optional side-by-side canvases), tone mapping
 * and output colour space. It also carries no data dependencies, so it isolates
 * the pipeline from the scene/data providers entirely.
 */

const TONE_MAPPING: Record<string, ToneMapping> = {
  none: NoToneMapping,
  aces: ACESFilmicToneMapping,
  agx: AgXToneMapping,
  neutral: NeutralToneMapping,
  reinhard: ReinhardToneMapping,
  cineon: CineonToneMapping,
};

type DebugArgs = {
  debugPattern: 'off' | DebugPattern;
  patternScale: number;
  geometry:
  | 'torusKnot'
  | 'thinBars'
  | 'lines'
  | 'thinBars-transparent'
  | 'lines-transparent';
  animate: boolean;
  supersample: 0.5 | 1 | 1.5 | 2 | 4;
  downsampleMode: 'mipmap' | 'box';
  oitEnabled: boolean;
  oitMaterials: boolean;
  aaMode: 'none' | 'fxaa' | 'smaa' | 'temporal' | 'temporal-smaa' | 'taa';
  temporalClampStrength: number;
  taaRestClampStrength: number;
  taaRestBoxGamma: number;
  taaRestNeighbourhoodRadius: number;
  toneMapping: keyof typeof TONE_MAPPING;
  outputColorSpace: 'srgb' | 'linear';
  background: string;
  transparentBackground: boolean;
  dpr: 1 | 1.5 | 2;
  layout: 'single' | 'sideBySide';
  logDepth: boolean;
  showDebugTargets: boolean;
  measureAA: boolean;
};

// Checkerboard shown *behind* the (CSS-transparent) canvas so a transparent
// clear (alpha 0) is actually visible — it reveals how the premultiplied-alpha
// OutputPass composites the pipeline result over the page, including any edge
// fringing on transparent silhouettes.
const CHECKER_BG: React.CSSProperties = {
  backgroundColor: '#1b1b20',
  backgroundImage:
    'linear-gradient(45deg, #2f2f37 25%, transparent 25%),' +
    'linear-gradient(-45deg, #2f2f37 25%, transparent 25%),' +
    'linear-gradient(45deg, transparent 75%, #2f2f37 75%),' +
    'linear-gradient(-45deg, transparent 75%, #2f2f37 75%)',
  backgroundSize: '24px 24px',
  backgroundPosition: '0 0, 0 12px, 12px -12px, -12px 0',
};

/** Color palette for line pairs (4 distinct colors for 4 pairs). */
const LINE_PAIR_COLORS = ['#ff6b6b', '#4ecdc4', '#ffa726', '#66bb6a'];

function getLineColor(index: number): string {
  const pairIndex = Math.floor(index / 2);
  return LINE_PAIR_COLORS[pairIndex % LINE_PAIR_COLORS.length];
}

/** WebGL Line rendering helper - creates actual Three.js line primitives. */
const WebGLLine = ({
  position,
  color,
  oitMaterials,
}: {
  position: [number, number, number];
  color: string;
  oitMaterials: boolean;
}) => {
  const group = useRef<Mesh>(null);

  useEffect(() => {
    if (!group.current) return;
    const geometry = new BufferGeometry();
    geometry.setAttribute(
      'position',
      new BufferAttribute(new Float32Array([0, -1.5, 0, 0, 1.5, 0]), 3),
    );
    const material = new LineBasicMaterial({
      color,
      linewidth: 2,
      toneMapped: false,
    });
    if (oitMaterials) makeOitCompatible(material);
    const line = new ThreeLine(geometry, material);
    line.position.set(...position);
    group.current.add(line);
    return () => {
      group.current?.remove(line);
      geometry.dispose();
      material.dispose();
    };
  }, [position, color, oitMaterials]);

  return <group ref={group} />;
};

/**
 * A stock `MeshStandardMaterial` that renders linear (tone mapping is applied once,
 * later, by the OutputPass) and — when `oit` is set — is made OIT-capable at
 * creation via {@link makeOitCompatible}. Patching at construction (rather than in a
 * post-mount effect) guarantees the material is already OIT-capable the first time
 * the OITRenderPass classifies it, and toggling `oit` builds a fresh material whose
 * new identity forces the pass to re-classify it.
 */
const OitStandardMaterial = ({
  oit,
  color,
  metalness,
  roughness,
  transparent,
  opacity,
  depthWrite,
  side,
}: {
  oit: boolean;
  color: string;
  metalness?: number;
  roughness?: number;
  transparent?: boolean;
  opacity?: number;
  depthWrite?: boolean;
  side?: MeshStandardMaterial['side'];
}) => {
  const material = useMemo(() => {
    const m = new MeshStandardMaterial({
      color,
      metalness,
      roughness,
      transparent,
      opacity,
      depthWrite,
      toneMapped: false,
    });
    if (side !== undefined) m.side = side;
    if (oit) makeOitCompatible(m, side !== undefined ? { side } : {});
    return m;
  }, [
    oit,
    color,
    metalness,
    roughness,
    transparent,
    opacity,
    depthWrite,
    side,
  ]);

  useEffect(() => () => material.dispose(), [material]);

  return <primitive key={material.uuid} object={material} attach="material" />;
};

/**
 * A small stack of mutually overlapping, semi-transparent surfaces at different
 * depths, orientations and colours — the case OIT actually exists to resolve
 * (several transparent layers with no single correct back-to-front order). Stands
 * in for the app's stacked depth surfaces / seismic fences. Double-sided so every
 * layer stays visible from any orbit angle.
 */
const TransparentLayers = ({ oit }: { oit: boolean }) => (
  <group>
    <mesh position={[0, 0, 0]}>
      <planeGeometry args={[4, 6]} />
      <OitStandardMaterial
        oit={oit}
        color="#3d7bd6"
        transparent
        opacity={0.35}
        depthWrite={false}
        side={DoubleSide}
      />
    </mesh>
    <mesh position={[0, 0, 0.7]} rotation={[0, Math.PI / 5, 0]}>
      <planeGeometry args={[4, 6]} />
      <OitStandardMaterial
        oit={oit}
        color="#4ecdb0"
        transparent
        opacity={0.3}
        depthWrite={false}
        side={DoubleSide}
      />
    </mesh>
    <mesh position={[0, 0, -0.7]} rotation={[Math.PI / 2.6, 0, 0]}>
      <planeGeometry args={[4, 6]} />
      <OitStandardMaterial
        oit={oit}
        color="#ffb74d"
        transparent
        opacity={0.3}
        depthWrite={false}
        side={DoubleSide}
      />
    </mesh>
  </group>
);

/** Opaque high-frequency silhouettes + overlapping transparent layers (for OIT). */
const TestGeometry = ({
  geometry,
  animate,
  oitMaterials,
}: {
  geometry: DebugArgs['geometry'];
  animate: boolean;
  oitMaterials: boolean;
}) => {
  const spinRef = useRef<Mesh>(null);

  useFrame((_, delta) => {
    if (animate && spinRef.current) spinRef.current.rotation.y += delta * 0.15;
  });

  if (geometry === 'thinBars') {
    return (
      <group ref={spinRef}>
        {Array.from({ length: 12 }, (_, i) => (
          <mesh
            key={i}
            position={[0, (i - 5.5) * 0.22, 0]}
            rotation={[0, 0, (i - 5.5) * 0.04]}
          >
            <boxGeometry args={[3, 0.03, 0.4]} />
            <OitStandardMaterial
              oit={oitMaterials}
              color={i % 2 ? '#e0e0e0' : '#9aa4b2'}
              metalness={0.1}
              roughness={0.6}
            />
          </mesh>
        ))}
      </group>
    );
  }

  if (geometry === 'thinBars-transparent') {
    return (
      <group ref={spinRef}>
        {Array.from({ length: 12 }, (_, i) => (
          <mesh
            key={i}
            position={[0, (i - 5.5) * 0.22, 0]}
            rotation={[0, 0, (i - 5.5) * 0.04]}
          >
            <boxGeometry args={[3, 0.03, 0.4]} />
            <OitStandardMaterial
              oit={oitMaterials}
              color={i % 2 ? '#e0e0e0' : '#9aa4b2'}
              metalness={0.1}
              roughness={0.6}
            />
          </mesh>
        ))}
        <TransparentLayers oit={oitMaterials} />
      </group>
    );
  }

  if (geometry === 'lines') {
    return (
      <group ref={spinRef}>
        {Array.from({ length: 8 }, (_, i) => {
          const angle = (i / 8) * Math.PI * 2;
          const x = Math.cos(angle) * 1.5;
          const z = Math.sin(angle) * 1.5;
          // Alternate between WebGL lines and cylinders
          const useWebGLLine = i % 2 === 0;
          if (useWebGLLine) {
            return (
              <WebGLLine
                key={i}
                position={[x, 0, z]}
                color={getLineColor(i)}
                oitMaterials={oitMaterials}
              />
            );
          } else {
            return (
              <mesh key={i} position={[x, 0, z]}>
                <cylinderGeometry args={[0.04, 0.04, 3, 8]} />
                <OitStandardMaterial
                  oit={oitMaterials}
                  color={getLineColor(i)}
                />
              </mesh>
            );
          }
        })}
      </group>
    );
  }

  if (geometry === 'lines-transparent') {
    return (
      <group ref={spinRef}>
        {Array.from({ length: 8 }, (_, i) => {
          const angle = (i / 8) * Math.PI * 2;
          const x = Math.cos(angle) * 1.5;
          const z = Math.sin(angle) * 1.5;
          // Alternate between WebGL lines and cylinders
          const useWebGLLine = i % 2 === 0;
          if (useWebGLLine) {
            return (
              <WebGLLine
                key={i}
                position={[x, 0, z]}
                color={getLineColor(i)}
                oitMaterials={oitMaterials}
              />
            );
          } else {
            return (
              <mesh key={i} position={[x, 0, z]}>
                <cylinderGeometry args={[0.04, 0.04, 3, 8]} />
                <OitStandardMaterial
                  oit={oitMaterials}
                  color={getLineColor(i)}
                />
              </mesh>
            );
          }
        })}
        <TransparentLayers oit={oitMaterials} />
      </group>
    );
  }

  return (
    <group>
      <mesh ref={spinRef}>
        <torusKnotGeometry args={[1, 0.28, 220, 32]} />
        <OitStandardMaterial
          oit={oitMaterials}
          color="#c94f4f"
          metalness={0.2}
          roughness={0.4}
        />
      </mesh>
      <mesh position={[0, 0, 0]}>
        <sphereGeometry args={[1.7, 48, 48]} />
        <OitStandardMaterial
          oit={oitMaterials}
          color="#3d7bd6"
          transparent
          opacity={0.35}
          depthWrite={false}
          side={DoubleSide}
        />
      </mesh>
      <mesh position={[0, 0, 0]}>
        <sphereGeometry args={[1.2, 48, 48]} />
        <OitStandardMaterial
          oit={oitMaterials}
          color="#4ecdb0"
          transparent
          opacity={0.3}
          depthWrite={false}
          side={DoubleSide}
        />
      </mesh>
    </group>
  );
};

const DebugScene = (args: DebugArgs) => {
  const scene = useThree(state => state.scene);
  const camera = useThree(state => state.camera);
  const renderer = useThree(state => state.gl);

  // Tone mapping + output colour space can be changed on the live renderer (no
  // context rebuild needed), so drive them imperatively from the controls.
  useEffect(() => {
    renderer.toneMapping = TONE_MAPPING[args.toneMapping] ?? NoToneMapping;
    renderer.outputColorSpace =
      args.outputColorSpace === 'linear'
        ? LinearSRGBColorSpace
        : SRGBColorSpace;
  }, [renderer, args.toneMapping, args.outputColorSpace]);

  // Clear colour + alpha. Kept as the renderer's ambient clear state for passes that
  // don't own an explicit background (e.g. DebugPatternPass) and as the fallback source
  // for base passes when their clearColor is null. The base pass background itself is
  // driven via basePass.clearColor below (single source of truth shared by RenderPass
  // and OITRenderPass), so it stays identical whether OIT is on or off.
  useEffect(() => {
    // A transparent background must clear to premultiplied-transparent (rgb = 0,
    // alpha = 0): a coloured clear at alpha 0 would leak that colour additively over
    // the page through the premultiplied OutputPass composite.
    renderer.setClearColor(
      args.transparentBackground
        ? new Color(0, 0, 0)
        : new Color(args.background),
      args.transparentBackground ? 0 : 1,
    );
  }, [renderer, args.background, args.transparentBackground]);

  // FXAA is a standalone post pass (works with or without OIT); SMAA / temporal are
  // OIT-internal antialias modes driven via oitPass.antialias below.
  const fxaaActive = args.aaMode === 'fxaa';

  const passes = useMemo(() => {
    const output: Pass =
      args.downsampleMode === 'box'
        ? new DebugBoxOutputPass(args.supersample)
        : new OutputPass();

    if (args.debugPattern !== 'off') {
      return [
        new DebugPatternPass(args.debugPattern, args.patternScale),
        output,
      ];
    }

    const base = args.oitEnabled
      ? new OITRenderPass(scene, camera)
      : new RenderPass(scene, camera);
    const list: Pass[] = [base];
    if (fxaaActive) list.push(new FXAAPass());
    list.push(output);
    return list;
    // patternScale / supersample are synced below without rebuilding passes.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [
    scene,
    camera,
    args.oitEnabled,
    args.downsampleMode,
    args.debugPattern,
    fxaaActive,
  ]);

  const patternPass = passes[0] instanceof DebugPatternPass ? passes[0] : null;
  const boxPass =
    passes[passes.length - 1] instanceof DebugBoxOutputPass
      ? (passes[passes.length - 1] as DebugBoxOutputPass)
      : null;
  const oitPass = passes[0] instanceof OITRenderPass ? passes[0] : null;
  const basePass =
    passes[0] instanceof OITRenderPass || passes[0] instanceof RenderPass
      ? passes[0]
      : null;

  // Explicit base-pass background: RenderPass and OITRenderPass both clear to this, so
  // the background is identical regardless of which base pass renders (OIT on/off),
  // independent of the renderer's ambient clear state. A transparent background clears
  // to premultiplied-transparent (rgb = 0, alpha = 0).
  useEffect(() => {
    if (!basePass) return;
    basePass.clearColor = args.transparentBackground
      ? new Color(0, 0, 0)
      : new Color(args.background);
    basePass.clearAlpha = args.transparentBackground ? 0 : 1;
  }, [basePass, args.background, args.transparentBackground]);

  useEffect(() => {
    if (patternPass) patternPass.scale = args.patternScale;
  }, [patternPass, args.patternScale]);

  useEffect(() => {
    if (boxPass) boxPass.supersample = args.supersample;
  }, [boxPass, args.supersample]);

  useEffect(() => {
    if (oitPass)
      oitPass.antialias = args.aaMode === 'fxaa' ? 'none' : args.aaMode;
  }, [oitPass, args.aaMode]);

  useEffect(() => {
    if (oitPass) oitPass.debugTargets = args.showDebugTargets;
  }, [oitPass, args.showDebugTargets]);

  // Live-tune the temporal AA anti-ghost knobs. The resolvers are created lazily
  // inside OITRenderPass.render() and recreated (resetting to defaults) on a mode
  // switch, so push the current control values every frame rather than via an effect
  // that would miss the not-yet-created / just-recreated resolver.
  useFrame(() => {
    if (!oitPass) return;
    const temporal = oitPass.temporalResolver;
    if (temporal) temporal.clampStrength = args.temporalClampStrength;
    const taa = oitPass.taaResolver;
    if (taa) {
      taa.restClampStrength = args.taaRestClampStrength;
      taa.restBoxGamma = args.taaRestBoxGamma;
      taa.restNeighbourhoodRadius = args.taaRestNeighbourhoodRadius;
    }
  });

  return (
    <>
      <ambientLight intensity={0.6} />
      <directionalLight position={[-1, 2, -3]} intensity={1.2} />
      <hemisphereLight args={['#ffffff', '#33384a', 0.5]} />

      {args.debugPattern === 'off' && (
        <TestGeometry
          geometry={args.geometry}
          animate={args.animate}
          oitMaterials={args.oitMaterials}
        />
      )}

      <RenderingPipeline passes={passes} supersample={args.supersample} />
      <CameraControls makeDefault />
    </>
  );
};

// Center-crop side used by the AA metric readback. A relative high-frequency
// energy measure needs a fixed, screen-independent window, not the whole canvas.
const AA_CROP = 256;

/**
 * Mean absolute Laplacian of luma over the crop — a high-frequency "energy" proxy.
 * Lower = smoother, but this is a SMOOTHNESS measure, NOT a quality score: it is
 * biased toward blur, so a technique that over-softens the whole image (FXAA) posts
 * the lowest number by destroying detail, while a sharpness-preserving one (SMAA) or a
 * correctly resolved sub-pixel feature keeps legitimate high-frequency energy and
 * reads "worse". It is also single-frame, so it cannot see temporal shimmer. Use it
 * only as a rough smoothness proxy; judge quality with the RMSE-vs-SSAA and temporal-Δ
 * metrics instead.
 */
function computeEdgeEnergy(
  data: Uint8ClampedArray,
  w: number,
  h: number,
): number {
  const luma = (i: number) =>
    0.299 * data[i] + 0.587 * data[i + 1] + 0.114 * data[i + 2];
  let sum = 0;
  let count = 0;
  // Use Laplacian (second derivative) to measure curvature / sharp discontinuities.
  // Laplacian = uxx + uyy ≈ centre - (neighbours sum / 4), normalized.
  // Smooth AA'd edges: low Laplacian. Jagged aliased edges: high Laplacian.
  for (let y = 1; y < h - 1; y++) {
    for (let x = 1; x < w - 1; x++) {
      const iC = (y * w + x) * 4;
      const iN = ((y - 1) * w + x) * 4;
      const iS = ((y + 1) * w + x) * 4;
      const iW = (y * w + (x - 1)) * 4;
      const iE = (y * w + (x + 1)) * 4;
      const lC = luma(iC);
      const lN = luma(iN);
      const lS = luma(iS);
      const lW = luma(iW);
      const lE = luma(iE);
      // Laplacian: centre minus average of 4-neighbours (captures curvature).
      const laplacian = Math.abs(4 * lC - (lN + lS + lW + lE));
      sum += laplacian;
      count++;
    }
  }
  return count ? sum / count : 0;
}

/**
 * Mean absolute per-pixel luma difference between two equal-size crops. On a STATIC
 * scene held still this is pure temporal instability: non-jittered modes
 * (none/fxaa/smaa) render identical frames and read ~0 (frozen aliasing does not
 * crawl), while a temporal/TAA mode reads > 0 until it converges and 0 once it has
 * settled — a direct "has it stopped wobbling?" readout for the temporal modes. During
 * camera or geometry motion the diff is dominated by the real motion, so read it on a
 * held view.
 */
function computeLumaDiff(
  cur: Uint8ClampedArray,
  prev: Uint8ClampedArray,
  w: number,
  h: number,
): number {
  const luma = (d: Uint8ClampedArray, i: number) =>
    0.299 * d[i] + 0.587 * d[i + 1] + 0.114 * d[i + 2];
  const n = w * h;
  let sum = 0;
  for (let p = 0; p < n; p++) {
    const i = p * 4;
    sum += Math.abs(luma(cur, i) - luma(prev, i));
  }
  return n ? sum / n : 0;
}

/**
 * RGB root-mean-square error (0–255 scale) between a crop and a same-size reference
 * crop. Paired with a high-supersample reference (supersample 4 + aaMode none = a 4x4
 * SSAA ground truth) this is the actual AA-quality metric: it measures distance from
 * the ideal anti-aliased image, so an over-blurred FXAA frame scores WORSE (it strays
 * from the sharp-but-smooth truth) while a converged temporal/TAA frame scores best —
 * unlike the blur-biased edge-energy number, which a blurry image always "wins".
 */
function computeRmse(
  cur: Uint8ClampedArray,
  ref: Uint8ClampedArray,
  w: number,
  h: number,
): number {
  const n = w * h;
  let sum = 0;
  for (let p = 0; p < n; p++) {
    const i = p * 4;
    const dr = cur[i] - ref[i];
    const dg = cur[i + 1] - ref[i + 1];
    const db = cur[i + 2] - ref[i + 2];
    sum += dr * dr + dg * dg + db * db;
  }
  return n ? Math.sqrt(sum / (n * 3)) : 0;
}

/** Screenshot-free AA metrics reported by {@link AaMeasure}. */
type AaMetrics = {
  /** High-frequency energy (lower = smoother/blurrier, NOT necessarily better). */
  edgeEnergy: number;
  /** Frame-to-frame mean |Δluma| (temporal instability); null on the first read. */
  instability: number | null;
  /** RGB RMSE vs the captured reference; null when none is set / stale / the size mismatches. */
  rmse: number | null;
  /** PSNR (dB) derived from {@link AaMetrics.rmse}; `Infinity` when the crop matches exactly. */
  psnr: number | null;
  /** A reference exists but the camera moved / `animate` is on, so RMSE/PSNR are withheld. */
  refStale: boolean;
};

/**
 * HUD colour for a PSNR reading: green = good (closer to the SSAA reference), amber =
 * fair, red = poor. Lower RMSE / higher PSNR is better, so the colour keys off PSNR
 * (Infinity = identical to the reference). Thresholds are the usual rough bands
 * (~30 dB mediocre, ~40 dB good).
 */
function psnrColor(psnr: number | null): string {
  if (psnr == null) return '#b8f0b8';
  if (psnr === Infinity || psnr >= 40) return '#6ee66e';
  if (psnr < 30) return '#f0736e';
  return '#e6c86e';
}

/**
 * Reads back a centre crop of the composited canvas each 8th frame and reports three
 * screenshot-free AA metrics (see {@link AaMetrics}): high-frequency energy (a
 * smoothness proxy, biased toward blur so NOT a quality score on its own), temporal
 * instability (frame-to-frame delta — settles to 0 as a temporal mode converges), and,
 * once a reference is captured, RMSE / PSNR against it (the real quality metric when
 * the reference is a high-supersample SSAA frame). Runs at R3F priority 2 (after the
 * pipeline's priority-1 render) so it samples the finished frame; requires
 * `preserveDrawingBuffer`. Rendered only while `measureAA` is on.
 */
const AaMeasure = ({
  onValue,
  captureRef,
  animate,
}: {
  onValue: (m: AaMetrics) => void;
  captureRef: React.MutableRefObject<boolean>;
  animate: boolean;
}) => {
  const gl = useThree(state => state.gl);
  const camera = useThree(state => state.camera);
  const scratch = useRef<HTMLCanvasElement | null>(null);
  const frame = useRef(0);
  const prev = useRef<{ data: Uint8ClampedArray; w: number; h: number } | null>(
    null,
  );
  const reference = useRef<{
    data: Uint8ClampedArray;
    w: number;
    h: number;
    pose: number[];
  } | null>(null);

  useFrame(() => {
    if (frame.current++ % 8 !== 0) return;
    const src = gl.domElement;
    const cw = Math.min(AA_CROP, src.width);
    const ch = Math.min(AA_CROP, src.height);
    if (cw < 2 || ch < 2) return;
    if (!scratch.current) scratch.current = document.createElement('canvas');
    const canvas = scratch.current;
    canvas.width = cw;
    canvas.height = ch;
    const ctx = canvas.getContext('2d', { willReadFrequently: true });
    if (!ctx) return;
    const sx = Math.floor((src.width - cw) / 2);
    const sy = Math.floor((src.height - ch) / 2);
    ctx.drawImage(src, sx, sy, cw, ch, 0, 0, cw, ch);
    const data = ctx.getImageData(0, 0, cw, ch).data;

    const edgeEnergy = computeEdgeEnergy(data, cw, ch);

    // Temporal instability: mean |Δluma| vs the previous read (same pixel grid).
    let instability: number | null = null;
    const p = prev.current;
    if (p && p.w === cw && p.h === ch) {
      instability = computeLumaDiff(data, p.data, cw, ch);
    }
    prev.current = { data, w: cw, h: ch };

    // Snapshot the camera pose so a captured reference can be flagged stale if it
    // moves. Temporal/TAA jitter offsets the projection matrix (not position /
    // quaternion) and is restored before this priority-2 read, so it never trips this.
    const pose = [
      camera.position.x,
      camera.position.y,
      camera.position.z,
      camera.quaternion.x,
      camera.quaternion.y,
      camera.quaternion.z,
      camera.quaternion.w,
    ];

    // Capture the current crop as the reference on request (button in the HUD).
    if (captureRef.current) {
      captureRef.current = false;
      reference.current = { data, w: cw, h: ch, pose };
    }

    // A reference is only comparable on a held, non-animating view. If the camera
    // moved since capture or `animate` is on, withhold RMSE/PSNR and flag it stale
    // rather than report a motion-contaminated number.
    let rmse: number | null = null;
    let psnr: number | null = null;
    let refStale = false;
    const ref = reference.current;
    if (ref) {
      let moved = animate;
      for (let k = 0; !moved && k < pose.length; k++) {
        if (Math.abs(pose[k] - ref.pose[k]) > 1e-4) moved = true;
      }
      if (moved) {
        refStale = true;
      } else if (ref.w === cw && ref.h === ch) {
        rmse = computeRmse(data, ref.data, cw, ch);
        psnr = rmse > 0 ? 20 * Math.log10(255 / rmse) : Infinity;
      }
    }

    onValue({ edgeEnergy, instability, rmse, psnr, refStale });
  }, 2);

  return null;
};

type Resolution = {
  /** CSS (display) size in logical pixels. */
  cssW: number;
  cssH: number;
  /** Canvas drawing-buffer size (css * dpr). */
  bufW: number;
  bufH: number;
  /** Pipeline render-target size (buffer * supersample, clamped to GPU max). */
  renderW: number;
  renderH: number;
};

/**
 * Reports the canvas' true resolutions to the HUD: the CSS display size, the GL
 * drawing-buffer size (css * dpr) and the pipeline's supersampled render-target
 * size. Mirrors the sizing math in {@link RenderingPipeline} (drawing buffer *
 * supersample, clamped to `maxTextureSize`) so the HUD shows exactly what the
 * pipeline renders at. Re-runs on resize / dpr / supersample changes.
 */
const ResolutionProbe = ({
  supersample,
  onValue,
}: {
  supersample: number;
  onValue: (r: Resolution) => void;
}) => {
  const gl = useThree(state => state.gl);
  const size = useThree(state => state.size);
  const dpr = useThree(state => state.viewport.dpr);

  useEffect(() => {
    const buf = new Vector2();
    gl.getDrawingBufferSize(buf);
    const bufW = Math.round(buf.x);
    const bufH = Math.round(buf.y);
    let renderW = Math.max(1, Math.floor(bufW * supersample));
    let renderH = Math.max(1, Math.floor(bufH * supersample));
    const maxSize = gl.capabilities.maxTextureSize;
    if (renderW > maxSize || renderH > maxSize) {
      const scale = maxSize / Math.max(renderW, renderH);
      renderW = Math.max(1, Math.floor(renderW * scale));
      renderH = Math.max(1, Math.floor(renderH * scale));
    }
    onValue({
      cssW: Math.round(size.width),
      cssH: Math.round(size.height),
      bufW,
      bufH,
      renderW,
      renderH,
    });
  }, [gl, size.width, size.height, dpr, supersample, onValue]);

  return null;
};

/** Human-readable AA description, noting where each mode is applied. */
function aaLabel(args: DebugArgs): string {
  switch (args.aaMode) {
    case 'none':
      return 'off';
    case 'fxaa':
      return 'FXAA (post pass)';
    default:
      return args.oitEnabled
        ? `${args.aaMode} (OIT-internal)`
        : `${args.aaMode} (needs OIT — inactive)`;
  }
}

/** Builds the ordered key/value rows shown in the HUD info panel. */
function buildInfoRows(
  args: DebugArgs,
  res: Resolution | null,
): [string, string][] {
  const content =
    args.debugPattern !== 'off'
      ? `${args.debugPattern} pattern (scale ${args.patternScale})`
      : `${args.geometry}${args.animate ? ' (spinning)' : ' (paused)'}`;

  const resolution = res
    ? `${res.cssW}×${res.cssH} css · ${res.bufW}×${res.bufH} buffer` +
    (args.supersample !== 1 ? ` · ${res.renderW}×${res.renderH} render` : '')
    : '…';

  return [
    ['content', content],
    ['OIT', args.oitEnabled ? 'on' : 'off'],
    ['AA', aaLabel(args)],
    [
      'background',
      args.transparentBackground
        ? `${args.background} (transparent)`
        : args.background,
    ],
    ['resolution', resolution],
    ['dpr', String(args.dpr)],
    [
      'supersample',
      args.supersample === 1
        ? '1× (off)'
        : `${args.supersample}× (${args.downsampleMode})`,
    ],
    ['tone mapping', args.toneMapping],
    ['output', args.outputColorSpace],
  ];
}

const DebugCanvas = ({
  args,
  logDepth,
  label,
}: {
  args: DebugArgs;
  logDepth: boolean;
  label: string;
}) => {
  const [aaMetrics, setAaMetrics] = useState<AaMetrics | null>(null);
  const captureRef = useRef(false);
  const [resolution, setResolution] = useState<Resolution | null>(null);

  const infoRows = buildInfoRows(args, resolution);

  return (
    <div
      style={{
        position: 'relative',
        flex: 1,
        minWidth: 0,
        height: '100%',
        ...CHECKER_BG,
      }}
    >
      <div
        style={{
          position: 'absolute',
          top: 0,
          left: 0,
          zIndex: 2,
          display: 'flex',
          flexDirection: 'column',
          gap: 4,
          maxWidth: 'calc(100% - 8px)',
          pointerEvents: 'none',
        }}
      >
        <div
          style={{
            padding: '4px 8px',
            font: '12px monospace',
            lineHeight: 1.5,
            color: '#e0e0e0',
            background: 'rgba(0,0,0,0.55)',
          }}
        >
          <div style={{ fontWeight: 'bold', marginBottom: 2 }}>{label}</div>
          {infoRows.map(([key, value]) => (
            <div key={key}>
              <span style={{ color: '#8a94a6' }}>{key}: </span>
              {value}
            </div>
          ))}
        </div>
        {args.measureAA && (
          <div
            style={{
              padding: '4px 8px',
              font: '12px monospace',
              color: '#b8f0b8',
              background: 'rgba(0,0,0,0.6)',
              pointerEvents: 'auto',
            }}
          >
            <div>
              HF energy (↓ = smoother/blurrier, not quality):{' '}
              {aaMetrics == null ? '…' : aaMetrics.edgeEnergy.toFixed(3)}
            </div>
            <div>
              Temporal Δ (hold still; ↓ = settled):{' '}
              {aaMetrics?.instability == null
                ? '…'
                : aaMetrics.instability.toFixed(3)}
            </div>
            {aaMetrics?.rmse != null ? (
              <div style={{ color: psnrColor(aaMetrics.psnr) }}>
                vs ref (↓RMSE / ↑PSNR = better): RMSE{' '}
                {aaMetrics.rmse.toFixed(2)} · PSNR{' '}
                {aaMetrics.psnr == null || aaMetrics.psnr === Infinity
                  ? '∞'
                  : `${aaMetrics.psnr.toFixed(1)} dB`}
              </div>
            ) : aaMetrics?.refStale ? (
              <div style={{ color: '#f0b36e' }}>
                vs ref: stale — recapture (camera moved / animate on)
              </div>
            ) : (
              <div style={{ color: '#8a94a6' }}>
                vs ref: none — set supersample 4 + aaMode none, then capture
              </div>
            )}
            <button
              type="button"
              onClick={() => {
                captureRef.current = true;
              }}
              style={{
                marginTop: 4,
                font: '11px monospace',
                cursor: 'pointer',
              }}
            >
              Set reference (SSAA)
            </button>
          </div>
        )}
      </div>
      <Canvas
        // logarithmicDepthBuffer is a construction-time flag, so remount when it
        // changes (single layout) or across the two side-by-side canvases.
        key={logDepth ? 'log' : 'linear'}
        camera={{ near: 0.1, far: 5000, position: [3.2, 2.2, 3.6], fov: 60 }}
        dpr={args.dpr}
        gl={{
          logarithmicDepthBuffer: logDepth,
          antialias: false,
          alpha: true,
          premultipliedAlpha: true,
          preserveDrawingBuffer: true,
          toneMapping: NoToneMapping,
        }}
        style={{ background: 'transparent' }}
      >
        <DebugScene {...args} />
        <ResolutionProbe
          supersample={args.supersample}
          onValue={setResolution}
        />
        {args.measureAA && (
          <AaMeasure
            onValue={setAaMetrics}
            captureRef={captureRef}
            animate={args.animate}
          />
        )}
      </Canvas>
    </div>
  );
};

const meta = {
  title: 'debug/OIT Pipeline',
  render: (args: DebugArgs) => (
    <div style={{ position: 'absolute', inset: 0, display: 'flex', gap: 2 }}>
      {args.layout === 'sideBySide' ? (
        <>
          <DebugCanvas
            args={args}
            logDepth={false}
            label="logarithmicDepthBuffer: OFF (linear)"
          />
          <DebugCanvas
            args={args}
            logDepth
            label="logarithmicDepthBuffer: ON (log)"
          />
        </>
      ) : (
        <DebugCanvas
          args={args}
          logDepth={args.logDepth}
          label={`logarithmicDepthBuffer: ${args.logDepth ? 'ON (log)' : 'OFF (linear)'}`}
        />
      )}
    </div>
  ),
  argTypes: {
    debugPattern: {
      control: 'select',
      options: [
        'off',
        'zonePlate',
        'grid',
        'checker',
        'gradient',
        'colorBars',
        'grayStep',
        'grayCard',
      ],
      table: { category: 'Content' },
    },
    patternScale: {
      control: { type: 'range', min: 2, max: 128, step: 1 },
      table: { category: 'Content' },
    },
    geometry: {
      control: 'select',
      options: [
        'torusKnot',
        'thinBars',
        'thinBars-transparent',
        'lines',
        'lines-transparent',
      ],
      table: { category: 'Content' },
    },
    animate: { control: 'boolean', table: { category: 'Content' } },
    // Rendering controls
    toneMapping: {
      control: 'select',
      options: Object.keys(TONE_MAPPING),
      table: { category: 'Rendering' },
    },
    outputColorSpace: {
      control: 'inline-radio',
      options: ['srgb', 'linear'],
      table: { category: 'Rendering' },
    },
    aaMode: {
      control: 'select',
      options: ['none', 'fxaa', 'smaa', 'temporal', 'temporal-smaa', 'taa'],
      table: { category: 'Rendering' },
    },
    // Temporal AA anti-ghost tuning (still-camera). These reject stale history
    // when a moving object (spinning geometry under a still camera) leaves a
    // trail, while staying a no-op for converged near-Nyquist static geometry.
    temporalClampStrength: {
      control: { type: 'range', min: 0, max: 1, step: 0.05 },
      name: 'temporal clamp',
      description:
        'temporal / temporal-smaa: neighbourhood-clip strength while still ' +
        '(0 = pure EMA / old behaviour, 1 = full clip). Higher = less ghosting.',
      if: { arg: 'aaMode', neq: 'none' },
      table: { category: 'AA tuning' },
    },
    taaRestClampStrength: {
      control: { type: 'range', min: 0, max: 1, step: 0.05 },
      name: 'taa rest clamp',
      description:
        'taa: neighbourhood-clip strength floor while the camera is still ' +
        '(0 = trust history verbatim, 1 = full clip). Higher = less ghosting.',
      if: { arg: 'aaMode', eq: 'taa' },
      table: { category: 'AA tuning' },
    },
    taaRestBoxGamma: {
      control: { type: 'range', min: 0.5, max: 3, step: 0.05 },
      name: 'taa rest box γ',
      description:
        'taa: variance-box width (in σ) while still. Wider keeps converged ' +
        'thin features inside the box (no wobble); narrower rejects ghosts harder.',
      if: { arg: 'aaMode', eq: 'taa' },
      table: { category: 'AA tuning' },
    },
    taaRestNeighbourhoodRadius: {
      control: { type: 'range', min: 0.5, max: 3, step: 0.1 },
      name: 'taa rest radius',
      description:
        'taa: 3×3 sampling stride (in pixels) for the variance box while still. ' +
        'Wider stride represents near-Nyquist detail in the box → no-op clip.',
      if: { arg: 'aaMode', eq: 'taa' },
      table: { category: 'AA tuning' },
    },
    // Debug controls
    showDebugTargets: {
      control: 'boolean',
      table: { category: 'Debug' },
    },
    measureAA: { control: 'boolean', table: { category: 'Debug' } },
    // Display controls
    background: { control: 'color', table: { category: 'Display' } },
    transparentBackground: {
      control: 'boolean',
      table: { category: 'Display' },
    },
    dpr: {
      control: 'inline-radio',
      options: [1, 1.5, 2],
      table: { category: 'Display' },
    },
    layout: {
      control: 'inline-radio',
      options: ['single', 'sideBySide'],
      table: { category: 'Display' },
    },
    logDepth: {
      control: 'boolean',
      if: { arg: 'layout', eq: 'single' },
      table: { category: 'Display' },
    },
    // Pipeline controls
    oitEnabled: { control: 'boolean', table: { category: 'Pipeline' } },
    oitMaterials: {
      control: 'boolean',
      name: 'OIT materials',
      description:
        'Make the test geometry OIT-capable (via makeOitCompatible) so transparent ' +
        'surfaces resolve order-independently through the OIT pass.',
      table: { category: 'Pipeline' },
    },
    supersample: {
      control: 'inline-radio',
      options: [0.5, 1, 1.5, 2, 4],
      table: { category: 'Pipeline' },
    },
    downsampleMode: {
      control: 'inline-radio',
      options: ['mipmap', 'box'],
      table: { category: 'Pipeline' },
    },
  },
  args: {
    // Content
    debugPattern: 'off',
    patternScale: 24,
    geometry: 'torusKnot',
    animate: true,
    // Rendering
    toneMapping: 'none',
    outputColorSpace: 'srgb',
    aaMode: 'taa',
    temporalClampStrength: 0.2,
    taaRestClampStrength: 0.2,
    taaRestBoxGamma: 1.6,
    taaRestNeighbourhoodRadius: 1.5,
    // Debug
    showDebugTargets: false,
    measureAA: false,
    // Display
    background: '#101014',
    transparentBackground: false,
    dpr: 1,
    layout: 'single',
    logDepth: true,
    // Pipeline
    oitEnabled: true,
    oitMaterials: true,
    supersample: 1,
    downsampleMode: 'mipmap',
  },
} satisfies Meta<DebugArgs>;

export default meta;

type Story = StoryObj<typeof meta>;

export const Default: Story = {};
