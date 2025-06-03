import { useEffect, useMemo, useRef, useState } from 'react'
import { BackSide, BufferGeometry, DataTexture, DoubleSide, FrontSide, Mesh, MeshBasicMaterial, Texture } from 'three'
import { PointerEvents } from '../../events/interaction-events'
import { useGenerator } from '../../hooks/useGenerator'
import { createLayers, LAYERS } from '../../layers/layers'
import { createElevationTexture, createNormalTexture, queue, SurfaceMeta, unpackBufferGeometry, Vec2 } from '../../sdk'
import { CommonComponentProps } from '../common'
import { EventEmitterCallback, useEventEmitter } from '../Handlers/EventEmitter/EventEmitterContext'
import { surfaceGeometry, SurfaceGeometryResponse, surfaceTextures, SurfaceTexturesResponse } from './surface-defs'
import { ContourColorMode, SurfaceMaterial } from './SurfaceMaterial'

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
  const geometryGenerator = useGenerator<SurfaceGeometryResponse>(surfaceGeometry)
  const texturesGenerator = useGenerator<SurfaceTexturesResponse>(surfaceTextures)

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
      colorRampMin: 0,
      colorRampMax: 0,
      referenceDepth: 0,
      side: FrontSide,
      wireframe: false,
      flatShading: false,
      transparent: true,
      opacity: 1,
    })

    return m
  }, [])

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
    if (eventHandler && ref.current) {
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
  }, [eventHandler, onPointerClick, onPointerEnter, onPointerLeave, onPointerMove, meta.id])

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
    material.uniforms.referenceDepth.value = meta.max
    if (normalScale) {
      material.uniforms.normalScale.value.set(...normalScale)
    }
  }, [
    material,
    meta.max,
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
    normalScale,
  ])

  useEffect(() => {
    material.wireframe = wireframe
    material.showContours = showContours
    material.contoursColor = contoursColor
    material.useColorRamp = useColorRamp
    material.color = color || material.color
    material.side = doubleSide ? DoubleSide : FrontSide
    if (normalMap) {
      material.normalMap = normalMap
    }
  }, [
    material,
    useColorRamp,
    showContours,
    wireframe,
    contoursColor,
    color,
    doubleSide,
    normalMap,
  ])

  useEffect(() => {
    if (texturesGenerator) {
      queue(() => texturesGenerator(meta.id).then(response => {
        if (response) {
          const {
            elevationImageBuffer,
            normalsImageBuffer,
          } = response
          
          const elevationTextures = createElevationTexture(
            elevationImageBuffer,
            meta.header.nx,
            meta.header.ny,
          )
          const normalTexture = createNormalTexture(
            normalsImageBuffer,
            meta.header.nx - 1,
            meta.header.ny - 1,
          )

          setDepthTexture(prev => {
            if (prev) prev.dispose()
            return elevationTextures
          })
          setNormals(prev => {
            if (prev) prev.dispose()
            return normalTexture
          })
        }
      }), priority)
    }
  }, [texturesGenerator, meta.id, meta.header.nx, meta.header.ny, priority])

  useEffect(() => {
    if (geometryGenerator) {
      queue(() => geometryGenerator(meta.id, maxError).then((response) => {
        let bufferGeometry: BufferGeometry | null = null
        if (response) {
          bufferGeometry = unpackBufferGeometry(response)
        }
        setGeometry(prev => {
          if (prev) prev.dispose()
          return bufferGeometry
        })

      }), priority)
    }
  }, [geometryGenerator, meta.id, maxError, priority])

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



  return (
    <group
      name={name}
      userData={userData}
      visible={visible}
      renderOrder={renderOrder}
      position={position}
    >
      {(geometry && opacity < 1) && (
        <mesh
          ref={ref}
          geometry={geometry}
          material={maskMaterial}
          renderOrder={1}
          layers={notEmitterLayers}
        />
      )}
      {geometry && (<mesh
        ref={ref}
        castShadow={castShadow}
        receiveShadow={receiveShadow}
        geometry={geometry}
        material={material}
        layers={layers}
        renderOrder={2}
      />)}
    </group>
  )
}
