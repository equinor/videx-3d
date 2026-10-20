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
import { extractBoundaryLoops } from '../../sdk/geometries/boundary-loops';
import { createDelaunayCap } from '../../sdk/geometries/delaunay-cap';
import { computeUpwardNormals } from '../../sdk/geometries/geometry-attributes';
import {
  Coordinates2D,
  PlanarPolygonCoordinates,
  PlanarPolygonGeometry,
} from '../../sdk/geometries/planar-geometry';
import { ringsToPolygonCoordinates } from '../../sdk/geometries/polygon-outline';
import type { SeabedMesh } from '../../sdk/geometries/surface-clip';
import {
  applyFenceField,
  type CutUniforms,
} from '../../sdk/materials/fence-field';
import { Vec2 } from '../../sdk/types/common';
import { attachOitVariants } from '../../rendering/oit-material';
import skyVertexShader from './shaders/sky-vertex.glsl';
import skySurfaceShader from './shaders/sky-surface-fragment.glsl';
import fragmentShader from './shaders/stage-fragment.glsl';
import vertexShader from './shaders/stage-vertex.glsl';
import { SKY_SHARED_DEFINES, type SkyMaterial } from './sky-material';

/** `[minX, minZ, maxX, maxZ]` in scene X/Z. */
export type SkyStageBounds = [number, number, number, number];

/** Scene Y at every vertex of an outline, nested as its `coordinates` are. */
export type SkyStageElevations = number[][][];

/** A seabed's rim: its boundary as an outline, and the heights along it. */
export type SkyStageRim = {
  outline: PlanarPolygonGeometry;
  elevations: SkyStageElevations;
};

/**
 * The rectangle around an occupant that its relief, or the flat seabed around it, fills:
 * the outline's bounds grown by `margin`, held inside `extent`.
 */
export function skyStageNearBounds(
  extent: SkyStageBounds,
  outline: PlanarPolygonGeometry,
  margin: number,
): SkyStageBounds {
  const { min, max } = outline.getBounds();
  return [
    Math.max(min[0] - margin, extent[0] + 1),
    Math.max(min[1] - margin, extent[1] + 1),
    Math.min(max[0] + margin, extent[2] - 1),
    Math.min(max[1] + margin, extent[3] - 1),
  ];
}

/**
 * The whole stage, flat at y = 0: `bounds` as a grid, then rings out to `extent` (see
 * {@link createSkyStageRings}), in one mesh. The water lies on it, and so does the seabed
 * without an occupant.
 *
 * ⚠️ `bounds` must lie inside `extent`.
 */
export function createSkyStagePlane(
  bounds: SkyStageBounds,
  extent: SkyStageBounds,
): BufferGeometry {
  return createRings(bounds, extent, true);
}

/**
 * `extent` less `near`, flat at y = 0, as rings each about twice as wide as the one inside
 * it, so the triangles grow with their distance from `near`: huge ones crack where the GPU
 * clips them. Their inner edge is `near`'s perimeter, which the relief and the flat seabed
 * around an occupant share vertex for vertex.
 *
 * ⚠️ `near` must lie inside `extent`.
 */
export function createSkyStageRings(
  near: SkyStageBounds,
  extent: SkyStageBounds,
): BufferGeometry {
  return createRings(near, extent, false);
}

/**
 * The near rectangle less an occupant's `outline`, flat at y = 0: the seabed around the
 * occupant's own where no relief eases into it (see {@link createSkyStageRelief}). It
 * shares its boundary with the rings and with the outline vertex for vertex. Shaded per
 * pixel, so it needs no points inside.
 *
 * ⚠️ The outline must lie inside `near`.
 *
 * @param outline in scene X/Z, without an offset
 */
export function createSkyStageBed(
  near: SkyStageBounds,
  outline: PlanarPolygonGeometry,
): BufferGeometry {
  const components = outline.coordinates as PlanarPolygonCoordinates;
  return createDelaunayCap([
    perimeter(near),
    ...components.flat().map(openRing),
  ]);
}

