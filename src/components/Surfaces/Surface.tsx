import { useEffect, useMemo, useRef, useState } from 'react'
import { useGenerator } from '../../hooks/useGenerator'
import { surfaceGeneratorResponse, surfaceGeometry } from './surface-defs'
import { BackSide, BufferGeometry, DataTexture, DoubleSide, FrontSide, LinearFilter, Mesh, MeshBasicMaterial, Texture } from 'three'
import { createLayers, LAYERS } from '../../layers/layers'
import { queue } from '../../sdk/utils/limiter'
import { unpackBufferGeometry } from '../../sdk/geometries/packing'
import { SurfaceMeta } from '../../sdk/data/types/SurfaceMeta'
import { ContourColorMode, SurfaceMaterial } from './SurfaceMaterial'
import { useData } from '../../hooks/useData'
import { toRGB } from '../../sdk/utils/numbers'
import { createNormalTexture } from './normal-texture'
import { EventEmitterCallback, useEventEmitter } from '../Handlers/EventEmitter/EventEmitterContext'
import { PointerEvents } from '../../events/interaction-events'
import { Vec2 } from '../../sdk/types/common'
import { CommonComponentProps } from '../common'

/**
 * Surface props
 * @expand
 */
export type SurfaceProps = CommonComponentProps & PointerEvents & {
  meta: SurfaceMeta
  color?: string
  colorRamp?: number
  rampMin?: number
  rampMax?: number
  reverseRamp?: boolean
  useColorRamp?: boolean
  showContours?: boolean
  contoursInterval?: number
  contoursColorMode?: ContourColorMode
  contoursColorModeFactor?: number
  contoursThickness?: number
  contoursColor?: string
  opacity?: number
  priority?: number
  maxError?: number
  doubleSide?: boolean
  wireframe?: boolean,
  normalMap?: Texture,
  normalScale?: Vec2,
}


/**
 * This component renderes a TIN model from an elevation map, according to the `SurfaceMeta` and `SurfaveValues` data types.
 * 
 * It has several customization options for rendering the surfaces, including color ramps, contour lines and transparency.
 * 
 * Surface values are expected to be in a regular grid. An optimized triangulation is used for the geometry, but color ramp 
 * values and contour lines are always using the full resolution of the data for accuracy. 
 * 
 * The surface requires the `SurfaceMeta` type as input data. It will fetch the `SurfaceValues` on the component side
 * from the store. This is because the component will need this data to generate a data texture and calculate normals at a 
 * higher resolution than the generated geometry.
 * 
 * @example
 * <Surface meta={meta} />
 * 
 * @group Components
 */
