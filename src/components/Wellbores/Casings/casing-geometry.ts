import {
  BufferAttribute,
  InstancedBufferGeometry,
  InstancedInterleavedBuffer,
  InterleavedBufferAttribute,
  Sphere,
  TypedArray,
} from 'three';
import { CasingSectionType } from './casings-defs';

function toBufferGeometry(
  attributesBuffer: InstancedInterleavedBuffer,
  indices: TypedArray,
  vertices: TypedArray,
  normals: TypedArray,
  uvs: TypedArray,
  ids: TypedArray,
  offset: number,
  instanceCount: number,
) {
  const geometry = new InstancedBufferGeometry();
  geometry.instanceCount = instanceCount;
  geometry.setIndex(new BufferAttribute(indices, 1));

  geometry.setAttribute('vertex', new BufferAttribute(vertices, 3));
  geometry.setAttribute('normal', new BufferAttribute(normals, 3));
  geometry.setAttribute('uv', new BufferAttribute(uvs, 2));
  geometry.setAttribute('id', new BufferAttribute(ids, 1));

  geometry.setAttribute(
    'positionA',
    new InterleavedBufferAttribute(attributesBuffer, 3, 0),
  );
  geometry.setAttribute(
    'normalA',
    new InterleavedBufferAttribute(attributesBuffer, 3, 3),
  );
  geometry.setAttribute(
    'tangentA',
    new InterleavedBufferAttribute(attributesBuffer, 3, 6),
  );
  geometry.setAttribute(
    'curvePositionA',
    new InterleavedBufferAttribute(attributesBuffer, 2, 9),
  );
  geometry.setAttribute(
    'outerRadiusA',
    new InterleavedBufferAttribute(attributesBuffer, 1, 11),
  );

  geometry.setAttribute(
    'positionB',
    new InterleavedBufferAttribute(attributesBuffer, 3, offset + 0),
  );
  geometry.setAttribute(
    'normalB',
    new InterleavedBufferAttribute(attributesBuffer, 3, offset + 3),
  );
  geometry.setAttribute(
    'tangentB',
    new InterleavedBufferAttribute(attributesBuffer, 3, offset + 6),
  );
  geometry.setAttribute(
    'curvePositionB',
    new InterleavedBufferAttribute(attributesBuffer, 2, offset + 9),
  );
  geometry.setAttribute(
    'outerRadiusB',
    new InterleavedBufferAttribute(attributesBuffer, 1, offset + 11),
  );

  return geometry;
}

