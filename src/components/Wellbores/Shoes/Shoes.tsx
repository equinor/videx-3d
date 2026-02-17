import { ForwardedRef, forwardRef, useEffect, useImperativeHandle, useMemo, useRef, useState } from 'react'
import { Color, ConeGeometry, Group, Matrix4, Vector3 } from 'three/webgpu'
import { useGenerator } from '../../../hooks/useGenerator'
import { useWellboreContext } from '../../../hooks/useWellboreContext'
import { TubeMaterial } from '../../../materials/tube-material'
import { SymbolsType } from '../../../sdk/data/types/Symbol'
import { Vec3 } from '../../../sdk/types/common'
import { useAnnotations } from '../../Annotations/annotations-state'
import { AnnotationProps } from '../../Annotations/types'
import { CommonComponentProps } from '../../common'
import { Symbols } from '../../Symbol/Symbol'
import { shoeSymbols } from './shoes-defs'

const transform = new Matrix4()
const origin = new Vector3()

/**
 * Shoes props
 * @expand
 */
export type ShoesProps = CommonComponentProps & {
  radialSegments?: number,
  sizeMultiplier?: number,
  color?: string | number | Color,
  priority?: number,
}

/**
 * Render shoe markers along a wellbore trajectory. This uses the `Symbols` component internally.
 * 
 * @example
 * <Wellbore id={wellboreId}>
 *  <Shoes />
 * </Wellbore>
 * 
 * @remarks
 * A filtered set of the casing data is used by default to render shoes.
 * 
 * @see {@link Wellbore}
 * @see {@link Symbols}
 * 
 * @group Components
 */
export const Shoes = forwardRef(({
  name,
  userData,
  position,
  visible,
  renderOrder,
  layers,
  castShadow,
  receiveShadow,
  radialSegments = 16,
  sizeMultiplier = 10,
  color = '#ffbb00',
  priority = 0
}: ShoesProps, fref: ForwardedRef<Group>) => {

  const ref = useRef<Group>(null)
  const { id, fromMsl } = useWellboreContext()
  const generator = useGenerator<SymbolsType>(shoeSymbols, priority)
  const { addAnnotations } = useAnnotations('shoes', id)

  const [data, setData] = useState<SymbolsType | null>(null)

  useImperativeHandle(fref, () => ref.current!)

  const geometry = useMemo(() => {
    const g = new ConeGeometry(1, 2, radialSegments || 16, 1, false)
    g.translate(0, 1, 0)
    return g
  }, [radialSegments])

  const material = useMemo(() => {
    const m = new TubeMaterial()
    m.color.set(color)

    return m
  }, [color])

  useEffect(() => {
    if (generator && id) {
      generator(
        id,
        fromMsl,
        sizeMultiplier,
      ).then(response => {
        setData(response)
      })
    }
  }, [generator, id, fromMsl, sizeMultiplier])

  useEffect(() => {

    if (data) {
      const annotations = data.data!.map((d, i) => {
        transform.fromArray(data.transformations, i * 16)
        origin.setFromMatrixPosition(transform)

        const annotation: AnnotationProps = {
          id: d.id as string,
          name: d.name as string,
          position: origin.toArray(),
          matrixWorld: ref.current?.matrixWorld,
          direction: d.direction as Vec3,
        }
        return annotation
      })
      return addAnnotations(annotations)
    }
    return undefined
  }, [data, addAnnotations])

  return (
    <group ref={ref}>
      {(data && data.transformations.length) && (
        <Symbols
          name={name}
          userData={userData}
          renderOrder={renderOrder}
          visible={visible}
          position={position}
          data={data}
          geometry={geometry}
          material={material}
          layers={layers}
          castShadow={castShadow}
          receiveShadow={receiveShadow}
        />
      )}
    </group>
  )

})