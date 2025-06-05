import { useTexture } from '@react-three/drei'
import { extend, useFrame } from '@react-three/fiber'
import { MeshLineGeometry, MeshLineMaterial } from 'meshline'
import { useEffect, useMemo, useState } from 'react'
import { DataTexture, DoubleSide, LinearFilter, Texture, Uniform, Vector2 } from 'three'
import { createConfig, GlyphConfig, MsdfFontJson } from '../../sdk/utils/glyphs'
import { get } from '../../storybook/dependencies/api'
import fragmentShader from './shaders/fragment.glsl'
import vertexShader from './shaders/vertex.glsl'

extend({ MeshLineGeometry, MeshLineMaterial })

const WIDTH = 800
const HEIGHT = 600

type Props = {
  text: string
  inBias?: number
  outBias?: number
  fontSize?: number
  rotation?: number
  spacing?: number
  verticalAlign?: number
  horizontalAlign?: number
}

const fileName = 'OpenSans-Regular'


export const SDFTest = ({ text, inBias = 0, outBias = 0, fontSize = 32, rotation = 0, spacing = 0, verticalAlign = 0.0, horizontalAlign = 0.0 }: Props) => {

  const glyphAtlas = useTexture(`./glyphs/${fileName}.png`, (tex: Texture) => {
    tex.generateMipmaps = false
    tex.magFilter = LinearFilter
    tex.minFilter = LinearFilter
    tex.flipY = true
  })

  const [glyphConfig, setGlyphConfig] = useState<GlyphConfig | null>()

  useEffect(() => {
    get(`./glyphs/${fileName}.json`).then((json: MsdfFontJson) => {
      setGlyphConfig(createConfig(json))
    }).catch(() => setGlyphConfig(null))
  }, [])

  const uniforms = useMemo(() => {
    return {
      time: new Uniform(0),
      size: new Uniform(new Vector2(WIDTH, HEIGHT)),
      textPointersOffset: new Uniform(0),
      textPointersCount: new Uniform(0),
      glyphAtlas: new Uniform<Texture | null>(null),
      textTexture: new Uniform<DataTexture | null>(null),
      in_bias: new Uniform(0),
      out_bias: new Uniform(0),
      fontSize: new Uniform(32),
      rotation: new Uniform(0),
      spacing: new Uniform(0),
      verticalAlign: new Uniform(0.0),
      horizontalAlign: new Uniform(0.0),
      digits: new Uniform([0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0])
    }
  }, [])

  useEffect(() => {
    if (glyphConfig) {
      if (uniforms.textTexture.value) {
        uniforms.textTexture.value.dispose()
      }
      const { texture, textPointersOffset, textPointersCount } = glyphConfig.encodeTextTexture(text.split('\n'))
      uniforms.textTexture.value = texture
      uniforms.textPointersOffset.value = textPointersOffset
      uniforms.textPointersCount.value = textPointersCount
      uniforms.digits.value = [...glyphConfig.encodeText('0123456789.-').indices]
    }
    
    return () => {
      if (glyphConfig) {
        glyphConfig.dispose()
      }
    }
  }, [uniforms, glyphConfig, text])

  useEffect(() => {
    uniforms.glyphAtlas.value = glyphAtlas    
    uniforms.in_bias.value = inBias
    uniforms.out_bias.value = outBias
    uniforms.fontSize.value = fontSize
    uniforms.rotation.value = rotation
    uniforms.spacing.value = spacing
    uniforms.verticalAlign.value = verticalAlign
    uniforms.horizontalAlign.value = horizontalAlign
  }, [uniforms, glyphAtlas, glyphConfig, inBias, outBias, fontSize, rotation, spacing, verticalAlign, horizontalAlign])

  useFrame(({ clock }) => {
    uniforms.time.value = clock.elapsedTime
  })

  if (!glyphConfig) return null

  return (
    <group>
      <mesh>
        <planeGeometry args={[WIDTH, HEIGHT]} /> 
        {/* <cylinderGeometry args={[WIDTH / 2, WIDTH / 2, HEIGHT]} />
        {/* <icosahedronGeometry args={[WIDTH, 32]} /> */}
        <shaderMaterial
          defines={{
            GLYPHS_LENGTH: glyphConfig.glyphsCount,
          }}
          uniforms={uniforms}
          uniformsGroups={[glyphConfig.glyphData]}
          vertexShader={vertexShader}
          fragmentShader={fragmentShader}
          side={DoubleSide}
        />
      </mesh>
      
    </group>
  )
}