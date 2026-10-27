import {
  BufferAttribute,
  BufferGeometry,
  Color,
  CustomBlending,
  DoubleSide,
  OneFactor,
  OneMinusSrcAlphaFactor,
  ShaderMaterial,
  SrcAlphaFactor,
} from 'three';
import { computeUpwardNormals } from '../../sdk/geometries/geometry-attributes';
import {
  Coordinates2D,
  PlanarPolygonCoordinates,
  PlanarPolygonGeometry,
} from '../../sdk/geometries/planar-geometry';
import { Vec2 } from '../../sdk/types/common';
import { attachOitVariants } from '../../rendering/oit-material';
import skyVertexShader from './shaders/sky-vertex.glsl';
import skySurfaceShader from './shaders/sky-surface-fragment.glsl';
import fragmentShader from './shaders/stage-fragment.glsl';
import vertexShader from './shaders/stage-vertex.glsl';
import {
  SCENERY_SHARED_DEFINES,
  type SceneryMaterial,
} from './scenery-material';

/** `[minX, minZ, maxX, maxZ]` in scene X/Z. */
export type SceneryStageBounds = [number, number, number, number];

/**
 * The whole stage, flat at y = 0: `bounds` as a grid, then rings out to `extent`, each
 * about twice as wide as the one inside it, so the triangles grow with their distance from
 * `bounds` (huge ones crack where the GPU clips them), in one mesh. The water lies on it,
 * and so does the flat seabed.
 *
 * ⚠️ `bounds` must lie inside `extent`.
 */
export function createSceneryStagePlane(
  bounds: SceneryStageBounds,
  extent: SceneryStageBounds,
): BufferGeometry {
  return createRings(bounds, extent);
}

const OUTLINE_RIM = new Color('#ffffff');
const OUTLINE_SURFACE = new Color('#000000');
const OUTLINE_BOUNDS = new Color('#909090');
const OUTLINE_FOOT = new Color('#505050');

// Line segments with vertex colours, a closed loop at a time.
function outlineLoops() {
  const positions: number[] = [];
  const colors: number[] = [];
  const loop = (
    points: Vec2[],
    heightAt: (i: number) => number,
    color: Color,
  ) => {
    points.forEach(([x, z], i) => {
      const j = (i + 1) % points.length;
      positions.push(
        x,
        heightAt(i),
        z,
        points[j][0],
        heightAt(j),
        points[j][1],
      );
      colors.push(color.r, color.g, color.b, color.r, color.g, color.b);
    });
  };
  const build = () => {
    const geometry = new BufferGeometry();
    geometry.setAttribute(
      'position',
      new BufferAttribute(new Float32Array(positions), 3),
    );
    geometry.setAttribute(
      'color',
      new BufferAttribute(new Float32Array(colors), 3),
    );
    return geometry;
  };
  return { loop, build };
}

/**
 * Debug lines, as segments with vertex colours: the `outlines` at `bedY` in white and at
 * the sea `level` in black, and `bounds` at `bedY` in grey.
 */
export function createSceneryStageOutline(
  bounds: SceneryStageBounds,
  outlines: PlanarPolygonGeometry[],
  level: number,
  bedY: number,
): BufferGeometry {
  const { loop, build } = outlineLoops();
  for (const points of outlineRings(outlines)) {
    loop(points, () => bedY, OUTLINE_RIM);
    loop(points, () => level, OUTLINE_SURFACE);
  }
  loop(rectangle(bounds), () => bedY, OUTLINE_BOUNDS);
  return build();
}

/**
 * The same outlines and `bounds`, flat at height 0 in a faint grey: moved down to the void
 * walls' foot, it shows how far they lean out from the stage.
 */
export function createSceneryStageFootprint(
  bounds: SceneryStageBounds,
  outlines: PlanarPolygonGeometry[],
): BufferGeometry {
  const { loop, build } = outlineLoops();
  for (const points of outlineRings(outlines))
    loop(points, () => 0, OUTLINE_FOOT);
  loop(rectangle(bounds), () => 0, OUTLINE_FOOT);
  return build();
}

