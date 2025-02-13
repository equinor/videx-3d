import { ThreeEvent, useThree } from '@react-three/fiber'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import {
  BackSide,
  Color,
  DoubleSide,
  FrontSide,
  Group,
  HalfFloatType,
  LinearFilter,
  OrthographicCamera,
  Plane,
  Ray,
  ShaderMaterial,
  Texture,
  Uniform,
  Vector2,
  Vector3,
  WebGLRenderTarget
} from 'three'
import { clamp } from '../../../sdk'
import { Vec2, Vec3 } from '../../../sdk/types/common'
import { CommonComponentProps } from '../../common'
import { getGridPositionFromUV } from './grid-helpers'
import { GridAxesLabels } from './GridAxesLabels'
import fragmentShader from './shaders/fragment.glsl'
import vertexShader from './shaders/vertex.glsl'

/**
 * Grid props
 * @expand
 */
export type GridProps = CommonComponentProps & {
  plane: 'xz' | 'xy' | 'zy',
  size: Vec2,
  cellSize?: number,
  subDivisions?: number,
  gridOrigin?: Vec2,
  gridScale?: Vec2,
  background?: string | Color | number,
  backgroundOpacity?: number,
  opacity?: number,
  gridColorMajor?: string | number | Color,
  gridColorMinor?: string | number | Color,
  gridLineWidth?: number,
  showAxes?: boolean,
  showAxesLabels?: boolean,
  trimAxesLabels?: boolean,
  axesOffset?: Vec2,
  axesColor?: string | number | Color,
  axesLineWidth?: number,
  axesTickSize?: number,
  originValue?: Vec2,
  radial?: boolean,
  dynamicSegments?: boolean,
  showRulers?: boolean,
  rulerColor?: string | number | Color,
  rulerLineWidth?: number,
  rulerOpacity?: number,
  planeOffset?: number,
  dynamicCellSize?: boolean,
  cellSizeDistanceFactors?: number[][],
  side?: 'front' | 'back' | 'both',
  texture?: Texture,
  textureMix?: number,
  enableProjection?: boolean,
  projectionDistance?: number,
  projectionColor?: string | number | Color,
  projectionResolution?: number,
  projectionRefreshRate?: number,
  onRulerUpdate?: ((coords: Vec2 | null) => void) | null,
}

type Offsets = {
  originOffset: Vec2,
  axesOffset: Vec2,
}

const projectionMaterial = new ShaderMaterial()
const direction = new Vector3()
const ray = new Ray()

const defaultCellSizeDistanceFactors = [
  [0, 0.1],
  [2.5, 0.25],
  [5, 0.5],
  [10, 1],
  [25, 2.5],
  [50, 5],
  [100, 10],
  [250, 25],
  [500, 50],
  [999, 100]
]

/**
 * Renders an axis aligned grid plane (xz, xy or zy).   
 * 
 * @example
 * <Grid plane="xz" size={[1000, 1000]} cellSize={10} />
 * 
 * @remarks
 * The Grid component is very flexible and has many different options which allows you 
 * to customize both behaviours and appearances. See the storybook linked below for examples.
 * 
 * @see [Storybook](/videx-3d/?path=/docs/components-grids-grid--docs) 
 * 
 * @group Components
 */
