import {
  DataTexture,
  RedIntegerFormat,
  Uniform,
  UniformsGroup,
  UnsignedShortType,
  Vector2,
  Vector3,
  Vector4
} from 'three'
import { Vec3 } from '../types/common'

export type Glyph = {
  position: [number, number]
  dimension: [number, number]
  offset: [number, number]
  spacing: number
}

export type EncodedTextSegment = {
  indices: number[]
  width: number
}

export type EncodedTextTexture = {
  texture: DataTexture
  textPointersOffset: number
  textPointersCount: number
}

export type GlyphConfig = {
  glyphsCount: number
  glyphData: UniformsGroup
  encodeText: (text: string) => EncodedTextSegment
  encodeTextTexture: (textSegments: string[] | string) => EncodedTextTexture
  dispose: () => void
}

export interface MsdfFontJson {
  info: {
    size: number
  }
  common: {
    scaleW: number
    scaleH: number
    lineHeight: number
    base: number
  }
  chars: {
    id: number
    index: number
    char: string
    width: number
    height: number
    xoffset: number
    yoffset: number
    xadvance: number
    x: number
    y: number
  }[]
  distanceField: {
    distanceRange: number
  }
}

export function createConfig(json: MsdfFontJson): GlyphConfig {
  const charMap = new Map(
    json.chars.map((c, i) => [c.id, { index: i, spacing: c.xadvance }])
  )
  const missingChar = 32

  const encodeText = (text: string): EncodedTextSegment => {
    const indices: number[] = []
    let width = 0

    for (let i = 0; i < text.length; i++) {
      let asciiCode = text.charCodeAt(i)
      if (!charMap.has(asciiCode)) {
        asciiCode = missingChar
      }
      const character = charMap.get(asciiCode)
      if (character) {
        indices.push(character.index)
        width += character.spacing
      }
    }
    return {
      indices,
      width,
    }
  }

  const createTextTexture = (textSegments: string[] | string) => {
    
    textSegments = Array.isArray(textSegments) ? textSegments : [textSegments]
    const pointers: Vec3[] = []

    const buffer: number[] = []
    for (let s = 0; s < textSegments.length; s++) {
      const text = textSegments[s]
      const encoded = encodeText(text)
      const segmentStart = buffer.length
      buffer.push(...encoded.indices)
      pointers.push([
        segmentStart,
        buffer.length,
        encoded.width,
      ])
    }

    if (!buffer.length) {
      buffer.push(0)
    }

    const textPointersOffset = buffer.length

    pointers.forEach(p => buffer.push(...p))

    const texture = new DataTexture(
      new Uint16Array(buffer),
      buffer.length,
      1,
      RedIntegerFormat,
      UnsignedShortType
    )
    //console.log(createUniformBuffer(new Uint8Array(buffer)))
    texture.needsUpdate = true
    
    return { texture, textPointersOffset, textPointersCount: pointers.length  }
  }

  const glyphData = new UniformsGroup()
  glyphData.setName('GlyphData')

  const positions: Uniform<Vector4>[] = []
  const offsets: Uniform<Vector3>[] = []

  json.chars.forEach((char) => {
    positions.push(
      new Uniform(new Vector4(char.x, char.y, char.width, char.height))
    )
    offsets.push(
      new Uniform(new Vector3(char.xoffset, char.yoffset, char.xadvance))
    )
  })
  glyphData.add(positions)
  glyphData.add(offsets)
  glyphData.add(
    new Uniform(new Vector2(json.common.scaleW, json.common.scaleH))
  )
  glyphData.add(new Uniform(json.info.size))
  glyphData.add(new Uniform(json.distanceField.distanceRange))
  glyphData.add(new Uniform(json.common.lineHeight))
  glyphData.add(new Uniform(json.common.base))

  const dispose = () => {
    glyphData.dispose()
  }

  const config: GlyphConfig = {
    glyphsCount: json.chars.length,
    glyphData,
    encodeText,
    encodeTextTexture: createTextTexture,
    dispose,
  }

  return config
}
