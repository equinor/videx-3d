import type { Meta, StoryObj } from '@storybook/react-vite'
import { useEffect, useMemo, useState } from 'react'
import { BufferGeometry, LinearFilter, Texture } from 'three/webgpu'
import { Canvas3dDecorator } from '../../../storybook/decorators/canvas-3d-decorator'
import { Vec3 } from '../../types/common'
import { textureLoader } from '../../utils/loaders'
import { getSplineCurve } from './curve-3d'
import { TubeGeometryOptions, createTubeGeometry } from './tube-geometry'

// const points = [
//   [1.2,-3,1],[2,-5,5],[10,-5,4.5],[12,-5,7.5],
// ]

//const points = [[-10, 0, 0], [0, 2, 0], [10, 0, 0]]

const points = [
  [0, 0, 0],
  [1, -1, 1],
  [1, -2, 2],
  [1.2, -3, 1],
  [2, -5, 5],
  [10, -5, 4.5],
  [12, -5, 7.5],
  [10, -4.8, 10],
]

type Props = {
  radius: number,
  innerRadius: number,
  thickness: number,
  showWireframe: boolean,
  showNormals: boolean,
  closed: boolean,
  radiusModificationType: 'none' | 'linear' | 'stepped',
  segmentsPerMeter: number,
  radialSegments: number,
  simplificationThreshold: number,
  from: number,
  to: number,
}

const DemoComponent = ({
  radius,
  innerRadius,
  thickness,
  showWireframe,
  //showNormals,
  closed,
  radiusModificationType,
  segmentsPerMeter,
  radialSegments,
  simplificationThreshold,
  to,
  from,
}: Props) => {
  const [geometry, setGeometry] = useState<BufferGeometry | null>(null)

  useEffect(() => {
    const curve = getSplineCurve(points as Vec3[], closed)
    if (curve) {
      const options: TubeGeometryOptions = {
        from,
        to,
        radius,
        segmentsPerMeter,
        radialSegments,
        computeNormals: true,
        computeLengths: true,
        computeUvs: true,
        computeCurveNormals: false,
        computeCurveTangents: false,
        computeCurveBinormals: false,
        startCap: true,
        endCap: true,
        thickness,
        innerRadius,
        simplificationThreshold,
        addGroups: false
      }

      if (radiusModificationType !== 'none') {
        options.radiusModifier = {
          type: radiusModificationType,
          //steps: [[0.5, radius * 2], [0.65, radius * 0.75], [0.8, radius * 0.75], [0.9, radius * 1.5]]
          //steps: [[0, radius], [0.25, radius * 0.8], [0.5, radius * 0.6], [0.75, radius * 0.4], [1, radius * 0.2]]
          steps: [[0, radius * 2], [0.05, radius * 2], [0.1, radius], [0.9, radius], [0.95, radius * 2], [1, radius * 2]]
          //steps: [[0.25, radius * 0.8], [0.251, radius * 0.6], [0.7, radius * 3], [1, radius]]
          //steps: [[0.5, radius * 5]]
        }
      }

      const geometry = createTubeGeometry(curve, options)

      setGeometry(prev => {
        if (prev) {
          prev.dispose()
        }
        return geometry
      })
    }
  }, [radius, closed, radiusModificationType, simplificationThreshold, segmentsPerMeter, radialSegments, to, from, innerRadius, thickness])

  const uvMap = useMemo(() => {
    return textureLoader.load('uv_grid.jpg', (tex: Texture) => {
      tex.generateMipmaps = false
      tex.magFilter = LinearFilter
      tex.minFilter = LinearFilter
      tex.flipY = true
    })
  }, [])

  const showUvMap = false

  if (!geometry) return null

  return (
    <mesh geometry={geometry}>
      <meshStandardNodeMaterial wireframe={showWireframe} color="#999" metalness={0.75} roughness={0.25} map={showUvMap ? uvMap : null} />
      {/* {showNormals && <Helper type={VertexNormalsHelper} args={[0.2 * radius, 0xcc0000]} />} */}
    </mesh>
  )
}

const meta = {
  title: 'SDK/tube-geometry',
  component: DemoComponent,
} satisfies Meta<typeof DemoComponent>

export default meta
type Story = StoryObj<typeof meta>


export const Default: Story = {
  args: {
    radius: 0.25,
    segmentsPerMeter: 10,
    radialSegments: 16,
    simplificationThreshold: 0,
    radiusModificationType: 'none',
    innerRadius: 0,
    thickness: 0,
    from: 0,
    to: 1,
    closed: false,
    showNormals: false,
    showWireframe: false,
  },
  argTypes: {
    radius: {
      control: { type: 'range', min: 0.01, max: 1, step: 0.001 }
    },
    segmentsPerMeter: {
      control: { type: 'range', min: 1, max: 50, step: 1 }
    },
    radialSegments: {
      control: { type: 'range', min: 4, max: 64, step: 1 }
    },
    radiusModificationType: {
      options: ['none', 'linear', 'stepped'],
      control: { type: 'select' }
    },
    simplificationThreshold: {
      control: { type: 'range', min: 0, max: 0.001, step: 0.000001 }
    },
    from: {
      control: { type: 'range', min: 0, max: 1, step: 0.000001 }
    },
    to: {
      control: { type: 'range', min: 0, max: 1, step: 0.000001 }
    },
    innerRadius: {
      control: { type: 'range', min: 0, max: 1, step: 0.001 }
    },
    thickness: {
      control: { type: 'range', min: 0, max: 1, step: 0.001 }
    },
  },
  decorators: [
    Canvas3dDecorator
  ],
  parameters: {
    scale: 2,
    autoClear: true,

  }
}
