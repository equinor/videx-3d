import { PropsWithChildren, useEffect, useRef, useState } from 'react'
import { Color, Group, Vector3 } from 'three'
import { Vec3 } from '../../../sdk/types/common'
import { CommonComponentProps } from '../../common'
import { BoxPadding, ObservableGroup } from '../../ObservableGroup/ObservableGroup'
import { Grid } from '../Grid/Grid'

const pos = new Vector3()

/**
 * BoxGrid props
 * @expand
 */
export type BoxGridProps = CommonComponentProps & {
  // size of the grid box in world units
  size?: Vec3,
  // the size of a grid cell in world units
  cellSize?: number,
  // number of sub divisions of a grid cell
  subDivisions?: number,
  // scale determining axes values and direction along each axis
  gridScale?: Vec3,
  // world coordinates of the grid origin (origo)
  gridOrigin?: Vec3,
  // the axes values at the specified origin (default 0,0,0)
  originValue?: Vec3,
  // line width as a factor of the cell size
  gridLineWidth?: number,
  // background color of the grid planes
  background?: string | Color | number,
  // opacity of the grid planes background color 
  backgroundOpacity?: number,
  // opacity of the grid planes (including grid lines)
  opacity?: number,
  // the color of the major grid lines
  gridColorMajor?: string | number | Color,
  // the color of the minor/sub division grid lines
  gridColorMinor?: string | number | Color,
  // axes color
  axesColor?: string | number | Color,
  // axes line width as a factor of cell size
  axesLineWidth?: number,
  // the axes tick size as a factor of cell size
  axesTickSize?: number,
  // if enabled, project a shade of the objects within the grid planes, using an orthographic camera
  enableProjection?: boolean,
  // the color of the projected shade when projection is enabled
  projectionColor?: string | number | Color,
  // the quality/size of the projection texture used when projection is enabled
  projectionResolution?: number,
  // the update frequency of the projected texture when projection is enabled (ms)
  projectionRefreshRate?: number,
  // show rulers on the grid planes at the intersection point of the pointer
  showRulers?: boolean,
  // enable automatic sizing and positioning of the box grid according to its child elements
  autoSize?: boolean,
  // padding when autosize is enabled
  autoSizePadding?: number | Vec3 | BoxPadding,
  // update frequency in ms when autosize is enabled
  autoSizeUpdateRate?: number,
}

/**
 * Renders 5 grid planes in a box form (bottom and sides). See `Grid` for more info.
 * 
 * @example
 * <BoxGrid
 *   size={[5000, 2000, 5000]}
 *   cellSize={100}
 *   gridLineWidth={0.01}
 *   axesColor="#eee"
 *   opacity={0.8}
 * />
 * 
 * @see [Storybook](/videx-3d/?path=/docs/components-grids-boxgrid--docs) 
 * @see {@link Grid}
 * 
 * @group Components
 */