/**
 * The seabed around an occupant with a seabed of its own, over the near rectangle less
 * the outline (see {@link skyStageNearBounds}): it starts on the outline at the
 * occupant's `elevations` and eases to `bedY` over `falloff`, in scene Y, with its normals.
 * Given the occupant's rim (see {@link skyStageRim}), it meets its seabed vertex for vertex.
 *
 * Along the outline the heights are blended by inverse distance to its segments, so the
 * slope stays smooth where the outline turns. The triangles are as fine as the outline at
 * it (down to `falloff / 96`) and grow away from it to `falloff / 12`; past `falloff` only
 * flat seabed is left.
 *
 * ⚠️ The near rectangle must reach `falloff` past the outline, so its rim is at `bedY`.
 */
export function createSkyStageRelief(
  near: SkyStageBounds,
  outline: PlanarPolygonGeometry,
  elevations: SkyStageElevations,
  bedY: number,
  falloff: number,
): BufferGeometry {
  const components = outline.coordinates as PlanarPolygonCoordinates;
  const rings = components.flat().map(openRing);
  const coarse = falloff / 12;
  const fine = Math.min(
    Math.max(medianSegmentLength(rings), falloff / 96),
    coarse,
  );
  const relief = createDelaunayCap([perimeter(near), ...rings], {
    points: gradedPoints(near, rings, fine, coarse, falloff + coarse),
  });
  const index = createOutlineIndex(components, elevations, falloff / 2);
  const position = relief.getAttribute('position') as BufferAttribute;
  for (let i = 0; i < position.count; i++) {
    position.setY(
      i,
      reliefHeight(index, position.getX(i), position.getZ(i), bedY, falloff),
    );
  }
  relief.computeVertexNormals();
  return relief;
}

/**
 * The rim of an occupant's seabed: its boundary loops, grouped into outer rings and
 * holes, with their heights. A relief built on it meets the seabed vertex for vertex (see
 * {@link createSkyStageRelief}).
 */
export function skyStageRim(seabed: SeabedMesh): SkyStageRim {
  const { positions } = seabed;
  const heights = new Map<Vec2[], number[]>();
  const rings = extractBoundaryLoops(seabedGeometry(seabed)).map(loop => {
    const ring = loop.map(
      i => [positions[3 * i], positions[3 * i + 2]] as Vec2,
    );
    heights.set(
      ring,
      loop.map(i => positions[3 * i + 1]),
    );
    return ring;
  });
  const coordinates = ringsToPolygonCoordinates(rings);
  return {
    outline: new PlanarPolygonGeometry(coordinates),
    elevations: coordinates.map(component =>
      component.map(ring => heights.get(ring as Vec2[]) ?? []),
    ),
  };
}

/**
 * An occupant's seabed as a stage draws it: the arrays wrapped, not copied, with normals
 * of its own, facing up. Disposing it leaves the arrays to their owner.
 */
export function createSkyStageSeabed(seabed: SeabedMesh): BufferGeometry {
  const geometry = seabedGeometry(seabed);
  computeUpwardNormals(geometry);
  return geometry;
}

function seabedGeometry({ positions, indices }: SeabedMesh) {
  const geometry = new BufferGeometry();
  geometry.setAttribute('position', new BufferAttribute(positions, 3));
  geometry.setIndex(new BufferAttribute(indices, 1));
  return geometry;
}

// Closer than this to the outline, a point is ON it and takes its elevation exactly.
const ON_OUTLINE = 0.05;

const OUTLINE_RIM = new Color('#ffffff');
const OUTLINE_SURFACE = new Color('#000000');
const OUTLINE_BOUNDS = new Color('#909090');

/**
 * Debug lines, as segments with vertex colours: the outline along its seabed rim (the
 * `elevations`, else `bedY`) in white and at the sea `level` in black, and `bounds` at
 * `bedY` in grey.
 */
export function createSkyStageOutline(
  bounds: SkyStageBounds,
  outline: PlanarPolygonGeometry | null,
  level: number,
  bedY: number,
  elevations?: SkyStageElevations | null,
): BufferGeometry {
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
  const components = (outline?.coordinates ?? []) as PlanarPolygonCoordinates;
  components.forEach((component, c) =>
    component.forEach((ring, r) => {
      const points = openRing(ring);
      loop(points, i => elevations?.[c]?.[r]?.[i] ?? bedY, OUTLINE_RIM);
      loop(points, () => level, OUTLINE_SURFACE);
    }),
  );
  loop(rectangle(bounds), () => bedY, OUTLINE_BOUNDS);
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
}

