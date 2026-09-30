import {
  Box3,
  BufferAttribute,
  BufferGeometry,
  Sphere,
  TypedArray,
  Vector3,
} from 'three';
// TODO: Add support for InterleavedBufferAttribute and InstancedBufferGeometry
export type BufferAttributeDrawRange = {
  start: number;
  count: number;
};

export type BufferAttributeGroups = (BufferAttributeDrawRange & {
  materialIndex?: number | undefined;
})[];

export type BufferAttributeLike = {
  array: TypedArray;
  itemSize: number;
  normalized?: boolean;
};

export type BufferGeometryLike = {
  [index: string]: any;
  drawRange?: BufferAttributeDrawRange | undefined;
  groups?: BufferAttributeGroups | undefined;
  attributes: Record<string, BufferAttributeLike>;
  index?: ArrayBufferLike | undefined;
  userData?: any;
};

export type PackedBufferAttribute = {
  buffer: ArrayBufferLike;
  attributeType: string;
  itemSize: number;
  /** integer components that read back as [-1,1] / [0,1] (see `BufferAttribute.normalized`) */
  normalized?: boolean;
};

export type PackedAttributes = Record<string, PackedBufferAttribute>;

/**
 * A geometry's bounding volumes, serialized as plain numbers so they survive a
 * pack/transfer. Carried because a geometry that has no `position` attribute (a
 * split-cap layout that assembles its position in the shader) cannot have three
 * derive one on the main thread — without it the mesh is frustum-culled the
 * moment the local origin leaves the view.
 */
export type PackedBounds = {
  sphere?: { center: [number, number, number]; radius: number };
  box?: {
    min: [number, number, number];
    max: [number, number, number];
  };
};

export type PackedBufferGeometry = {
  drawRange: BufferAttributeDrawRange;
  groups: BufferAttributeGroups;
  attributes: PackedAttributes;
  index: ArrayBufferLike | undefined;
  indexType: string | undefined;
  userData?: any;
  bounds?: PackedBounds;
};

export type PackedBufferGeometryCollection = Record<
  string,
  PackedBufferGeometry
>;

export function getTypedArrayType(array: ArrayBufferLike | TypedArray) {
  if (array.constructor === Uint8Array) return 'Uint8Array';
  if (array.constructor === Uint16Array) return 'Uint16Array';
  if (array.constructor === Uint32Array) return 'Uint32Array';
  if (array.constructor === Int8Array) return 'Int8Array';
  if (array.constructor === Int16Array) return 'Int16Array';
  if (array.constructor === Int32Array) return 'Int32Array';
  if (array.constructor === Float32Array) return 'Float32Array';
  if (array.constructor === Float64Array) return 'Float64Array';
  throw Error('Unsupported typed array!');
}

