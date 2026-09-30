import { BufferGeometry, Shape, ShapeGeometry } from 'three';
import { computePlanarXZUv, computeUpwardNormals } from './geometry-attributes';
import { refineInteriorEdges } from './tessellation';

/**
 * How densely a {@link createPolygonCap} fills its outline.
 *
 * The two knobs are alternatives: `resolution` is a target in world units and
 * refines adaptively toward it, `passes` is a fixed number of uniform passes.
 * Neither touches the BOUNDARY, so the cap's rim is the outline it was given,
 * vertex for vertex, at any density (see {@link refineInteriorEdges}).
 *
 * @group Geometries
 */
export type PolygonCapOptions = {
  /** height of the plane (scene Y). Default 0. */
  y?: number;
  /**
   * Target interior edge length in world units — an edge is left alone once it
   * is this short. 0 or omitted leaves the interior as the triangulator made it,
   * which is the fewest triangles that fill the outline.
   */
  resolution?: number;
  /** Fixed uniform refinement passes, when a target length is not what is wanted. */
  passes?: number;
  /**
   * Cap on the adaptive passes, so a `resolution` far below the outline's own
   * scale cannot run away. Default 8.
   */
  maxPasses?: number;
  /**
   * Map the outline's second coordinate to `-z` instead of `+z` — the
   * northing-negating frame the ocean builders work in. Default false, which is
   * the common scene XZ frame.
   */
  flipZ?: boolean;
};

/**
 * A flat, horizontal cap filling a polygon outline.
 *
 * Triangulated straight from the outline (ear clipping, so any topology of
 * components and holes is reproduced exactly and nothing is dropped), then
 * refined on the INTERIOR only. That is what makes it safe to build a lid
 * independently of whatever it sits on: its boundary is still the outline's own
 * vertices, so a wall extruded from the same outline stays sealed to it however
 * finely — or coarsely — the middle is filled.
 *
 * @param shapes the outline, as `PlanarPolygonGeometry.toShapes()`
 * @param options see {@link PolygonCapOptions}
 *
 * @group Geometries
 */
export function createPolygonCap(
  shapes: Shape[],
  options: PolygonCapOptions = {},
): BufferGeometry {
  const cap = new ShapeGeometry(shapes);
  cap.rotateX(options.flipZ ? -Math.PI / 2 : Math.PI / 2);
  if (options.resolution && options.resolution > 0) {
    refineInteriorEdges(cap, options.maxPasses ?? 8, options.resolution);
  } else if (options.passes && options.passes > 0) {
    refineInteriorEdges(cap, options.passes);
  }
  computePlanarXZUv(cap);
  computeUpwardNormals(cap);
  if (options.y) cap.translate(0, options.y, 0);
  return cap;
}
