import { useEffect, useMemo, useState } from 'react'
import { CircleGeometry, Color, DoubleSide, ShaderMaterial, Texture, Uniform, Vector2 } from 'three'
import { useWellboreContext } from '../../../hooks/useWellboreContext'
import { SymbolsType } from '../../../sdk/data/types/Symbol'
import { queue } from '../../../sdk/utils/limiter'
import { useGenerator } from '../../../hooks/useGenerator'
import { positionMarkers } from './position-markers-defs'
import { Symbols } from '../../Symbol/Symbol'
import { createLayers, LAYERS } from '../../../layers/layers'
import { PI2 } from '../../../sdk/utils/trigonometry'
import vertexShader from '../../Grids/Grid/shaders/vertex.glsl'
import fragmentShader from '../../Grids/Grid/shaders/fragment.glsl'

/**
 * Test
 */

type Props = {
  radius?: number
  opacity?: number
  interval?: number
  priority?: number
}

export const PositionMarkers = ({
  radius = 20,
  opacity = 1.0,
  interval = 100,
  priority = 0,
}: Props) => {
  //const positionRef = useRef<Object3D>(null!)
  const { id, fromMsl } = useWellboreContext()
  const generator = useGenerator<SymbolsType>(positionMarkers)

  const [data, setData] = useState<SymbolsType | null>(null)

  const geometry = useMemo(() => {
    //const g = new RingGeometry(1, 0.5, radialSegments, radialSegments)
    const g = new CircleGeometry(1, 128)
    g.rotateX(-PI2)
    return g
  }, [])

  const material = useMemo(() => {
    const uniforms = {
      uSize: new Uniform(new Vector2(0, 0)),
      uBackground: new Uniform(new Color(0x808080)),
      uBackgroundOpacity: new Uniform(0),
      uOpacity: new Uniform(1.0),
      uCellSize: new Uniform(10),
      uSubDivisions: new Uniform(5),
      uOriginOffset: new Uniform(new Vector2(0, 0)),
      uDistanceFactor: new Uniform(0),
      uGridColorMajor: new Uniform(new Color("#fff")),
      uGridColorMinor: new Uniform(new Color("#ccc")),
      uGridLineWidth: new Uniform(0.001),
      uAxesOffset: new Uniform(new Vector2(0, 0)),
      uAxesColor: new Uniform(new Color("#c77")),
      uAxesLineWidth: new Uniform(1),
      uAxesTickSize: new Uniform(0.1),
      uProjectionTexture: new Uniform<Texture | undefined>(undefined),
    }
    const m = new ShaderMaterial({
      vertexShader,
      fragmentShader,
      uniforms,
      defines: {
        RADIAL: true,
        DYNAMICSEGMENTS: false,
        AXES: false,
        RULERS: false,
      },
      side: DoubleSide,
      depthWrite: true,
      transparent: true,
    })
    //const m = new MeshBasicMaterial({ side: DoubleSide})
    return m
  }, [])

  const layers = useMemo(() => createLayers(LAYERS.NOT_EMITTER), [])

  useEffect(() => {
    if (generator && id) {
      queue(() => generator(
        id,
        radius,
        interval,
        fromMsl,
      ).then(response => {
        setData(response)
      }), priority)
    }
  }, [generator, id, fromMsl, radius, interval, priority])

  useEffect(() => {
    material.uniforms.uSize.value.set(radius * 2, radius * 2)
    material.uniforms.uOpacity.value = opacity
  }, [radius, opacity, material])

  return (
    <group renderOrder={999}>
      {data && <Symbols data={data} geometry={geometry} material={material} layers={layers} />}
    </group>
  )
}