import { BufferAttribute, InstancedBufferGeometry } from 'three';

/**
 * The ring every segment of a tube drawn in the vertex shader is instanced from
 * (`tube-segment.glsl`; `Trajectory`, `GeoTubes`): a single wall, `radialSegments` sides,
 * between the segment's two ends. Per vertex:
 *
 * - `vertex`: x its place around the ring (0…1), y along the segment (0 the start, 1 the
 *   end), z its radial scale (1 on the wall; the shader multiplies the radius by it);
 * - `capSign`: 0 for the wall, whose normal is radial (caps use ±1).
 *
 * Its triangles face outward (`FrontSide`). Add the per-segment instance attributes, and set
 * `instanceCount`, to draw.
 *
 * @group Geometries
 */
export function createTubeSegmentGeometry(
  radialSegments: number,
): InstancedBufferGeometry {
  const radialPositions = radialSegments + 1;
  const nVertices = radialPositions * 2;
  const vertices = new Float32Array(nVertices * 3);
  const capSigns = new Float32Array(nVertices);
  const indices = new Uint32Array(radialSegments * 6);

  for (let i = 0; i < radialPositions; i++) {
    const x = i / radialSegments;
    const j = i * 2 * 3;
    // The end (y = 1), then the start (y = 0).
    vertices[j] = x;
    vertices[j + 1] = 1;
    vertices[j + 2] = 1;
    vertices[j + 3] = x;
    vertices[j + 4] = 0;
    vertices[j + 5] = 1;
  }

  // Winding mirrors the Casings' outer ring, so the faces point outward.
  for (let i = 0; i < radialSegments; i++) {
    const vo = i * 2;
    const j = i * 6;
    indices[j] = vo;
    indices[j + 1] = vo + 1;
    indices[j + 2] = vo + 3;
    indices[j + 3] = vo;
    indices[j + 4] = vo + 3;
    indices[j + 5] = vo + 2;
  }

  const geometry = new InstancedBufferGeometry();
  geometry.setIndex(new BufferAttribute(indices, 1));
  geometry.setAttribute('vertex', new BufferAttribute(vertices, 3));
  geometry.setAttribute('capSign', new BufferAttribute(capSigns, 1));
  geometry.instanceCount = 0;
  return geometry;
}
