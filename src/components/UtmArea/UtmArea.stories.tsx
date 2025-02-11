import type { Meta, StoryObj } from '@storybook/react'

import proj4 from 'proj4'
import { useMemo } from 'react'
import { getProjectionDefFromUtmZone, wgs84Def } from '../../sdk/projection/crs'
import { Vec2 } from '../../sdk/types/common'
import { Canvas3dDecorator } from '../../storybook/decorators/canvas-3d-decorator'
import { useWellboreHeaders } from '../../storybook/hooks/useWellboreHeaders'
import storyArgs from '../../storybook/story-args.json'
import { UtmGrid } from '../Grids/Grid/UtmGrid'
import { UtmArea } from './UtmArea'
import { UtmPosition } from './UtmPosition'
import { Wgs84Position } from './Wgs84Position'

const utmZone = storyArgs.utmZone


const converter = proj4(getProjectionDefFromUtmZone(utmZone), wgs84Def)

const meta = {
  title: 'Components/Containers/UtmArea',
  component: UtmArea,
} satisfies Meta<typeof UtmArea>

export default meta
type Story = StoryObj<typeof meta>

export const Default: Story = {
  args: {
    utmZone,
    origin: storyArgs.origin as Vec2,
    originUnits: 'utm',
    offset: [0, 0, 0],
  },
  decorators: [
    Canvas3dDecorator,
  ],
  parameters: {
    autoClear: true,
    scale: 1000,
    cameraPosition: [0, 5000, 0],
    cameraTarget: [0, 0, 0],
  },
  render: (args) => {
    const wellboreHeaders = useWellboreHeaders()
    const wellbore = useMemo(() => Object.values(wellboreHeaders).find(d => d.id === storyArgs.defaultWellbore), [wellboreHeaders])
    const wgs84coords = useMemo(() => wellbore ? converter.forward([wellbore.easting, wellbore.northing]) as Vec2 : null, [wellbore])
    return (
      <group>
        <UtmArea utmZone={args.utmZone} origin={args.origin} originUnits={args.originUnits} offset={args.offset}>
          {Object.values(wellboreHeaders).map(w => (
            <UtmPosition key={w.id} easting={w.easting} northing={w.northing} altitude={-(w.kickoffDepthMsl || 0)}>
              <mesh>
                <sphereGeometry args={[100]} />
                <meshStandardMaterial color="red" />
              </mesh>
            </UtmPosition>
          ))}
          { wgs84coords && (
            <Wgs84Position long={wgs84coords[0]} lat={wgs84coords[1]} altitude={500}>
              <mesh>
                <sphereGeometry args={[150]} />
                <meshStandardMaterial color="orange" />
              </mesh>
            </Wgs84Position>
          )}
          {wellbore && (
            <UtmPosition easting={wellbore.easting} northing={wellbore.northing} altitude={-(wellbore.kickoffDepthMsl || 0)}>
              <UtmGrid
                //relativeValues
                size={[30000, 30000]}
                cellSize={1000}
                cellSizeDistanceFactors={[
                  [0, 0.5],
                  [40, 1],
                  [60, 2],
                  [70, 5],
                  [150, 10],
                  [250, 25],
                  [999, 50],
                ]}
                subDivisions={5}
                dynamicCellSize={false}
                plane='xz'
                gridLineWidth={0.015}
                opacity={0.9}
                showAxes
                showRulers
              //dynamicSegments
              />
            </UtmPosition>
          )}
        </UtmArea>
        <axesHelper args={[1000]} />
      </group>
    )
  }
}