function createTubeGeometry(
  attributesBuffer: InstancedInterleavedBuffer,
  curveSegments: number,
  radialSegments: number,
) {
  const radialPositions = radialSegments + 1;

  const vertexOffsets = {
    outerTube: 0,
    innerTube: radialPositions * 2,
    edge1: radialPositions * 4,
    edge2: radialPositions * 4 + 4,
  };

  const triangleOffsets = {
    outerTube: 0,
    innerTube: radialSegments * 2,
    edge1: radialSegments * 4,
    edge2: radialSegments * 4 + 2,
  };

  const nVertices = radialPositions * 8 + 8;

  const vertices = new Float32Array(nVertices * 3);
  const normals = new Float32Array(nVertices * 3);
  const uvs = new Float32Array(nVertices * 2);

  const ids = new Uint8Array(nVertices);

  let j = 0,
    k = 0;

  for (let i = 0; i < radialPositions; i++) {
    const u = i * 2;

    const x1 = i / radialSegments;
    const x2 = 1 - x1;

    // outer ring
    j = (u + vertexOffsets.outerTube) * 3;
    k = (u + vertexOffsets.outerTube) * 2;

    ids[u + vertexOffsets.outerTube] = 0; // upper outer ring

    vertices[j] = x1;
    vertices[j + 1] = 1;
    vertices[j + 2] = 1;

    normals[j] = 0;
    normals[j + 1] = 0;
    normals[j + 2] = 1;

    uvs[k] = x1;
    uvs[k + 1] = 1;

    ids[u + vertexOffsets.outerTube + 1] = 0; // lower outer ring

    vertices[j + 3] = x1;
    vertices[j + 4] = 0;
    vertices[j + 5] = 1;

    normals[j + 3] = 0;
    normals[j + 4] = 0;
    normals[j + 5] = 1;

    uvs[k + 2] = x1;
    uvs[k + 3] = 0;

    // inner ring
    j = (u + vertexOffsets.innerTube) * 3;
    k = (u + vertexOffsets.innerTube) * 2;

    ids[u + vertexOffsets.innerTube] = 1; // upper inner ring

    vertices[j] = x2;
    vertices[j + 1] = 1;
    vertices[j + 2] = 0;

    normals[j] = 0;
    normals[j + 1] = 0;
    normals[j + 2] = -1;

    uvs[k] = x1;
    uvs[k + 1] = 1;

    ids[u + vertexOffsets.innerTube + 1] = 1; // lower inner ring

    vertices[j + 3] = x2;
    vertices[j + 4] = 0;
    vertices[j + 5] = 0;

    normals[j + 3] = 0;
    normals[j + 4] = 0;
    normals[j + 5] = -1;

    uvs[k + 2] = x1;
    uvs[k + 3] = 0;
  }

  j = vertexOffsets.edge1 * 3;
  k = vertexOffsets.edge1 * 2;

  // side 1
  ids[vertexOffsets.edge1] = 4;

  vertices[j] = 0;
  vertices[j + 1] = 1;
  vertices[j + 2] = 0;

  normals[j] = -1;
  normals[j + 1] = 0;
  normals[j + 2] = 0;

  uvs[k] = 0;
  uvs[k + 1] = 1;

  ids[vertexOffsets.edge1 + 1] = 4;

  vertices[j + 3] = 0;
  vertices[j + 4] = 0;
  vertices[j + 5] = 0;

  normals[j + 3] = -1;
  normals[j + 4] = 0;
  normals[j + 5] = 0;

  uvs[k + 2] = 0;
  uvs[k + 3] = 0;

  ids[vertexOffsets.edge1 + 2] = 4;

  vertices[j + 6] = 0;
  vertices[j + 7] = 1;
  vertices[j + 8] = 1;

  normals[j + 6] = -1;
  normals[j + 7] = 0;
  normals[j + 8] = 0;

  uvs[k + 4] = 1;
  uvs[k + 5] = 1;

  ids[vertexOffsets.edge1 + 3] = 4;

  vertices[j + 9] = 0;
  vertices[j + 10] = 0;
  vertices[j + 11] = 1;

  normals[j + 9] = -1;
  normals[j + 10] = 0;
  normals[j + 11] = 0;

  uvs[k + 6] = 1;
  uvs[k + 7] = 0;

  // side 2
  ids[vertexOffsets.edge2] = 5;

  vertices[j + 12] = 1;
  vertices[j + 13] = 1;
  vertices[j + 14] = 1;

  normals[j + 12] = 1;
  normals[j + 13] = 0;
  normals[j + 14] = 0;

  uvs[k + 8] = 0;
  uvs[k + 9] = 1;

  ids[vertexOffsets.edge2 + 1] = 5;

  vertices[j + 15] = 1;
  vertices[j + 16] = 0;
  vertices[j + 17] = 1;

  normals[j + 15] = 1;
  normals[j + 16] = 0;
  normals[j + 17] = 0;

  uvs[k + 10] = 0;
  uvs[k + 11] = 0;

  ids[vertexOffsets.edge2 + 2] = 5;

  vertices[j + 18] = 1;
  vertices[j + 19] = 1;
  vertices[j + 20] = 0;

  normals[j + 18] = 1;
  normals[j + 19] = 0;
  normals[j + 20] = 0;

  uvs[k + 12] = 1;
  uvs[k + 13] = 1;

  ids[vertexOffsets.edge2 + 3] = 5;

  vertices[j + 21] = 1;
  vertices[j + 22] = 0;
  vertices[j + 23] = 0;

  normals[j + 21] = 1;
  normals[j + 22] = 0;
  normals[j + 23] = 0;

  uvs[k + 14] = 1;
  uvs[k + 15] = 0;

  const indices = new Uint32Array((radialSegments * 4 + 2) * 6);

  for (let i = 0; i < radialSegments; i++) {
    const u = i * 2;

    // outer ring
    j = (u + triangleOffsets.outerTube) * 3;
    const vo = vertexOffsets.outerTube + i * 2;
    indices[j] = vo;
    indices[j + 1] = vo + 1;
    indices[j + 2] = vo + 3;
    indices[j + 3] = vo;
    indices[j + 4] = vo + 3;
    indices[j + 5] = vo + 2;

    // inner ring
    j = (u + triangleOffsets.innerTube) * 3;
    const vi = vertexOffsets.innerTube + i * 2;
    indices[j] = vi;
    indices[j + 1] = vi + 1;
    indices[j + 2] = vi + 3;
    indices[j + 3] = vi;
    indices[j + 4] = vi + 3;
    indices[j + 5] = vi + 2;
  }

  // indices for sides
  j = triangleOffsets.edge1 * 3;
  const v1 = vertexOffsets.edge1;
  indices[j] = v1;
  indices[j + 1] = v1 + 1;
  indices[j + 2] = v1 + 3;
  indices[j + 3] = v1;
  indices[j + 4] = v1 + 3;
  indices[j + 5] = v1 + 2;

  const v2 = vertexOffsets.edge2;
  indices[j + 6] = v2;
  indices[j + 7] = v2 + 1;
  indices[j + 8] = v2 + 3;
  indices[j + 9] = v2;
  indices[j + 10] = v2 + 3;
  indices[j + 11] = v2 + 2;

  const geometry = toBufferGeometry(
    attributesBuffer,
    indices,
    vertices,
    normals,
    uvs,
    ids,
    attributesBuffer.stride,
    curveSegments - 1,
  );

  geometry.addGroup(0, radialSegments * 6, 0);
  geometry.addGroup(triangleOffsets.innerTube * 3, radialSegments * 6, 1);
  geometry.addGroup(triangleOffsets.edge1 * 3, 12, 2);

  return geometry;
}