// Every ring of every outline, open, in scene X/Z: its offset added.
function outlineRings(outlines: PlanarPolygonGeometry[]): Vec2[][] {
  return outlines.flatMap(outline => {
    const [ox, oz] = outline.offset;
    return (outline.coordinates as PlanarPolygonCoordinates).flatMap(
      component =>
        component.map(ring =>
          openRing(ring).map(([x, z]): Vec2 => [x + ox, z + oz]),
        ),
    );
  });
}

function rectangle([
  minX,
  minZ,
  maxX,
  maxZ,
]: SceneryStageBounds): Coordinates2D {
  return [
    [minX, minZ],
    [maxX, minZ],
    [maxX, maxZ],
    [minX, maxZ],
  ];
}

// Points per side of every ring rectangle; the same for all of them, so rings share vertices.
const RING_SEGMENTS = 4;

// A rectangle's outline with `RING_SEGMENTS` points per side, starting at its min corner.
function perimeter([minX, minZ, maxX, maxZ]: SceneryStageBounds): Vec2[] {
  const corners: Vec2[] = [
    [minX, minZ],
    [maxX, minZ],
    [maxX, maxZ],
    [minX, maxZ],
  ];
  const points: Vec2[] = [];
  corners.forEach(([x0, z0], c) => {
    const [x1, z1] = corners[(c + 1) % 4];
    for (let i = 0; i < RING_SEGMENTS; i++) {
      const t = i / RING_SEGMENTS;
      points.push([x0 + (x1 - x0) * t, z0 + (z1 - z0) * t]);
    }
  });
  return points;
}

// `inner` as a grid, and rings out to `outer`, the grid's edge the first ring's own vertices.
function createRings(
  inner: SceneryStageBounds,
  outer: SceneryStageBounds,
): BufferGeometry {
  const first =
    Math.max(inner[2] - inner[0], inner[3] - inner[1]) / RING_SEGMENTS;
  const boundaries = [inner];
  for (let grow = first; ; grow = 2 * grow + first) {
    const ring: SceneryStageBounds = [
      Math.max(inner[0] - grow, outer[0]),
      Math.max(inner[1] - grow, outer[1]),
      Math.min(inner[2] + grow, outer[2]),
      Math.min(inner[3] + grow, outer[3]),
    ];
    boundaries.push(ring);
    if (ring.every((v, i) => v === outer[i])) break;
  }

  const points = boundaries.map(perimeter);
  const count = points[0].length;
  const flat = points.flat();
  const indices: number[] = [];
  const at = (k: number, i: number) => k * count + (i % count);
  const add = (a: number, b: number, c: number) => {
    const [ax, az] = flat[a];
    const [bx, bz] = flat[b];
    const [cx, cz] = flat[c];
    // A side held at `outer` leaves no width there.
    if (Math.abs((bx - ax) * (cz - az) - (bz - az) * (cx - ax)) > 1e-6) {
      indices.push(a, b, c);
    }
  };
  for (let k = 0; k + 1 < points.length; k++) {
    for (let i = 0; i < count; i++) {
      add(at(k, i), at(k + 1, i + 1), at(k, i + 1));
      add(at(k, i), at(k + 1, i), at(k + 1, i + 1));
    }
  }

  const n = RING_SEGMENTS;
  const [minX, minZ, maxX, maxZ] = inner;
  const start = flat.length;
  for (let j = 1; j < n; j++) {
    for (let i = 1; i < n; i++) {
      flat.push([
        minX + ((maxX - minX) * i) / n,
        minZ + ((maxZ - minZ) * j) / n,
      ]);
    }
  }
  // Grid vertex (i, j): on the edge the first ring's, in `perimeter`'s order.
  const grid = (i: number, j: number) => {
    if (j === 0 && i < n) return i;
    if (i === n && j < n) return n + j;
    if (j === n && i > 0) return 3 * n - i;
    if (i === 0 && j > 0) return 4 * n - j;
    return start + (j - 1) * (n - 1) + (i - 1);
  };
  for (let j = 0; j < n; j++) {
    for (let i = 0; i < n; i++) {
      add(grid(i, j), grid(i + 1, j), grid(i + 1, j + 1));
      add(grid(i, j), grid(i + 1, j + 1), grid(i, j + 1));
    }
  }

  const positions = flat.flatMap(([x, z]) => [x, 0, z]);
  const geometry = new BufferGeometry();
  geometry.setAttribute(
    'position',
    new BufferAttribute(new Float32Array(positions), 3),
  );
  geometry.setIndex(indices);
  computeUpwardNormals(geometry);
  return geometry;
}

