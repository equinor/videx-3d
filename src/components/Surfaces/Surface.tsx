import { useEffect, useMemo, useRef, useState } from 'react'
import { BufferGeometry, DataTexture, DoubleSide, FrontSide, Group, MeshBasicNodeMaterial, Texture } from 'three/webgpu'
import { PointerEvents } from '../../events/interaction-events'
import { useGenerator } from '../../hooks/useGenerator'
import { createLayers, LAYERS } from '../../layers/layers'
import { createElevationTexture, SurfaceMeta, unpackBufferGeometry, Vec2 } from '../../sdk'
import { CommonComponentProps } from '../common'
import { EventEmitterCallback, useEventEmitter } from '../EventEmitter/EventEmitterContext'
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
  debug?: boolean
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
  layers,
  position,
  renderOrder,
  visible = true,
  //debug = false,
  onPointerClick,
  onPointerEnter,
  onPointerLeave,
  onPointerMove,
}: SurfaceProps) => {
  const ref = useRef<Group>(null!)
  const geometryGenerator = useGenerator<SurfaceGeometryResponse>(surfaceGeometry, priority)
  const texturesGenerator = useGenerator<SurfaceTexturesResponse>(surfaceTextures, priority)

  const [geometry, setGeometry] = useState<BufferGeometry | null>(null)
  const [elevationTexture, setElevationTexture] = useState<DataTexture | null>(null)

  const notEmitterLayers = useMemo(() => createLayers(LAYERS.NOT_EMITTER), [])

  //const glyphContext = useContext(GlyphsContext)

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
      debug: false,
    })

    return m
  }, [])

  // useEffect(() => {
  //   if (debug && glyphContext) {
  //     material.uniformsGroups = [glyphContext.glyphData]
  //     material.defines.GLYPHS_LENGTH = glyphContext.glyphsCount
  //     material.uniforms.glyphAtlas.value = glyphContext.glyphAtlas
  //     material.uniforms.digits.value = [...glyphContext.encodeText('0123456789.-').indices]
  //   } else {
  //     material.uniformsGroups = []
  //     material.defines.GLYPHS_LENGTH = 1
  //     material.uniforms.glyphAtlas.value = null
  //     material.uniforms.digits.value = [0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0]
  //   }
  //   material.debug = debug
  //   material.needsUpdate = true
  //   material.uniformsNeedUpdate = true
  // }, [debug, material, glyphContext])

  /* This is used to write back-side faces to the depth buffer to avoid self-transparency issues when opacity < 1 */
  const maskMaterial = useMemo(() => {
    const m = new MeshBasicNodeMaterial({
      transparent: true,
      side: DoubleSide,
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
        unregister = eventHandler.register({ object: ref.current, handlers, ref: meta.id })
      }
    }

    return () => {
      if (unregister) unregister()
    }
  }, [eventHandler, onPointerClick, onPointerEnter, onPointerLeave, onPointerMove, meta.id])

  useEffect(() => {
    material.colorRampIndex = colorRamp
    material.opacity = opacity
    material.contoursColorMode = contoursColorMode
    material.contoursColorModeFactor = contoursColorModeFactor
    material.contoursInterval = contoursInterval
    material.contoursThickness = contoursThickness
    material.colorRampMin = rampMin
    material.colorRampMax = rampMax
    material.colorRampReverse = reverseRamp
    material.referenceDepth = meta.max
    material.size.set(meta.header.nx, meta.header.ny)
    material.scale.set(meta.header.xinc, meta.header.yinc)
    material.rotation = meta.header.rot * (Math.PI / 180)
    if (normalScale) {
      material.normalScale.set(...normalScale)
    }
  }, [
    material,
    meta,
    colorRamp,
    opacity,
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
    material.color.set(color || material.color)
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
      texturesGenerator(meta.id).then(response => {
        if (response) {
          const {
            elevationImageBuffer,
          } = response

          const elevationTexture = createElevationTexture(
            elevationImageBuffer,
            meta.header.nx,
            meta.header.ny,
          )

          setElevationTexture(prev => {
            if (prev) prev.dispose()
            return elevationTexture
          })

        }
      })
    }
  }, [texturesGenerator, meta])

  useEffect(() => {
    if (geometryGenerator) {
      geometryGenerator(meta.id, maxError).then((response) => {
        let bufferGeometry: BufferGeometry | null = null
        if (response) {
          bufferGeometry = unpackBufferGeometry(response)
        }
        setGeometry(prev => {
          if (prev) prev.dispose()
          return bufferGeometry
        })

      })
    }
  }, [geometryGenerator, meta.id, maxError])

  useEffect(() => {
    if (elevationTexture && material) {
      material.elevationTexture = elevationTexture
    }
  }, [elevationTexture, material])

  useEffect(() => {
    return () => {
      material.normalMap?.dispose()
      material.dispose()
    }
  }, [material])

  //if (debug && !glyphContext) return null

  return (
    <group
      ref={ref}
      name={name}
      userData={userData}
      visible={visible}

      position={position}
    >
      {(geometry && opacity < 1) && (
        <mesh
          geometry={geometry}
          material={maskMaterial}
          layers={notEmitterLayers}
          renderOrder={(renderOrder || 0) - 0.1}
        />
      )}
      {geometry && (<mesh
        castShadow={castShadow}
        receiveShadow={receiveShadow}
        geometry={geometry}
        material={material}
        layers={layers}
        renderOrder={renderOrder}
      />)}
    </group>
  )
}
