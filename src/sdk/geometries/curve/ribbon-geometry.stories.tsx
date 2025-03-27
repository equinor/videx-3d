import type { Meta, StoryObj } from '@storybook/react'
import { useEffect, useState } from 'react'
import { BufferGeometry, DoubleSide, RepeatWrapping, TextureLoader } from 'three'
import { Canvas3dDecorator } from '../../../storybook/decorators/canvas-3d-decorator'
import { RibbonMaterial } from '../../materials/ribbon-material'
import { Vec3 } from '../../types/common'
import { getSplineCurve } from './curve-3d'
import { createRibbonGeometry, RibbonGeometryOptions } from './ribbon-geometry'
import { createTubeGeometry, TubeGeometryOptions } from './tube-geometry'


// const points = [
//   [1.2,-3,1],[2,-5,5],[10,-5,4.5],[12,-5,7.5],
// ]

//const points = [[-10, 0, 0], [0, 2, 0], [10, 0, 0]]
const loader = new TextureLoader()

const uvMap = loader.load('uv_grid.jpg')
uvMap.repeat.set(1, 50)
uvMap.wrapT = RepeatWrapping
uvMap.wrapS = RepeatWrapping


const points = [
  [0, 10, 0],
  [1, -1, 1],
  [1, -2, 2],
  [1.2, -3, 1],
  [2, -5, 5],
  [10, -5, 4.5],
  [12, -5, 7.5],
  [10, -4.8, 10],
]

const curve = getSplineCurve(points as Vec3[], false)

type Props = {
  offset: number,
  width: number,
  angle: number,
  showWireframe: boolean,
  ignoreLight: boolean,
  segmentsPerMeter: number,
  from: number,
  to: number,
}

const material = new RibbonMaterial({ side: DoubleSide, color: 'white', map: uvMap })
material.ignoreLight = true

const tubeOptions: TubeGeometryOptions = {
  computeNormals: true,
  endCap: true,
  startCap: true,
  radius: 0.05,
  radialSegments: 16,
}

const DemoComponent = ({
  offset,
  angle,
  width,
  showWireframe,
  ignoreLight,
  segmentsPerMeter,
  to,
  from,
}: Props) => {
  const [geometry, setGeometry] = useState<BufferGeometry | null>(null)
  const [tubeGeometry, setTubeGeometry] = useState<BufferGeometry | null>(null)
  // const targetRef = useRef<Mesh>(null)
  // const bnrmRef = useRef<ArrowHelper>(null)
  // const cnrmRef = useRef<ArrowHelper>(null)


  // useFrame(({ camera }) => {   
  //   let det = 0
  //   let dist = Infinity

  //   camera.getWorldDirection(viewDirection)
  //   if (geometry) {
  //     for (let i = 0; i < geometry.attributes.position.array.length; i += 6) {
  //       worldPosition.fromArray(geometry.attributes.position.array, i)
  //       sp.copy(worldPosition).project(camera)
  //       if (Math.abs(sp.x) < 0.5 && Math.abs(sp.y) < 0.5 && sp.z > 0) {
  //         const rank = sp.z 
  //         if (rank < dist) {
  //           dist = rank
  //           directionToVertex.copy(worldPosition).sub(camera.position)
  //           tan.fromArray(geometry.attributes.tangent.array, i)
  //           bnrm.fromArray(geometry.attributes.binormal.array, i)
  //           cnrm.copy(tan).cross(viewDirection)

  //           det = tan.dot(v.copy(cnrm).cross(bnrm))

  //           const angle = Math.atan2(det, bnrm.dot(cnrm))

  //           material.angle = angle
  //           if (targetRef.current) {
  //             targetRef.current.position.copy(worldPosition)
  //           }
  //           if (bnrmRef.current) {
  //             bnrmRef.current.position.copy(worldPosition)
  //             bnrmRef.current.setDirection(bnrm)
  //           }
  //           if (cnrmRef.current) {
  //             cnrmRef.current.position.copy(worldPosition)
  //             cnrmRef.current.setDirection(cnrm)
  //           }
          
  //         }
  //       }

  //     }
  //   }
    
  // })

  useEffect(() => {
    material.width = width
    material.wireframe = showWireframe
    material.angle = angle
    material.offset = offset
    material.ignoreLight = ignoreLight
  }, [width, angle, offset, showWireframe, ignoreLight])

  useEffect(() => {

    if (curve) {
      const options: RibbonGeometryOptions = {
        from,
        to,
        segmentsPerMeter,
      }

      const geometry = createRibbonGeometry(curve, options)
      const tubeGeometry = createTubeGeometry(curve, {
        ...tubeOptions,
        segmentsPerMeter
      })
      setGeometry(prev => {
        if (prev) {
          prev.dispose()
        }
        return geometry
      })
      setTubeGeometry(prev => {
        if (prev) {
          prev.dispose()
        }
        return tubeGeometry
      })
    }
  }, [from, to, segmentsPerMeter])


  if (!geometry || !tubeGeometry) return null

  return (
    <>
      <mesh geometry={geometry} material={material} />
      <mesh geometry={tubeGeometry}>
        <meshStandardMaterial color={"red"} />
      </mesh>
      {/* <mesh ref={targetRef}>
        <sphereGeometry args={[0.1]} />
        <meshBasicMaterial color="orange" />
      </mesh>
     
      <arrowHelper ref={bnrmRef} args={[worldPosition, bnrm, 1, 0x909090]} />
      <arrowHelper ref={cnrmRef} args={[worldPosition, cnrm, 1, 0x00ff00]} /> */}
    </>

  )
}

const meta = {
  title: 'SDK/ribbon-geometry',
  component: DemoComponent,
} satisfies Meta<typeof DemoComponent>

export default meta
type Story = StoryObj<typeof meta>


export const Default: Story = {
  args: {
    angle: 2,
    width: 0.5,
    offset: 0,
    segmentsPerMeter: 1,
    from: 0,
    to: 1,
    ignoreLight: true,
    showWireframe: false,
  },
  argTypes: {
    angle: {
      control: { type: 'range', min: 0, max: 6, step: 0.1 }
    },
    offset: {
      control: { type: 'range', min: -6, max: 6, step: 0.1 }
    },
    width: {
      control: { type: 'range', min: 0.01, max: 1, step: 0.01 }
    },
    segmentsPerMeter: {
      control: { type: 'range', min: 1, max: 50, step: 1 }
    },
    from: {
      control: { type: 'range', min: 0, max: 1, step: 0.000001 }
    },
    to: {
      control: { type: 'range', min: 0, max: 1, step: 0.000001 }
    },
  },
  decorators: [
    //PerformanceDecorator,
    Canvas3dDecorator
  ],
  parameters: {
    scale: 2,
    autoClear: true,
    cameraTarget: points[2]
  }
}