export const Surface = ({
  meta,
  color,
  colorRamp = 0,
  rampMin,
  rampMax,
  reverseRamp = false,
  useColorRamp = true,
  showContours = false,
  contoursInterval = 100,
  contoursColorMode = ContourColorMode.darken,
  contoursColorModeFactor = 0.5,
  contoursThickness = 0.8,
  contoursColor = 'black',
  opacity = 1,
  priority = 0,
  maxError = 5,
  doubleSide = opacity === 1 || false,
  wireframe = false,
  normalMap,
  normalScale,
  name,
  userData,
  receiveShadow,
  castShadow,
  layers = createLayers(LAYERS.OCCLUDER),
  position,
  renderOrder = 10,
  visible = true,
  onPointerClick,
  onPointerEnter,
  onPointerLeave,
  onPointerMove,
}: SurfaceProps) => {
  const ref = useRef<Mesh>(null!)
  const generator = useGenerator<surfaceGeneratorResponse>(surfaceGeometry)
  const store = useData()

  const [ready, setReady] = useState(false)
  const [geometry, setGeometry] = useState<BufferGeometry | null>(null)
  const [depthTexture, setDepthTexture] = useState<DataTexture | null>(null)
  const [normals, setNormals] = useState<DataTexture | null>(null)

  const notEmitterLayers = useMemo(() => createLayers(LAYERS.NOT_EMITTER), [])

  const material = useMemo(() => {
    const m = new SurfaceMaterial({
      useColorRamp: true,
      forceSinglePass: true,
      saturation: 1,
      brightness: 0,
      colorRampIndex: 0,
      colorRampReverse: false,
      colorRampMin: meta.displayMin,
      colorRampMax: meta.displayMax,
      referenceDepth: meta.max,
      normalMap,
      side: FrontSide,
      wireframe: false,
      flatShading: false,
      transparent: true,
      opacity: 1,
    })
    
    return m
  }, [meta, normalMap])

  /* This is used to write back-side faces to the depth buffer to avoid self-transparency issues when opacity < 1 */
  const maskMaterial = useMemo(() => {
    const m = new MeshBasicMaterial({
      transparent: true,
      side: BackSide,
      colorWrite: false,
      depthWrite: true,
    })
    return m
  }, [])

  const eventHandler = useEventEmitter()

  // register event handlers
  useEffect(() => {
    let unregister: (() => void) | null = null
    if (ready && eventHandler && ref.current) {
      const handlers: Record<string, EventEmitterCallback> = {}

      if (onPointerClick) handlers.click = onPointerClick
      if (onPointerEnter) handlers.enter = onPointerEnter
      if (onPointerLeave) handlers.leave = onPointerLeave
      if (onPointerMove) handlers.move = onPointerMove

      if (Object.keys(handlers).length) {
        unregister = eventHandler.register(ref.current, handlers, meta.id)
      }
    }

    return () => {
      if (unregister) unregister()
    }
  }, [eventHandler, onPointerClick, onPointerEnter, onPointerLeave, onPointerMove, ready, meta.id])
  
  useEffect(() => {
    material.uniforms.colorRampIndex.value = colorRamp
    material.uniforms.opacity.value = opacity
    material.uniforms.contoursColorMode.value = contoursColorMode
    material.uniforms.contoursColorModeFactor.value = contoursColorModeFactor
    material.uniforms.contoursInterval.value = contoursInterval
    material.uniforms.contoursThickness.value = contoursThickness
    material.uniforms.colorRampMin.value = rampMin
    material.uniforms.colorRampMax.value = rampMax
    material.uniforms.colorRampReverse.value = reverseRamp
    if (normalScale) {
      material.uniforms.normalScale.value.set(...normalScale)
    }
  }, [
    material,
    colorRamp,
    opacity,
    showContours,
    contoursColorMode,
    contoursColorModeFactor,
    contoursInterval,
    contoursThickness,
    rampMin,
    rampMax,
    reverseRamp,
    normalScale
  ])

  useEffect(() => {
    material.wireframe = wireframe
    material.showContours = showContours
    material.contoursColor = contoursColor
    material.useColorRamp = useColorRamp
    material.color = color || material.color
    material.side = doubleSide ? DoubleSide : FrontSide
  }, [
    material,
    useColorRamp,
    showContours,
    wireframe,
    contoursColor,
    color,
    doubleSide,
  ])

  useEffect(() => {
    if (store) {
      store.get<Float32Array>('surface-values', meta.id).then(response => {
        if (response && response instanceof Float32Array) {
          const colorData = new Uint8Array(response.length * 4)
          for (let i = 0; i < response.length; i++) {
            const v = response[i]
            const rgb = v === -1 ? [0, 0, 0] : toRGB(v)
            const j = i * 4
            colorData[j] = rgb[0]
            colorData[j + 1] = rgb[1]
            colorData[j + 2] = rgb[2]
            colorData[j + 3] = v === -1 ? 0 : 255
          }
          const tex = new DataTexture(colorData, meta.header.nx, meta.header.ny)
          tex.minFilter = LinearFilter
          tex.magFilter = LinearFilter
          //tex.anisotropy = 4
          tex.needsUpdate = true
          tex.flipY = true

          const normalTexture = createNormalTexture(response, meta.header.nx, meta.header.xinc, meta.header.yinc, meta.header.rot)
          
          setNormals(prev => {
            if (prev) prev.dispose()
            return normalTexture || prev
          })
          setDepthTexture(prev => {
            if (prev) prev.dispose()
            return tex || prev
          })
        }
      })
    }
  }, [store, meta.id, meta.header.nx, meta.header.ny, meta.header.xinc, meta.header.yinc, meta.header.rot])

  useEffect(() => {
    setReady(false)
    if (generator) {
      queue(() => generator(meta.id, maxError).then((response) => {
        let bufferGeometry: BufferGeometry | null = null
        if (response) {
          bufferGeometry = unpackBufferGeometry(response)
        }
        setGeometry(prev => {
          if (prev) prev.dispose()
          return bufferGeometry || prev
        })
        setReady(true)
      }), priority)

    }
  }, [generator, meta, maxError, priority])

  useEffect(() => {
    if (depthTexture && material) {
      material.uniforms.depthTexture.value = depthTexture
    }
  }, [depthTexture, material])

  useEffect(() => {
    if (normals && material) {
      material.uniforms.normalTexture.value = normals
    }
  }, [normals, material])

  useEffect(() => {
    return () => {
      material.normalMap?.dispose()
      material.dispose()
    }
  }, [material])

  if (!ready || !geometry || !meta) return null

  return (
    <group
      name={name}
      userData={userData}
      visible={visible}
      renderOrder={renderOrder}
      position={position}
    >
      { opacity < 1 && (
        <mesh
          ref={ref}
          geometry={geometry}
          material={maskMaterial}
          renderOrder={1}
          layers={notEmitterLayers}
        />
      )}
      <mesh
        ref={ref}
        castShadow={castShadow}
        receiveShadow={receiveShadow}
        geometry={geometry}
        material={material}
        layers={layers}
        renderOrder={2}
      />
    </group>
  )
}