function createCapsGeometry(
  attributesBuffer: InstancedInterleavedBuffer,
  curveSections: number,
  radialSegments: number,
) {
  const radialPositions = radialSegments + 1;

  const vertexOffsets = {
    top: 0,
    bottom: radialPositions * 2,
  };

  const triangleOffsets = {
    top: 0,
    bottom: radialSegments * 2,
  };

  const nVertices = radialPositions * 4;

  const vertices = new Float32Array(nVertices * 3);
  const normals = new Float32Array(nVertices * 3);
  const uvs = new Float32Array(nVertices * 2);

  const ids = new Uint8Array(nVertices);

  let j = 0,
    k = 0;
  for (let i = 0; i < radialPositions; i++) {
    const u = i * 2;

    const x1 = i / radialSegments;
    const x2 = 1 - x1;

    // top
    j = (u + vertexOffsets.top) * 3;
    k = (u + vertexOffsets.top) * 2;

    ids[u + vertexOffsets.top] = 2; // top outer ring

    vertices[j] = x1;
    vertices[j + 1] = 1;
    vertices[j + 2] = 0;

    normals[j] = 0;
    normals[j + 1] = 1;
    normals[j + 2] = 0;

    uvs[k] = x1;
    uvs[k + 1] = 0;

    ids[u + vertexOffsets.top + 1] = 2; // top inner ring

    vertices[j + 3] = x1;
    vertices[j + 4] = 1;
    vertices[j + 5] = 1;

    normals[j + 3] = 0;
    normals[j + 4] = 1;
    normals[j + 5] = 0;

    uvs[k + 2] = x1;
    uvs[k + 3] = 1;

    // bottom
    j = (u + vertexOffsets.bottom) * 3;
    k = (u + vertexOffsets.bottom) * 2;

    ids[u + vertexOffsets.bottom] = 3; // bottom outer ring

    vertices[j] = x2;
    vertices[j + 1] = 0;
    vertices[j + 2] = 0;

    normals[j] = 0;
    normals[j + 1] = -1;
    normals[j + 2] = 0;

    uvs[k] = x2;
    uvs[k + 1] = 1;

    ids[u + vertexOffsets.bottom + 1] = 3; // bottom inner ring

    vertices[j + 3] = x2;
    vertices[j + 4] = 0;
    vertices[j + 5] = 1;

    normals[j + 3] = 0;
    normals[j + 4] = -1;
    normals[j + 5] = 0;

    uvs[k + 2] = x2;
    uvs[k + 3] = 0;
  }

  const indices = new Uint32Array(radialSegments * 4 * 6);

  for (let i = 0; i < radialSegments; i++) {
    const u = i * 2;

    // top
    j = (u + triangleOffsets.top) * 3;
    const vt = vertexOffsets.top + i * 2;
    indices[j] = vt;
    indices[j + 1] = vt + 1;
    indices[j + 2] = vt + 3;
    indices[j + 3] = vt;
    indices[j + 4] = vt + 3;
    indices[j + 5] = vt + 2;

    // bottom
    j = (u + triangleOffsets.bottom) * 3;
    const vb = vertexOffsets.bottom + i * 2;
    indices[j] = vb;
    indices[j + 1] = vb + 1;
    indices[j + 2] = vb + 3;
    indices[j + 3] = vb;
    indices[j + 4] = vb + 3;
    indices[j + 5] = vb + 2;
  }

  return toBufferGeometry(
    attributesBuffer,
    indices,
    vertices,
    normals,
    uvs,
    ids,
    (curveSections - 1) * attributesBuffer.stride,
    1,
  );
}

export function createCasingSectionGeometries(
  section: CasingSectionType,
  radialSegments: number,
) {
  const attributesBuffer = new InstancedInterleavedBuffer(
    section.attributesBuffer,
    12,
    1,
  );

  const tubeGeometry = createTubeGeometry(
    attributesBuffer,
    section.segments,
    radialSegments,
  );
  const capsGeometry = createCapsGeometry(
    attributesBuffer,
    section.segments,
    radialSegments,
  );

  const boundingSphere = new Sphere();
  boundingSphere.center.set(...section.boundingSphere.center);
  boundingSphere.radius = section.boundingSphere.radius;

  tubeGeometry.boundingSphere = boundingSphere;
  capsGeometry.boundingSphere = boundingSphere;

  return { tubeGeometry, capsGeometry };
}