export const BoxGrid = ({
  name,
  visible,
  castShadow,
  receiveShadow,
  layers,
  renderOrder,
  userData,
  size = [0, 0, 0],
  cellSize = 10,
  gridScale = [1, 1, 1],
  gridOrigin = [0, 0, 0],
  originValue = [0, 0, 0],
  subDivisions = 5,
  position = [0, 0, 0],
  gridLineWidth = 0.02,
  background = 0x102030,
  backgroundOpacity = 1,
  opacity = 1,
  gridColorMajor = "#89a",
  gridColorMinor = "#789",
  axesColor = "#fff",
  axesLineWidth = (gridLineWidth || 0.05),
  axesTickSize = 0.1,
  enableProjection,
  projectionColor,
  projectionResolution = 2048,
  projectionRefreshRate,
  showRulers = false,
  autoSize = false,
  autoSizePadding = 0,
  autoSizeUpdateRate = 1000,
  children,
}: PropsWithChildren<BoxGridProps>) => {

  const [gridPosition, setGridPosition] = useState(position)
  const [gridSize, setGridSize] = useState(size)

  const containerRef = useRef<Group>(null)
  const [worldPosition, setWorldPosition] = useState<Vec3>(gridPosition)


  useEffect(() => {
    if (!autoSize) {
      setGridPosition(current => {
        if (
          current[0] !== position[0] ||
          current[1] !== position[1] ||
          current[2] !== position[2]
        ) {
          return position
        }
        return current
      })
      setGridSize(current => {
        if (
          current[0] !== size[0] ||
          current[1] !== size[1] ||
          current[2] !== size[2]
        ) {
          return size
        }
        return current
      })
    }
  }, [size, position, autoSize])

  useEffect(() => {
    if (containerRef.current) {
      containerRef.current.getWorldPosition(pos)
      setWorldPosition(pos.toArray())
    }
  }, [gridPosition])

  return (
    <group
      ref={containerRef}
      name={name}
      userData={userData}
      visible={visible}
    >
      <Grid
        plane='xz'
        originValue={[originValue[0], originValue[2]]}
        cellSize={cellSize}
        size={[gridSize[0], gridSize[2]]}
        position={[gridPosition[0], gridPosition[1] - gridSize[1] * 0.5, gridPosition[2]]}
        gridScale={[gridScale[0], gridScale[2]]}
        gridOrigin={[gridOrigin[0], gridOrigin[2]]}
        subDivisions={subDivisions}
        gridLineWidth={gridLineWidth}
        background={background}
        backgroundOpacity={backgroundOpacity}
        gridColorMajor={gridColorMajor}
        gridColorMinor={gridColorMinor}
        opacity={opacity}
        axesColor={axesColor}
        axesLineWidth={axesLineWidth}
        axesTickSize={axesTickSize}
        trimAxesLabels
        side='both'
        enableProjection={enableProjection}
        projectionResolution={projectionResolution}
        projectionColor={projectionColor}
        projectionDistance={gridSize[1]}
        projectionRefreshRate={projectionRefreshRate}
        showRulers={showRulers}
        castShadow={castShadow}
        receiveShadow={receiveShadow}
        layers={layers}
        renderOrder={renderOrder}
      />
      <Grid
        plane='xy'
        originValue={[originValue[0], originValue[1]]}
        cellSize={cellSize}
        size={[gridSize[0], gridSize[1]]}
        position={[gridPosition[0], gridPosition[1], gridPosition[2] - gridSize[2] * 0.5]}
        gridScale={[gridScale[0], gridScale[1]]}
        axesOffset={[(-worldPosition[0] - gridPosition[0]) / gridScale[0], gridSize[1] * 0.5 * gridScale[1]]}
        gridOrigin={[gridOrigin[0], gridOrigin[1]]}
        subDivisions={subDivisions}
        gridLineWidth={gridLineWidth}
        background={background}
        backgroundOpacity={backgroundOpacity}
        gridColorMajor={gridColorMajor}
        gridColorMinor={gridColorMinor}
        opacity={opacity}
        axesColor={axesColor}
        axesLineWidth={axesLineWidth}
        axesTickSize={axesTickSize}
        trimAxesLabels
        side='front'
        enableProjection={enableProjection}
        projectionResolution={projectionResolution}
        projectionColor={projectionColor}
        projectionDistance={gridSize[2]}
        projectionRefreshRate={projectionRefreshRate}
        showRulers={showRulers}
        castShadow={castShadow}
        receiveShadow={receiveShadow}
        layers={layers}
        renderOrder={renderOrder}
      />
      <Grid
        plane='zy'
        originValue={[originValue[2], originValue[1]]}
        cellSize={cellSize}
        size={[gridSize[2], gridSize[1]]}
        position={[gridPosition[0] - gridSize[0] * 0.5, gridPosition[1], gridPosition[2]]}
        gridScale={[gridScale[2], gridScale[1]]}
        axesOffset={[(-worldPosition[2] - gridPosition[2]) / gridScale[2], gridSize[1] * 0.5 * gridScale[1]]}
        gridOrigin={[gridOrigin[2], gridOrigin[1]]}
        subDivisions={subDivisions}
        gridLineWidth={gridLineWidth}
        background={background}
        backgroundOpacity={backgroundOpacity}
        gridColorMajor={gridColorMajor}
        gridColorMinor={gridColorMinor}
        opacity={opacity}
        axesColor={axesColor}
        axesLineWidth={axesLineWidth}
        axesTickSize={axesTickSize}
        trimAxesLabels
        side='front'
        enableProjection={enableProjection}
        projectionResolution={projectionResolution}
        projectionColor={projectionColor}
        projectionDistance={gridSize[0]}
        projectionRefreshRate={projectionRefreshRate}
        showRulers={showRulers}
        castShadow={castShadow}
        receiveShadow={receiveShadow}
        layers={layers}
        renderOrder={renderOrder}
      />
      <Grid
        plane='xy'
        originValue={[originValue[0], originValue[1]]}
        cellSize={cellSize}
        size={[gridSize[0], gridSize[1]]}
        position={[gridPosition[0], gridPosition[1], gridPosition[2] + gridSize[2] * 0.5]}
        gridScale={[gridScale[0], gridScale[1]]}
        axesOffset={[(-worldPosition[0] - gridPosition[0]) / gridScale[0], gridSize[1] * 0.5 * gridScale[1]]}
        gridOrigin={[gridOrigin[0], gridOrigin[1]]}
        subDivisions={subDivisions}
        gridLineWidth={gridLineWidth}
        background={background}
        backgroundOpacity={backgroundOpacity}
        gridColorMajor={gridColorMajor}
        gridColorMinor={gridColorMinor}
        opacity={opacity}
        axesColor={axesColor}
        axesLineWidth={axesLineWidth}
        axesTickSize={axesTickSize}
        trimAxesLabels
        side='back'
        enableProjection={enableProjection}
        projectionResolution={projectionResolution}
        projectionColor={projectionColor}
        projectionDistance={gridSize[2]}
        projectionRefreshRate={projectionRefreshRate}
        showRulers={showRulers}
        castShadow={castShadow}
        receiveShadow={receiveShadow}
        layers={layers}
        renderOrder={renderOrder}
      />
      <Grid
        plane='zy'
        originValue={[originValue[2], originValue[1]]}
        cellSize={cellSize}
        size={[gridSize[2], gridSize[1]]}
        position={[gridPosition[0] + gridSize[0] * 0.5, gridPosition[1], gridPosition[2]]}
        gridScale={[gridScale[2], gridScale[1]]}
        axesOffset={[(-worldPosition[2] - gridPosition[2]) / gridScale[2], gridSize[1] * 0.5 * gridScale[1]]}
        gridOrigin={[gridOrigin[2], gridOrigin[1]]}
        subDivisions={subDivisions}
        gridLineWidth={gridLineWidth}
        background={background}
        backgroundOpacity={backgroundOpacity}
        gridColorMajor={gridColorMajor}
        gridColorMinor={gridColorMinor}
        opacity={opacity}
        axesColor={axesColor}
        axesLineWidth={axesLineWidth}
        axesTickSize={axesTickSize}
        trimAxesLabels
        side='back'
        enableProjection={enableProjection}
        projectionResolution={projectionResolution}
        projectionColor={projectionColor}
        projectionDistance={gridSize[0]}
        projectionRefreshRate={projectionRefreshRate}
        showRulers={showRulers}
        castShadow={castShadow}
        receiveShadow={receiveShadow}
        layers={layers}
        renderOrder={renderOrder}
      />
      {autoSize && (
        <ObservableGroup
          padding={autoSizePadding}
          updateRate={autoSizeUpdateRate}
          snapTo={cellSize}
          onChange={state => {
            setGridSize(state.size)
            setGridPosition(state.center)
          }}>
          {children}
        </ObservableGroup>
      )}
      {!autoSize && children}

    </group>

  )
}