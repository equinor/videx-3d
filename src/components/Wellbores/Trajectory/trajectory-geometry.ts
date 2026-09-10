import {
  BufferAttribute,
  InstancedBufferGeometry,
  InstancedInterleavedBuffer,
  InterleavedBufferAttribute,
  Sphere,
} from 'three';
import { TrajectorySegmentsType } from './trajectory-defs';

// position(3) + tangent(3) + normal(3) + curvePosition(1)
const STRIDE = 10;

/**
 * Builds an instanced single-wall tube geometry for a trajectory at the given radial
 * resolution. The per-segment centerline data is shared as an interleaved instanced
 * buffer (mirroring the Casings pattern): endpoint A reads from offset 0 and endpoint
 * B reads STRIDE floats ahead, so consecutive curve positions form each segment.
 *
 * Radius is applied in the vertex shader, so the SAME segment data can drive multiple
 * radial-resolution LODs (call this once per LOD).
 */
export function createTrajectoryGeometry(
  section: TrajectorySegmentsType,
  radialSegments: number,
) {
  const attributesBuffer = new InstancedInterleavedBuffer(
    section.attributesBuffer,
    STRIDE,
    1,
  );

  const radialPositions = radialSegments + 1;
  const nVertices = radialPositions * 2;

  // vertex.x = position around the ring (0..1), vertex.y = along the segment (0=A,
  // 1=B), vertex.z = radial scale (always 1 for the wall; the shader multiplies the
  // radius by it). capSign is 0 for the wall (radial normal); caps use ±1.
  const vertices = new Float32Array(nVertices * 3);
  const capSigns = new Float32Array(nVertices);
  const indices = new Uint32Array(radialSegments * 6);

  for (let i = 0; i < radialPositions; i++) {
    const x = i / radialSegments;
    const j = i * 2 * 3;

    // endpoint B (y = 1)
    vertices[j] = x;
    vertices[j + 1] = 1;
    vertices[j + 2] = 1;

    // endpoint A (y = 0)
    vertices[j + 3] = x;
    vertices[j + 4] = 0;
    vertices[j + 5] = 1;
  }

  // winding mirrors the Casings outer ring so faces point outward (FrontSide)
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
  geometry.instanceCount = section.segments - 1;
  geometry.setIndex(new BufferAttribute(indices, 1));
  geometry.setAttribute('vertex', new BufferAttribute(vertices, 3));
  geometry.setAttribute('capSign', new BufferAttribute(capSigns, 1));

  geometry.setAttribute(
    'positionA',
    new InterleavedBufferAttribute(attributesBuffer, 3, 0),
  );
  geometry.setAttribute(
    'tangentA',
    new InterleavedBufferAttribute(attributesBuffer, 3, 3),
  );
  geometry.setAttribute(
    'normalA',
    new InterleavedBufferAttribute(attributesBuffer, 3, 6),
  );
  geometry.setAttribute(
    'curvePositionA',
    new InterleavedBufferAttribute(attributesBuffer, 1, 9),
  );

  geometry.setAttribute(
    'positionB',
    new InterleavedBufferAttribute(attributesBuffer, 3, STRIDE + 0),
  );
  geometry.setAttribute(
    'tangentB',
    new InterleavedBufferAttribute(attributesBuffer, 3, STRIDE + 3),
  );
  geometry.setAttribute(
    'normalB',
    new InterleavedBufferAttribute(attributesBuffer, 3, STRIDE + 6),
  );
  geometry.setAttribute(
    'curvePositionB',
    new InterleavedBufferAttribute(attributesBuffer, 1, STRIDE + 9),
  );

  const boundingSphere = new Sphere();
  boundingSphere.center.set(...section.boundingSphere.center);
  boundingSphere.radius = section.boundingSphere.radius;
  geometry.boundingSphere = boundingSphere;

  return geometry;
}

/**
 * Builds the two solid end-cap discs for a trajectory tube as a single-instance
 * geometry. Endpoint A samples the FIRST curve position and endpoint B the LAST
 * (offset by `(segments - 1) * STRIDE`), so `vertex.y` selects the start (0) or end
 * (1) frame. Each cap is a triangle fan (one centre vertex + a rim ring); the shared
 * vertex shader places the centre on the centreline (`vertex.z = 0`) and the rim on
 * the tube's end ring (`vertex.z = 1`), and orients the flat normal along the segment
 * tangent via `capSign` (-1 start, +1 end). Wound for `FrontSide` (start faces
 * -tangent, end faces +tangent).
 */
