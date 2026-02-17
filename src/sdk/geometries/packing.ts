import { BufferAttribute, BufferGeometry, TypedArray } from 'three/webgpu'
// TODO: Add support for InterleavedBufferAttribute and InstancedBufferGeometry
export type BufferAttributeDrawRange = {
  start: number
  count: number
}

export type BufferAttributeGroups = (BufferAttributeDrawRange & {
  materialIndex?: number | undefined
})[]

export type BufferAttributeLike = {
  array: TypedArray
  itemSize: number
}

export type BufferGeometryLike = {
  [index: string]: any
  drawRange?: BufferAttributeDrawRange | undefined
  groups?: BufferAttributeGroups | undefined
  attributes: Record<string, BufferAttributeLike>
  index?: ArrayBufferLike | undefined
  userData?: any
}

export type PackedBufferAttribute = {
  buffer: ArrayBufferLike
  attributeType: string
  itemSize: number
}

export type PackedAttributes = Record<string, PackedBufferAttribute>

export type PackedBufferGeometry = {
  drawRange: BufferAttributeDrawRange
  groups: BufferAttributeGroups
  attributes: PackedAttributes
  index: ArrayBufferLike | undefined
  indexType: string | undefined
  userData?: any
}

export type PackedBufferGeometryCollection = Record<
  string,
  PackedBufferGeometry
>

export function getTypedArrayType(array: ArrayBufferLike | TypedArray) {
  if (array.constructor === Uint8Array) return 'Uint8Array'
  if (array.constructor === Uint16Array) return 'Uint16Array'
  if (array.constructor === Uint32Array) return 'Uint32Array'
  if (array.constructor === Int8Array) return 'Int8Array'
  if (array.constructor === Int16Array) return 'Int16Array'
  if (array.constructor === Int32Array) return 'Int32Array'
  if (array.constructor === Float32Array) return 'Float32Array'
  if (array.constructor === Float64Array) return 'Float64Array'
  throw Error('Unsupported typed array!')
}

export function getTypedArrayFromBuffer(buffer: ArrayBufferLike, type: string) {
  switch (type) {
    case 'Uint8Array':
      return new Uint8Array(buffer)
    case 'Uint16Array':
      return new Uint16Array(buffer)
    case 'Uint32Array':
      return new Uint32Array(buffer)
    case 'Int8Array':
      return new Int8Array(buffer)
    case 'Int16Array':
      return new Int16Array(buffer)
    case 'Int32Array':
      return new Int32Array(buffer)
    case 'Float32Array':
      return new Float32Array(buffer)
    case 'Float64Array':
      return new Float64Array(buffer)
    default:
      throw Error('Unsupported typed array!')
  }
}

export function packAttribute(
  typedArray: TypedArray,
  itemSize: number = 1,
): PackedBufferAttribute {
  const packed = {
    buffer: typedArray.buffer,
    attributeType: getTypedArrayType(typedArray),
    itemSize: itemSize,
  }
  return packed
}

export function packBufferGeometryLike(
  geometry: BufferGeometryLike,
): [PackedBufferGeometry, ArrayBufferLike[]] {
  const transferrables: ArrayBufferLike[] = []
  const packed: PackedBufferGeometry = {
    drawRange: geometry.drawRange || { start: 0, count: Infinity },
    groups: geometry.groups || [],
    attributes: {},
    index: geometry.index,
    indexType: geometry.index ? getTypedArrayType(geometry.index) : undefined,
    userData: geometry.userData
      ? structuredClone(geometry.userData)
      : undefined,
  }

  for (const name in geometry.attributes) {
    packed.attributes[name] = packAttribute(
      geometry.attributes[name].array,
      geometry.attributes[name].itemSize,
    )
    transferrables.push(packed.attributes[name].buffer)
  }

  return [packed, transferrables]
}

export function packBufferGeometry(
  bufferGeometry: BufferGeometry,
): [PackedBufferGeometry, ArrayBufferLike[]] {
  const transferrables: ArrayBufferLike[] = []
  const packed: PackedBufferGeometry = {
    drawRange: bufferGeometry.drawRange,
    groups: bufferGeometry.groups,
    attributes: {},
    index: undefined,
    indexType: undefined,
  }
  const indexAttr = bufferGeometry.getIndex()

  if (indexAttr) {
    packed.index = indexAttr.array.buffer
    packed.indexType = getTypedArrayType(indexAttr.array)
  }

  for (const name in bufferGeometry.attributes) {
    const attr = bufferGeometry.getAttribute(name)
    packed.attributes[name] = {
      buffer: attr.array.buffer,
      attributeType: getTypedArrayType(attr.array),
      itemSize: attr.itemSize,
    }
    transferrables.push(packed.attributes[name].buffer)
  }

  if (bufferGeometry.userData) {
    packed.userData = structuredClone(bufferGeometry.userData)
  }

  return [packed, transferrables]
}

export function packBufferGeometries(bufferGeometries: BufferGeometry[]) {
  const data: PackedBufferGeometryCollection = {}
  const transferrables: ArrayBufferLike[] = []

  for (const key in bufferGeometries) {
    const bufferGeometry = bufferGeometries[key]
    const packed = packBufferGeometry(bufferGeometry)
    data[key] = packed[0]
    if (packed[1].length) {
      transferrables.push(...packed[1])
    }
  }
  return { data, transferrables }
}

export function unpackBufferGeometry(packed: PackedBufferGeometry) {
  const bufferGeometry = new BufferGeometry()

  if (packed.index) {
    const index = getTypedArrayFromBuffer(
      packed.index!,
      packed.indexType || 'Uint32Array',
    )
    const indexAttr = new BufferAttribute(index!, 1)
    bufferGeometry.setIndex(indexAttr)
  }

  for (const name in packed.attributes) {
    const attr = new BufferAttribute(
      getTypedArrayFromBuffer(
        packed.attributes[name].buffer,
        packed.attributes[name].attributeType,
      ),
      packed.attributes[name].itemSize,
    )
    bufferGeometry.setAttribute(name, attr)
  }

  bufferGeometry.drawRange = packed.drawRange
  bufferGeometry.groups = packed.groups

  if (packed.userData) {
    bufferGeometry.userData = packed.userData
  }

  return bufferGeometry
}

export function unpackBufferGeometries(data: PackedBufferGeometryCollection) {
  const geometries: Record<string, BufferGeometry> = {}

  for (const key in data) {
    const bufferGeometry = new BufferGeometry()

    if (data[key].index) {
      const index = getTypedArrayFromBuffer(
        data[key].index!,
        data[key].indexType || 'Uint32Array',
      )
      const indexAttr = new BufferAttribute(index!, 1)
      bufferGeometry.setIndex(indexAttr)
    }

    for (const name in data[key].attributes) {
      const attr = new BufferAttribute(
        getTypedArrayFromBuffer(
          data[key].attributes[name].buffer,
          data[key].attributes[name].attributeType,
        ),
        data[key].attributes[name].itemSize,
      )
      bufferGeometry.setAttribute(name, attr)
    }

    bufferGeometry.drawRange = data[key].drawRange
    bufferGeometry.groups = data[key].groups
    geometries[key] = bufferGeometry
  }

  return geometries
}