export function getTypedArrayFromBuffer(buffer: ArrayBufferLike, type: string) {
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

export function packAttribute(
  typedArray: TypedArray,
  itemSize: number = 1,
  normalized = false,
): PackedBufferAttribute {
  const packed = {
    buffer: typedArray.buffer,
    attributeType: getTypedArrayType(typedArray),
    itemSize: itemSize,
    normalized,
  };
  return packed;
}

/** Serialize a geometry's bounding volumes, or `undefined` if it has none. */
export function packBounds(geometry: BufferGeometry): PackedBounds | undefined {
  const { boundingSphere, boundingBox } = geometry;
  if (!boundingSphere && !boundingBox) return undefined;
  const bounds: PackedBounds = {};
  if (boundingSphere) {
    const { center, radius } = boundingSphere;
    bounds.sphere = { center: [center.x, center.y, center.z], radius };
  }
  if (boundingBox) {
    const { min, max } = boundingBox;
    bounds.box = {
      min: [min.x, min.y, min.z],
      max: [max.x, max.y, max.z],
    };
  }
  return bounds;
}

/** Restore packed bounding volumes onto a geometry (see {@link packBounds}). */
export function unpackBounds(
  geometry: BufferGeometry,
  bounds: PackedBounds | undefined,
): void {
  if (!bounds) return;
  if (bounds.sphere) {
    const { center, radius } = bounds.sphere;
    geometry.boundingSphere = new Sphere(
      new Vector3(center[0], center[1], center[2]),
      radius,
    );
  }
  if (bounds.box) {
    const { min, max } = bounds.box;
    geometry.boundingBox = new Box3(
      new Vector3(min[0], min[1], min[2]),
      new Vector3(max[0], max[1], max[2]),
    );
  }
}

export function packBufferGeometryLike(
  geometry: BufferGeometryLike,
): [PackedBufferGeometry, ArrayBufferLike[]] {
  const transferrables: ArrayBufferLike[] = [];
  const packed: PackedBufferGeometry = {
    drawRange: geometry.drawRange || { start: 0, count: Infinity },
    groups: geometry.groups || [],
    attributes: {},
    index: geometry.index,
    indexType: geometry.index ? getTypedArrayType(geometry.index) : undefined,
    userData: geometry.userData
      ? structuredClone(geometry.userData)
      : undefined,
  };

  for (const name in geometry.attributes) {
    packed.attributes[name] = packAttribute(
      geometry.attributes[name].array,
      geometry.attributes[name].itemSize,
      geometry.attributes[name].normalized,
    );
    transferrables.push(packed.attributes[name].buffer);
  }

  return [packed, transferrables];
}

export function packBufferGeometry(
  bufferGeometry: BufferGeometry,
): [PackedBufferGeometry, ArrayBufferLike[]] {
  const transferrables: ArrayBufferLike[] = [];
  const packed: PackedBufferGeometry = {
    drawRange: bufferGeometry.drawRange,
    groups: bufferGeometry.groups,
    attributes: {},
    index: undefined,
    indexType: undefined,
  };
  const indexAttr = bufferGeometry.getIndex();

  if (indexAttr) {
    packed.index = indexAttr.array.buffer;
    packed.indexType = getTypedArrayType(indexAttr.array);
  }

  for (const name in bufferGeometry.attributes) {
    const attr = bufferGeometry.getAttribute(name);
    packed.attributes[name] = {
      buffer: attr.array.buffer,
      attributeType: getTypedArrayType(attr.array),
      itemSize: attr.itemSize,
      normalized: attr.normalized,
    };
    transferrables.push(packed.attributes[name].buffer);
  }

  if (bufferGeometry.userData) {
    packed.userData = structuredClone(bufferGeometry.userData);
  }

  packed.bounds = packBounds(bufferGeometry);

  return [packed, transferrables];
}

export function packBufferGeometries(
  bufferGeometries: Record<string, BufferGeometry>,
) {
  const data: PackedBufferGeometryCollection = {};
  const transferrables: ArrayBufferLike[] = [];

  for (const key in bufferGeometries) {
    const bufferGeometry = bufferGeometries[key];
    const packed = packBufferGeometry(bufferGeometry);
    data[key] = packed[0];
    if (packed[1].length) {
      transferrables.push(...packed[1]);
    }
  }
  return { data, transferrables };
}

export function unpackBufferGeometry(packed: PackedBufferGeometry) {
  const bufferGeometry = new BufferGeometry();

  if (packed.index) {
    const index = getTypedArrayFromBuffer(
      packed.index!,
      packed.indexType || 'Uint32Array',
    );
    const indexAttr = new BufferAttribute(index!, 1);
    bufferGeometry.setIndex(indexAttr);
  }

  for (const name in packed.attributes) {
    const attr = new BufferAttribute(
      getTypedArrayFromBuffer(
        packed.attributes[name].buffer,
        packed.attributes[name].attributeType,
      ),
      packed.attributes[name].itemSize,
      packed.attributes[name].normalized,
    );
    bufferGeometry.setAttribute(name, attr);
  }

  bufferGeometry.drawRange = packed.drawRange;
  bufferGeometry.groups = packed.groups;

  if (packed.userData) {
    bufferGeometry.userData = packed.userData;
  }

  unpackBounds(bufferGeometry, packed.bounds);

  return bufferGeometry;
}

export function unpackBufferGeometries(data: PackedBufferGeometryCollection) {
  const geometries: Record<string, BufferGeometry> = {};

  for (const key in data) {
    const bufferGeometry = new BufferGeometry();

    if (data[key].index) {
      const index = getTypedArrayFromBuffer(
        data[key].index!,
        data[key].indexType || 'Uint32Array',
      );
      const indexAttr = new BufferAttribute(index!, 1);
      bufferGeometry.setIndex(indexAttr);
    }

    for (const name in data[key].attributes) {
      const attr = new BufferAttribute(
        getTypedArrayFromBuffer(
          data[key].attributes[name].buffer,
          data[key].attributes[name].attributeType,
        ),
        data[key].attributes[name].itemSize,
      );
      bufferGeometry.setAttribute(name, attr);
    }

    bufferGeometry.drawRange = data[key].drawRange;
    bufferGeometry.groups = data[key].groups;
    geometries[key] = bufferGeometry;
  }

  return geometries;
}