function rectangle([minX, minZ, maxX, maxZ]: SkyStageBounds): Coordinates2D {
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
function perimeter([minX, minZ, maxX, maxZ]: SkyStageBounds): Vec2[] {
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

// The rings from `inner` out to `outer`, and with `fill`, `inner` too, as a grid whose edge
// is the first ring's own vertices.
function createRings(
  inner: SkyStageBounds,
  outer: SkyStageBounds,
  fill: boolean,
): BufferGeometry {
  const first =
    Math.max(inner[2] - inner[0], inner[3] - inner[1]) / RING_SEGMENTS;
  const boundaries = [inner];
  for (let grow = first; ; grow = 2 * grow + first) {
    const ring: SkyStageBounds = [
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

  if (fill) {
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

function smoothstep(edge0: number, edge1: number, x: number) {
  const t = Math.min(Math.max((x - edge0) / (edge1 - edge0), 0), 1);
  return t * t * (3 - 2 * t);
}

type OutlineIndex = {
  /**
   * Calls `visit` for every outline segment within `reach` of (x, z), and possibly a few
   * beyond: its distance, the elevation at its nearest point, and its length.
   */
  near(
    x: number,
    z: number,
    reach: number,
    visit: (distance: number, height: number, length: number) => void,
  ): void;
};

function createOutlineIndex(
  components: PlanarPolygonCoordinates,
  elevations: SkyStageElevations,
  cell: number,
): OutlineIndex {
  const ax: number[] = [];
  const az: number[] = [];
  const ay: number[] = [];
  const bx: number[] = [];
  const bz: number[] = [];
  const by: number[] = [];
  components.forEach((component, c) =>
    component.forEach((ring, r) => {
      const points = openRing(ring);
      const heights = elevations[c]?.[r] ?? [];
      for (let i = 0; i < points.length; i++) {
        const j = (i + 1) % points.length;
        ax.push(points[i][0]);
        az.push(points[i][1]);
        ay.push(heights[i] ?? 0);
        bx.push(points[j][0]);
        bz.push(points[j][1]);
        by.push(heights[j] ?? 0);
      }
    }),
  );

  const count = ax.length;
  let x0 = Infinity;
  let z0 = Infinity;
  let x1 = -Infinity;
  let z1 = -Infinity;
  for (let s = 0; s < count; s++) {
    x0 = Math.min(x0, ax[s], bx[s]);
    z0 = Math.min(z0, az[s], bz[s]);
    x1 = Math.max(x1, ax[s], bx[s]);
    z1 = Math.max(z1, az[s], bz[s]);
  }
  // Never so fine that the grid itself becomes the cost.
  const size = Math.max(cell, (x1 - x0) / 512, (z1 - z0) / 512, 1e-3);
  const cols = Math.max(1, Math.floor((x1 - x0) / size) + 1);
  const rows = Math.max(1, Math.floor((z1 - z0) / size) + 1);
  const cells: number[][] = Array.from({ length: cols * rows }, () => []);
  for (let s = 0; s < count; s++) {
    const c0 = Math.floor((Math.min(ax[s], bx[s]) - x0) / size);
    const c1 = Math.floor((Math.max(ax[s], bx[s]) - x0) / size);
    const r0 = Math.floor((Math.min(az[s], bz[s]) - z0) / size);
    const r1 = Math.floor((Math.max(az[s], bz[s]) - z0) / size);
    for (let row = r0; row <= r1; row++) {
      for (let col = c0; col <= c1; col++) cells[row * cols + col].push(s);
    }
  }

  const stamp = new Int32Array(count);
  let query = 0;
  return {
    near(x, z, reach, visit) {
      query++;
      const c0 = Math.max(0, Math.floor((x - reach - x0) / size));
      const c1 = Math.min(cols - 1, Math.floor((x + reach - x0) / size));
      const r0 = Math.max(0, Math.floor((z - reach - z0) / size));
      const r1 = Math.min(rows - 1, Math.floor((z + reach - z0) / size));
      for (let row = r0; row <= r1; row++) {
        for (let col = c0; col <= c1; col++) {
          for (const s of cells[row * cols + col]) {
            if (stamp[s] === query) continue;
            stamp[s] = query;
            const dx = bx[s] - ax[s];
            const dz = bz[s] - az[s];
            const length2 = dx * dx + dz * dz;
            const t =
              length2 > 0
                ? Math.min(
                    Math.max(
                      ((x - ax[s]) * dx + (z - az[s]) * dz) / length2,
                      0,
                    ),
                    1,
                  )
                : 0;
            visit(
              Math.hypot(ax[s] + t * dx - x, az[s] + t * dz - z),
              ay[s] + t * (by[s] - ay[s]),
              Math.sqrt(length2),
            );
          }
        }
      }
    },
  };
}

// The occupant's edge, blended along the outline, eased to the flat seabed by distance.
function reliefHeight(
  index: OutlineIndex,
  x: number,
  z: number,
  bedY: number,
  falloff: number,
) {
  const reach = 2 * falloff;
  let nearest = Infinity;
  let exact = NaN;
  let sum = 0;
  let weight = 0;
  index.near(x, z, reach, (d, h, length) => {
    if (d < nearest) nearest = d;
    if (d < ON_OUTLINE) {
      exact = h;
    } else if (d < reach) {
      // Falls to zero at `reach`, so segments entering the search leave no seam.
      const w = length * (1 / (d * d) - 1 / (reach * reach));
      sum += w * h;
      weight += w;
    }
  });
  if (!(nearest < falloff)) return bedY;
  const edge = !Number.isNaN(exact) ? exact : weight > 0 ? sum / weight : bedY;
  return edge + (bedY - edge) * smoothstep(0, falloff, nearest);
}

// Rows of points at one spacing before it doubles.
const GRADED_ROWS = 3;

// Points to triangulate the near rectangle through, on square grids: `fine` apart at the
// outline, doubling every few rows to `coarse`, none past `reach` from the outline. Each
// keeps half its spacing clear of the outline and the rectangle's edge.
function gradedPoints(
  [minX, minZ, maxX, maxZ]: SkyStageBounds,
  rings: Vec2[][],
  fine: number,
  coarse: number,
  reach: number,
): Vec2[] {
  const points: Vec2[] = [];
  let from = 0;
  for (
    let spacing = fine;
    from < reach;
    spacing = Math.min(2 * spacing, coarse)
  ) {
    const to = spacing >= coarse ? reach : from + GRADED_ROWS * spacing;
    const columns = Math.floor((maxX - minX) / spacing);
    const rows = Math.floor((maxZ - minZ) / spacing);
    const nearest = new Float64Array(columns * rows).fill(Infinity);
    // Grid point (column, row) lies at min + (index + 0.5) * spacing.
    const first = (v: number, min: number) =>
      Math.max(0, Math.ceil((v - min) / spacing - 0.5));
    const last = (v: number, min: number, count: number) =>
      Math.min(count - 1, Math.floor((v - min) / spacing - 0.5));
    for (const ring of rings) {
      ring.forEach(([ax, az], i) => {
        const [bx, bz] = ring[(i + 1) % ring.length];
        const dx = bx - ax;
        const dz = bz - az;
        const length2 = dx * dx + dz * dz;
        const r1 = last(Math.max(az, bz) + to, minZ, rows);
        const c1 = last(Math.max(ax, bx) + to, minX, columns);
        for (let row = first(Math.min(az, bz) - to, minZ); row <= r1; row++) {
          const z = minZ + (row + 0.5) * spacing;
          for (
            let column = first(Math.min(ax, bx) - to, minX);
            column <= c1;
            column++
          ) {
            const x = minX + (column + 0.5) * spacing;
            const t =
              length2 > 0
                ? Math.min(
                    Math.max(((x - ax) * dx + (z - az) * dz) / length2, 0),
                    1,
                  )
                : 0;
            const d = Math.hypot(ax + t * dx - x, az + t * dz - z);
            const k = row * columns + column;
            if (d < nearest[k]) nearest[k] = d;
          }
        }
      });
    }
    for (let k = 0; k < nearest.length; k++) {
      const d = nearest[k];
      if (d < Math.max(from, spacing / 2)) continue;
      if (d >= to) continue;
      const column = k % columns;
      const row = (k - column) / columns;
      points.push([
        minX + (column + 0.5) * spacing,
        minZ + (row + 0.5) * spacing,
      ]);
    }
    from = to;
  }
  return points;
}

function medianSegmentLength(rings: Vec2[][]) {
  const lengths: number[] = [];
  for (const ring of rings) {
    ring.forEach(([x0, z0], i) => {
      const [x1, z1] = ring[(i + 1) % ring.length];
      lengths.push(Math.hypot(x1 - x0, z1 - z0));
    });
  }
  lengths.sort((a, b) => a - b);
  return lengths[lengths.length >> 1] ?? 0;
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
export type SkyStagePart = 'surface' | 'bed' | 'relief-bed' | 'occupant-bed';

/** How a stage's seabed part is drawn (see {@link createSkyStageMaterial}). */
export type SkyStageMaterialOptions = {
  /** at the sea's seabed opacity, as a transparent part; opaque otherwise */
  seeThrough?: boolean;
  /** an occupant bed's: the occupant's own cut, in the scene frame */
  cut?: CutUniforms;
};

function oceanDefines(sky: SkyMaterial) {
  const defines: Record<string, unknown> = { SKY_OCEAN: '', SKY_ABYSS: '' };
  for (const key of SKY_SHARED_DEFINES) {
    if (sky.defines[key] !== undefined) defines[key] = sky.defines[key];
  }
  return defines;
}

/**
 * A material for a stage's geometry, drawing the sky's own sea. It shares the sky
 * material's uniform objects, so it follows every change to the sky and its water.
 *
 * The sky shows what lies beyond the seabed through any gap in the stage (see
 * `skyOceanStaged`). The `relief` beds are shaded where the geometry lies rather than on
 * the flat seabed, and so is an `occupant` bed (see {@link createSkyStageSeabed}), which
 * a cutaway never cuts: it only takes the water over it. It is cut instead with the
 * occupant, by the `cut` it hands over (its uniform objects, in the scene frame). A
 * `seeThrough` seabed is drawn at the sea's seabed opacity (`SkyMaterial.oceanSeabedOpacity`);
 * the surface always is.
 * The transparent parts are wired for the `OITRenderPass`.
 * The seabed is lit by the scene's lights, as the sky's is; a seabed or sea that changes
 * the sky's defines (its detail, its waves) needs new materials.
 */
export function createSkyStageMaterial(
  sky: SkyMaterial,
  part: SkyStagePart,
  { seeThrough = false, cut }: SkyStageMaterialOptions = {},
) {
  const defines = oceanDefines(sky);
  const occupant = part === 'occupant-bed';
  const surface = part === 'surface';
  if (surface) defines.STAGE_SURFACE = '';
  else defines.STAGE_BED = '';
  if (occupant || part === 'relief-bed') defines.STAGE_RELIEF = '';
  if (occupant) defines.STAGE_OCCUPANT = '';
  if (!surface && seeThrough) defines.STAGE_SEE_THROUGH = '';

  // Inherits the sky's uniforms rather than copying them, so what the sky adds later reaches it too.
  let uniforms = sky.uniforms;
  if (occupant && (cut?.plane || cut?.fence)) {
    uniforms = Object.create(sky.uniforms) as typeof sky.uniforms;
    if (cut.plane) {
      defines.STAGE_SECTION = '';
      uniforms.sectionPlane = cut.plane;
    }
    if (cut.fence) {
      defines.STAGE_FENCE = '';
      applyFenceField(uniforms, cut.fence);
    }
  }

  const transparent = surface || seeThrough;
  const material = new ShaderMaterial({
    vertexShader,
    fragmentShader,
    uniforms,
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
 * background and blended over it. It shares the sky material's uniform objects.
 */
export function createSkySurfaceMaterial(sky: SkyMaterial) {
  return new ShaderMaterial({
    vertexShader: skyVertexShader,
    fragmentShader: skySurfaceShader,
    uniforms: sky.uniforms,
    defines: oceanDefines(sky),
    side: DoubleSide,
    depthTest: false,
    depthWrite: false,
    // Blended without being `transparent`, so it stays in the opaque list, before the scene.
    // ⚠️ Alpha as three's normal blending does, or the canvas turns see-through here.
    blending: CustomBlending,
    blendSrc: SrcAlphaFactor,
    blendDst: OneMinusSrcAlphaFactor,
    blendSrcAlpha: OneFactor,
    blendDstAlpha: OneMinusSrcAlphaFactor,
  });
}
