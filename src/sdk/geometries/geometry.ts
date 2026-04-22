import { BufferAttribute, BufferGeometry } from 'three';

export type GeometryAttribute = {
  array: number[];
  itemSize: number;
  type: string;
};

export type GeometryData = {
  positions: number[];
  indices: number[];
  vertexCount: number;
  indexCount: number;
  attributes: Record<string, GeometryAttribute>;
};

function getTypedArrayFromBuffer(buffer: number[], type: string) {
  switch (type) {
    case 'Uint8Array':
      return new Uint8Array(buffer);
    case 'Uint16Array':
      return new Uint16Array(buffer);
    case 'Uint32Array':
      return new Uint32Array(buffer);
    case 'Int8Array':
      return new Int8Array(buffer);
    case 'Int16Array':
      return new Int16Array(buffer);
    case 'Int32Array':
      return new Int32Array(buffer);
    case 'Float32Array':
      return new Float32Array(buffer);
    case 'Float64Array':
      return new Float64Array(buffer);
    default:
      throw Error('Unsupported typed array!');
  }
}

export function mergeGeometries(geometries: GeometryData[], useGroups = false) {
  if (!geometries.length) return null;

  if (geometries.length === 1) return { geometry: geometries[0], groups: null };

  const mergedGeometry: GeometryData = {
    positions: Array.from(geometries[0].positions),
    indices: Array.from(geometries[0].indices),
    vertexCount: geometries[0].vertexCount,
    indexCount: geometries[0].indexCount,
    attributes: {},
  };

  for (const key in geometries[0].attributes) {
    mergedGeometry.attributes[key] = {
      array: Array.from(geometries[0].attributes[key].array),
      itemSize: geometries[0].attributes[key].itemSize,
      type: geometries[0].attributes[key].type,
    };
  }

  const groups: number[][] | null = useGroups ? [] : null;

  let indexOffset = mergedGeometry.vertexCount;
  let indexStart = 0;

  if (groups) {
    const count = mergedGeometry.indexCount;
    groups.push([indexStart, count, groups.length]);
    indexStart += count;
  }

  for (let i = 1; i < geometries.length; i++) {
    const g = geometries[i];
    if (groups) {
      const count = g.indexCount;
      groups.push([indexStart, count, groups.length]);
      indexStart += count;
    }
    mergedGeometry.positions = mergedGeometry.positions.concat(g.positions);
    for (let j = 0; j < g.indices.length; j++) {
      mergedGeometry.indices.push(indexOffset + g.indices[j]);
    }

    mergedGeometry.vertexCount += g.vertexCount;
    mergedGeometry.indexCount += g.indexCount;

    for (const key in mergedGeometry.attributes) {
      if (!g.attributes || !g.attributes[key]) {
        throw Error(`Attribute '${key}' missing in geometry`);
      }
      mergedGeometry.attributes[key].array = mergedGeometry.attributes[
        key
      ].array.concat(g.attributes[key].array);
    }
    indexOffset += g.vertexCount;

    g.vertexCount = 0;
    g.indexCount = 0;
  }

  return { geometry: mergedGeometry, groups };
}

export function toBufferGeometry(
  geometries: GeometryData[],
  useGroups = false,
) {
  const merged = mergeGeometries(geometries, useGroups);

  if (!merged) return null;

  const { geometry, groups } = merged;

  const bufferGeometry = new BufferGeometry();

  if (groups) {
    groups.forEach(group => {
      bufferGeometry.addGroup(group[0], group[1], group[2]);
    });
  }

  bufferGeometry.setAttribute(
    'position',
    new BufferAttribute(Float32Array.from(geometry.positions), 3),
  );

  for (const key in geometry.attributes) {
    const attr = geometry.attributes[key];
    const array = getTypedArrayFromBuffer(attr.array, attr.type);
    bufferGeometry.setAttribute(key, new BufferAttribute(array, attr.itemSize));
  }

  const indices =
    geometry.indices.length < 65_535
      ? Uint16Array.from(geometry.indices)
      : Uint32Array.from(geometry.indices);

  bufferGeometry.setIndex(new BufferAttribute(indices, 1));

  return bufferGeometry;
}