export function createTrajectoryCapsGeometry(
  section: TrajectorySegmentsType,
  radialSegments: number,
) {
  const attributesBuffer = new InstancedInterleavedBuffer(
    section.attributesBuffer,
    STRIDE,
    1,
  );
  // Endpoint B reads the last curve position so a single instance spans the whole tube.
  const bOffset = (section.segments - 1) * STRIDE;

  const radialPositions = radialSegments + 1;
  // per cap: 1 centre + radialPositions rim vertices
  const perCap = radialPositions + 1;
  const nVertices = perCap * 2;

  const vertices = new Float32Array(nVertices * 3);
  const capSigns = new Float32Array(nVertices);
  const indices = new Uint32Array(radialSegments * 2 * 3);

  const startCentre = 0;
  const startRim = 1;
  const endCentre = perCap;
  const endRim = perCap + 1;

  // start cap centre — frame A (vertex.y = 0), on the centreline (vertex.z = 0)
  vertices[startCentre * 3 + 1] = 0;
  capSigns[startCentre] = -1;

  // end cap centre — frame B (vertex.y = 1), on the centreline (vertex.z = 0)
  vertices[endCentre * 3 + 1] = 1;
  capSigns[endCentre] = 1;

  for (let i = 0; i < radialPositions; i++) {
    const x = i / radialSegments;

    // start rim (frame A)
    let j = (startRim + i) * 3;
    vertices[j] = x;
    vertices[j + 1] = 0;
    vertices[j + 2] = 1;
    capSigns[startRim + i] = -1;

    // end rim (frame B)
    j = (endRim + i) * 3;
    vertices[j] = x;
    vertices[j + 1] = 1;
    vertices[j + 2] = 1;
    capSigns[endRim + i] = 1;
  }

  // Winding calibrated against the wall geometry (front-facing outward on FrontSide):
  // (centre, rim_i, rim_{i+1}) faces +tangent. The start cap must face -tangent
  // (reversed), the end cap +tangent (forward).
  let t = 0;
  for (let i = 0; i < radialSegments; i++) {
    // start cap (outward normal = -tangent): reversed winding
    indices[t++] = startCentre;
    indices[t++] = startRim + i + 1;
    indices[t++] = startRim + i;
  }
  for (let i = 0; i < radialSegments; i++) {
    // end cap (outward normal = +tangent): forward winding
    indices[t++] = endCentre;
    indices[t++] = endRim + i;
    indices[t++] = endRim + i + 1;
  }

  const geometry = new InstancedBufferGeometry();
  geometry.instanceCount = 1;
  geometry.setIndex(new BufferAttribute(indices, 1));
  geometry.setAttribute('vertex', new BufferAttribute(vertices, 3));
  geometry.setAttribute('capSign', new BufferAttribute(capSigns, 1));

  geometry.setAttribute(
    'positionA',
    new InterleavedBufferAttribute(attributesBuffer, 3, 0),
  );
  geometry.setAttribute(
    'tangentA',
    new InterleavedBufferAttribute(attributesBuffer, 3, 3),
  );
  geometry.setAttribute(
    'normalA',
    new InterleavedBufferAttribute(attributesBuffer, 3, 6),
  );
  geometry.setAttribute(
    'curvePositionA',
    new InterleavedBufferAttribute(attributesBuffer, 1, 9),
  );

  geometry.setAttribute(
    'positionB',
    new InterleavedBufferAttribute(attributesBuffer, 3, bOffset + 0),
  );
  geometry.setAttribute(
    'tangentB',
    new InterleavedBufferAttribute(attributesBuffer, 3, bOffset + 3),
  );
  geometry.setAttribute(
    'normalB',
    new InterleavedBufferAttribute(attributesBuffer, 3, bOffset + 6),
  );
  geometry.setAttribute(
    'curvePositionB',
    new InterleavedBufferAttribute(attributesBuffer, 1, bOffset + 9),
  );

  const boundingSphere = new Sphere();
  boundingSphere.center.set(...section.boundingSphere.center);
  boundingSphere.radius = section.boundingSphere.radius;
  geometry.boundingSphere = boundingSphere;

  return geometry;
}