function openRing(ring: Coordinates2D): Vec2[] {
  const points = ring.map(([x, z]) => [x, z] as Vec2);
  const first = points[0];
  const last = points[points.length - 1];
  if (points.length > 1 && first[0] === last[0] && first[1] === last[1]) {
    points.pop();
  }
  return points;
}

/** Which part of a stage a material draws. */
export type SceneryStagePart = 'surface' | 'bed';

/** How a stage's part is drawn (see {@link createSceneryStageMaterial}). */
export type SceneryStageMaterialOptions = {
  /** the bed's: at the sea's seabed opacity, as a transparent part; opaque otherwise */
  seeThrough?: boolean;
  /**
   * the surface's: write the depth of the sea where it falls away with the Earth's curve,
   * rather than of the flat geometry, so a relief beyond the scene meets it there
   */
  curvedDepth?: boolean;
};

/** The defines a material drawing the sky's sea needs, from the sky's switches. */
export function sceneryOceanDefines(sky: SceneryMaterial) {
  const defines: Record<string, unknown> = { SKY_OCEAN: '', SKY_ABYSS: '' };
  for (const key of SCENERY_SHARED_DEFINES) {
    if (sky.switches[key] !== undefined) defines[key] = sky.switches[key];
  }
  return defines;
}

/**
 * A material for a stage's geometry, drawing the sky's own sea. It shares the sky
 * material's uniform objects, so it follows every change to the sky and its water.
 *
 * The sky shows what lies beyond the seabed through any gap in the stage (see
 * `skyOceanStaged`). A `seeThrough` seabed is drawn at the sea's seabed opacity
 * (`SceneryMaterial.oceanSeabedOpacity`); the surface always is.
 * The transparent parts are wired for the `OITRenderPass`.
 * The seabed is lit by the scene's lights, as the sky's is; a seabed or sea that changes
 * the sky's defines (its detail, its waves) needs new materials.
 */
export function createSceneryStageMaterial(
  sky: SceneryMaterial,
  part: SceneryStagePart,
  { seeThrough = false, curvedDepth = false }: SceneryStageMaterialOptions = {},
) {
  const defines = sceneryOceanDefines(sky);
  const surface = part === 'surface';
  if (surface) defines.STAGE_SURFACE = '';
  else defines.STAGE_BED = '';
  if (surface && curvedDepth) defines.STAGE_CURVED_DEPTH = '';
  if (!surface && seeThrough) defines.STAGE_SEE_THROUGH = '';
  // Its lid, seen from the void, leaves the cave's walls to the background.
  if (!surface && sky.abyssWalls) defines.SKY_ABYSS_WALLS = '';

  const transparent = surface || seeThrough;
  const material = new ShaderMaterial({
    vertexShader,
    fragmentShader,
    // Inherits the sky's uniforms rather than copying them, so what the sky adds later reaches it too.
    uniforms: sky.uniforms,
    defines,
    transparent,
    depthWrite: !transparent,
    side: DoubleSide,
    lights: true,
  });
  if (!transparent) return material;
  // Alpha is per fragment: below 1, so OITRenderPass routes it as transparent.
  material.opacity = 0.999;
  return attachOitVariants(material);
}

/**
 * The sky's sea surface as a fullscreen layer of its own, drawn right after the
 * background and blended over it. It shares the sky material's uniform objects. On the
 * far plane, as the background is; the bakes draw it without a depth test.
 */
export function createScenerySurfaceMaterial(sky: SceneryMaterial) {
  return new ShaderMaterial({
    vertexShader: skyVertexShader,
    fragmentShader: skySurfaceShader,
    uniforms: sky.uniforms,
    defines: { ...sceneryOceanDefines(sky), SKY_AT_FAR: '' },
    side: DoubleSide,
    depthTest: false,
    depthWrite: false,
    // Blended without being `transparent`, so it stays in the opaque list, after the background.
    // ⚠️ Alpha as three's normal blending does, or the canvas turns see-through here.
    blending: CustomBlending,
    blendSrc: SrcAlphaFactor,
    blendDst: OneMinusSrcAlphaFactor,
    blendSrcAlpha: OneFactor,
    blendDstAlpha: OneMinusSrcAlphaFactor,
  });
}
