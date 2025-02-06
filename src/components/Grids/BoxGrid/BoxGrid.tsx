import { Color, Group, Vector3 } from 'three'
import { Vec3 } from '../../../sdk/types/common'
import { Grid } from '../Grid/Grid'
import { PropsWithChildren, useEffect, useRef, useState } from 'react'
import { CommonComponentProps } from '../../common'
import { BoxPadding, ObservableGroup } from '../../ObservableGroup/ObservableGroup'


/**
 * BoxGrid props
 * @expand
 */
export type BoxGridProps = CommonComponentProps & {
  size?: Vec3,
  cellSize?: number,
  subDivisions?: number,
  gridScale?: Vec3,
  gridOrigin?: Vec3,
  originValue?: Vec3,
  gridLineWidth?: number,
  background?: string | Color | number,
  backgroundOpacity?: number,
  opacity?: number,
  gridColorMajor?: string | number | Color,
  gridColorMinor?: string | number | Color,
  axesColor?: string | number | Color,
  axesLineWidth?: number,
  axesTickSize?: number,
  enableProjection?: boolean,
  projectionColor?: string | number | Color,
  projectionResolution?: number,
  projectionRefreshRate?: number,
  showRulers?: boolean,
  autoSize?: boolean,
  autoSizePadding?: number | Vec3 | BoxPadding,
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
 * @see [Storybook](/?path=/docs/components-grids-boxgrid--docs) 
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
  gridScale = [1, -1, -1],
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
      setGridPosition(position)
      setGridSize(size)
    }
  }, [size, position, autoSize])

  useEffect(() => {
    if (containerRef.current) {
      const pos = new Vector3()
      containerRef.current?.getWorldPosition(pos)
      setWorldPosition(pos.toArray())
    }
  }, [gridPosition])

  return (
    <group
      ref={containerRef}
      name={name}
      userData={userData}
      visible={visible}
      renderOrder={renderOrder}
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
      />
      <Grid
        plane='xy'
        originValue={[originValue[0], originValue[1]]}
        cellSize={cellSize}
        size={[gridSize[0], gridSize[1]]}
        position={[gridPosition[0], gridPosition[1], gridPosition[2] - gridSize[2] * 0.5]}
        gridScale={[gridScale[0], gridScale[1]]}
        axesOffset={[-gridPosition[0] - worldPosition[0] * gridScale[0], gridSize[1] * 0.5 * gridScale[1]]}
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
      />
      <Grid
        plane='zy'
        originValue={[originValue[2], originValue[1]]}
        cellSize={cellSize}
        size={[gridSize[2], gridSize[1]]}
        position={[gridPosition[0] - gridSize[0] * 0.5, gridPosition[1], gridPosition[2]]}
        gridScale={[gridScale[2], gridScale[1]]}
        axesOffset={[gridPosition[2] - worldPosition[2] * gridScale[2], gridSize[1] * 0.5 * gridScale[1]]}
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
      />
      <Grid
        plane='xy'
        originValue={[originValue[0], originValue[1]]}
        cellSize={cellSize}
        size={[gridSize[0], gridSize[1]]}
        position={[gridPosition[0], gridPosition[1], gridPosition[2] + gridSize[2] * 0.5]}
        gridScale={[gridScale[0], gridScale[1]]}
        axesOffset={[-gridPosition[0] - worldPosition[0] * gridScale[0], gridSize[1] * 0.5 * gridScale[1]]}
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
      />
      <Grid
        plane='zy'
        originValue={[originValue[2], originValue[1]]}
        cellSize={cellSize}
        size={[gridSize[2], gridSize[1]]}
        position={[gridPosition[0] + gridSize[0] * 0.5, gridPosition[1], gridPosition[2]]}
        gridScale={[gridScale[2], gridScale[1]]}
        axesOffset={[gridPosition[2] - worldPosition[2] * gridScale[2], gridSize[1] * 0.5 * gridScale[1]]}
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