export const Grid = ({
  plane,
  size,
  position = [0, 0, 0],
  gridOrigin,
  gridScale = [1, 1],
  cellSize = 10,
  subDivisions = 0,
  background = 0x102030,
  backgroundOpacity = 1,
  opacity = 1.0,
  gridColorMajor = "#89a",
  gridColorMinor = "#789",
  gridLineWidth = 0.05,
  showAxes = true,
  showAxesLabels = true,
  trimAxesLabels = false,
  axesOffset = undefined,
  axesColor = "#fff",
  axesLineWidth = (gridLineWidth || 0.05),
  axesTickSize = 0.1,
  originValue = [0, 0,],
  radial = false,
  dynamicSegments = false,
  showRulers = false,
  rulerColor = "#c59797",
  rulerLineWidth = 1,
  rulerOpacity = 0.5,
  planeOffset = 0,
  dynamicCellSize = false,
  cellSizeDistanceFactors = defaultCellSizeDistanceFactors,
  side = 'both',
  onRulerUpdate = null,
  texture,
  textureMix = 1,
  enableProjection = false,
  projectionDistance = 1000,
  projectionColor = "#456",
  projectionResolution = 1024,
  projectionRefreshRate = 100,
  name,
  userData,
  renderOrder,
  visible,
  castShadow,
  receiveShadow,
  layers,
}: GridProps) => {

  const [offsets, setOffsets] = useState<Offsets>({ originOffset: [0, 0], axesOffset: [0, 0] })
  const [cellSizeFactor, setCellSizeFactor] = useState(1)
  const gridPlane = useMemo(() => new Plane(), [])
  const worldPosition = useMemo(() => new Vector3(), [])
  const containerRef = useRef<Group>(null)
  const materialRef = useRef<ShaderMaterial>(null)
  const projectionCameraRef = useRef<OrthographicCamera>(null)

  const uniforms = useRef({
    uSize: new Uniform(new Vector2(0, 0)),
    uBackground: new Uniform(new Color(0x102030)),
    uBackgroundOpacity: new Uniform(1),
    uOpacity: new Uniform(1.0),
    uCellSize: new Uniform(10),
    uSubDivisions: new Uniform(0),
    uOriginOffset: new Uniform(new Vector2(0, 0)),
    uDistanceFactor: new Uniform(0),
    uGridColorMajor: new Uniform(new Color("#abc")),
    uGridColorMinor: new Uniform(new Color("#789")),
    uGridLineWidth: new Uniform(0.05),
    uAxesOffset: new Uniform(new Vector2(0, 0)),
    uAxesColor: new Uniform(new Color("#fff")),
    uAxesLineWidth: new Uniform(1),
    uAxesTickSize: new Uniform(0.1),
    uCursorPosition: new Uniform(new Vector2()),
    uRulerColor: new Uniform(new Color("#fff")),
    uRulerLineWidth: new Uniform(1),
    uRulerOpacity: new Uniform(0.5),
    uProjectionTexture: new Uniform<Texture | undefined>(undefined),
    uProjectionColor: new Uniform(new Color("#456")),
    uTexture: new Uniform<Texture | undefined>(undefined),
    uTextureMix: new Uniform(1),
  })


  const { controls, camera, gl, scene } = useThree()

  const planeOffsetPosition = useMemo<Vec3>(() => [
    (plane === 'zy' ? planeOffset : 0) + position[0],
    (plane === 'xz' ? planeOffset : 0) + position[1],
    (plane === 'xy' ? planeOffset : 0) + position[2],
  ], [plane, planeOffset, position])

  const scale: Vec2 = useMemo(() => {
    if (plane === 'xz') {
      return [gridScale[0], -gridScale[1]]
    } else if (plane === 'zy') {
      return [-gridScale[0], gridScale[1]]
    } else {
      return [...gridScale]
    }
  }, [gridScale, plane])

  const renderSide = useMemo(() => {
    if (side === 'back') return BackSide
    if (side === 'both') return DoubleSide
    return FrontSide
  }, [side])

  useEffect(() => {
    const container = containerRef.current
    if (container) {

      container.getWorldPosition(worldPosition)

      const newOffsets: Offsets = { originOffset: [0, 0], axesOffset: [0, 0] }

      if (gridOrigin) {
        // x = uv.x, z = -uv.y
        if (plane === 'xz') {
          newOffsets.originOffset[0] = (gridOrigin[0] - worldPosition.x)
          newOffsets.originOffset[1] = -(gridOrigin[1] - worldPosition.z)
        }
        // x = uv.x, y = uv.y
        else if (plane === 'xy') {
          newOffsets.originOffset[0] = (gridOrigin[0] - worldPosition.x)
          newOffsets.originOffset[1] = (gridOrigin[1] - worldPosition.y)
        }
        // z = -uv.x, y = uv.y
        else if (plane === 'zy') {
          newOffsets.originOffset[0] = -(gridOrigin[0] - worldPosition.z)
          newOffsets.originOffset[1] = (gridOrigin[1] - worldPosition.y)
        }
      } else {
        newOffsets.originOffset[0] = 0
        newOffsets.originOffset[1] = 0
      }

      if (axesOffset) {
        if (plane === 'xz') {
          newOffsets.axesOffset[0] = axesOffset[0] * gridScale[0] - newOffsets.originOffset[0]
          newOffsets.axesOffset[1] = -axesOffset[1] * gridScale[1] - newOffsets.originOffset[1]
        }
        else if (plane === 'xy') {
          newOffsets.axesOffset[0] = axesOffset[0] * gridScale[0] - newOffsets.originOffset[0]
          newOffsets.axesOffset[1] = axesOffset[1] * gridScale[1] - newOffsets.originOffset[1]
        }
        else if (plane === 'zy') {
          newOffsets.axesOffset[0] = -axesOffset[0] * gridScale[0] - newOffsets.originOffset[0]
          newOffsets.axesOffset[1] = axesOffset[1] * gridScale[1] - newOffsets.originOffset[1]
        }
      } else {
        newOffsets.axesOffset[0] = 0
        newOffsets.axesOffset[1] = 0
      }

      if (plane === 'xz') {
        gridPlane.normal.set(0, 1, 0)
      }
      // x = uv.x, y = uv.y
      else if (plane === 'xy') {
        gridPlane.normal.set(0, 0, 1)
      }
      // z = -uv.x, y = uv.y
      else if (plane === 'zy') {
        gridPlane.normal.set(1, 0, 0)
      }
      gridPlane.constant = worldPosition.length()

      setOffsets(current => {
        if (
          current.axesOffset[0] !== newOffsets.axesOffset[0] ||
          current.axesOffset[1] !== newOffsets.axesOffset[1] ||
          current.originOffset[0] !== newOffsets.originOffset[0] ||
          current.originOffset[1] !== newOffsets.originOffset[1]
        ) {
          return newOffsets
        }
        return current
      })
    }
  }, [plane, gridOrigin, axesOffset, gridScale, gridPlane, worldPosition])

  useEffect(() => {
    uniforms.current.uBackground.value = new Color(background != undefined ? background : 0x707070)
    uniforms.current.uBackgroundOpacity.value = backgroundOpacity
    uniforms.current.uSize.value.set(...size)
    uniforms.current.uOpacity.value = Number.isFinite(opacity) ? clamp(opacity, 0, 1) : 1
    uniforms.current.uCellSize.value = cellSize * cellSizeFactor
    uniforms.current.uSubDivisions.value = subDivisions
    uniforms.current.uGridColorMajor.value.set(gridColorMajor)
    uniforms.current.uGridColorMinor.value.set(gridColorMinor)
    uniforms.current.uGridLineWidth.value = gridLineWidth
    uniforms.current.uAxesLineWidth.value = axesLineWidth
    uniforms.current.uAxesColor.value.set(axesColor)
    uniforms.current.uAxesTickSize.value = axesTickSize
    uniforms.current.uAxesOffset.value.set(...offsets.axesOffset)
    uniforms.current.uOriginOffset.value.set(...offsets.originOffset)
    uniforms.current.uRulerLineWidth.value = rulerLineWidth
    uniforms.current.uRulerColor.value.set(rulerColor)
    uniforms.current.uRulerOpacity.value = rulerOpacity
    uniforms.current.uTexture.value = texture
    uniforms.current.uTextureMix.value = textureMix
    uniforms.current.uProjectionColor.value.set(projectionColor)
  }, [
    size,
    cellSize,
    cellSizeFactor,
    subDivisions,
    background,
    backgroundOpacity,
    opacity,
    gridColorMajor,
    gridColorMinor,
    axesColor,
    axesLineWidth,
    axesTickSize,
    gridLineWidth,
    rulerColor,
    rulerLineWidth,
    rulerOpacity,
    offsets,
    texture,
    textureMix,
    projectionColor,
  ])

  useEffect(() => {
    function onControlsUpdate() {
      if (containerRef.current && camera) {

        camera.getWorldDirection(direction)
        ray.set(camera.position, direction)
        const distanceToRay = ray.distanceToPlane(gridPlane)

        if (distanceToRay) {
          const distanceFactor = Math.min(distanceToRay, 1000 * cellSize) / cellSize
          let index = cellSizeDistanceFactors.findIndex(d => d[0] >= distanceFactor)
          if (index === -1) {
            index = cellSizeDistanceFactors.length - 1
          } else {
            index--
          }
          index = Math.max(0, index)
          const factor = cellSizeDistanceFactors[index][1]
          //console.log(distanceFactor)
          setCellSizeFactor(current => current !== factor ? factor : current)
        }
      }
    }

    if (containerRef.current && controls && dynamicCellSize) {
      // @ts-expect-error generic type never
      controls.addEventListener('update', onControlsUpdate)
      onControlsUpdate()
    } else {
      setCellSizeFactor(1)
    }

    return () => {
      // @ts-expect-error generic type never
      controls?.removeEventListener('update', onControlsUpdate)
    }
  }, [controls, camera, gridPlane, dynamicCellSize, cellSize, cellSizeDistanceFactors, size])

  useEffect(() => {
    if (materialRef.current) {
      materialRef.current.needsUpdate = true
    }
  }, [radial, showAxes, dynamicSegments, showRulers])


  useEffect(() => {
    let renderTarget: WebGLRenderTarget | null = null
    let timer = null
    if (enableProjection) {
      renderTarget = new WebGLRenderTarget(projectionResolution, projectionResolution, {
        minFilter: LinearFilter,
        magFilter: LinearFilter,
        type: HalfFloatType,
      })
      uniforms.current.uProjectionTexture.value = renderTarget.texture
      const takeSnapShot = () => {
        if (renderTarget && containerRef.current && projectionCameraRef.current) {
          const projectionCamera = projectionCameraRef.current
          const prevTarget = gl.getRenderTarget()

          gl.setRenderTarget(renderTarget)
          scene.overrideMaterial = projectionMaterial
          containerRef.current.visible = false
          gl.clear()
          gl.render(scene, projectionCamera)
          scene.overrideMaterial = null
          gl.setRenderTarget(prevTarget)
          containerRef.current.visible = true
        }
      }

      timer = setInterval(takeSnapShot, projectionRefreshRate)
    }

    return () => {
      if (timer) {
        clearInterval(timer)
      }
      renderTarget?.dispose()
    }
  }, [enableProjection, gl, scene, size, projectionDistance, projectionResolution, projectionRefreshRate])


  const trackCursor = useCallback((event: ThreeEvent<PointerEvent>) => {
    uniforms.current.uCursorPosition.value.set(event.uv?.x || 0, event.uv?.y || 0)
    if (onRulerUpdate && event.uv) {
      onRulerUpdate(getGridPositionFromUV(event.uv.x, event.uv.y, size, scale, offsets.originOffset))
    }
  }, [size, scale, offsets.originOffset, onRulerUpdate])

  const hideCursor = useCallback(() => {
    uniforms.current.uCursorPosition.value.set(0, 0)
    if (onRulerUpdate) onRulerUpdate(null)
  }, [onRulerUpdate])

  return (
    <group
      ref={containerRef}
      name={name}
      userData={userData}
      visible={visible}
      rotation-x={plane === 'xz' ? -Math.PI / 2 : 0}
      rotation-y={plane === 'zy' ? Math.PI / 2 : 0}
      position={planeOffsetPosition}
      renderOrder={renderOrder}
    >
      <mesh
        position-z={-0.001 * cellSize}
        onPointerMove={showRulers ? trackCursor : undefined}
        onPointerLeave={showRulers ? hideCursor : undefined}
        renderOrder={1}
        castShadow={castShadow}
        receiveShadow={receiveShadow}
        layers={layers}
      >
        <planeGeometry
          args={size}
        />
        <shaderMaterial
          ref={materialRef}
          uniforms={uniforms.current}
          defines={{
            RADIAL: radial,
            DYNAMICSEGMENTS: dynamicSegments,
            AXES: !!showAxes,
            RULERS: !!showRulers,
            SATURATE: true,
          }}
          vertexShader={vertexShader}
          fragmentShader={fragmentShader}
          side={renderSide}
          depthWrite={true}
          depthTest={true}
          forceSinglePass
          transparent
        />
        {showAxes && showAxesLabels && (
          <GridAxesLabels
            originOffset={offsets.originOffset}
            axesOffset={offsets.axesOffset}
            trimAxesLabels={trimAxesLabels}
            scale={scale}
            size={size}
            start={originValue}
            units={cellSize * cellSizeFactor}
            axesTickSize={axesTickSize}
            plane={plane}
            color={axesColor}
            side={side}
            renderOrder={renderOrder !== undefined && Number.isFinite(renderOrder) ? renderOrder + 1 : undefined}
          />
        )}
      </mesh>
      {enableProjection && (
        <orthographicCamera
          ref={projectionCameraRef}
          args={side === 'back' ? [size[0] / 2, size[0] / -2, size[1] / 2, size[1] / -2, 1, projectionDistance] : [size[0] / -2, size[0] / 2, size[1] / 2, size[1] / -2, 1, projectionDistance]}
          rotation-y={side === 'back' ? 0 : Math.PI}
        />
      )}
    </group>
  )
}