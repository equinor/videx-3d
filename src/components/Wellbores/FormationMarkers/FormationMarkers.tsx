import { ForwardedRef, forwardRef, useEffect, useImperativeHandle, useMemo, useRef, useState } from 'react'
import { Color, CylinderGeometry, Group, Matrix4, Vector3 } from 'three'
import { useGenerator } from '../../../hooks/useGenerator'
import { useWellboreContext } from '../../../hooks/useWellboreContext'
import { createLayers, LAYERS } from '../../../layers/layers'
import { SymbolsType } from '../../../sdk/data/types/Symbol'
import { TubeMaterial } from '../../../sdk/materials/tube-material'
import { Vec3 } from '../../../sdk/types/common'
import { useAnnotations } from '../../Annotations/annotations-state'
import { AnnotationProps } from '../../Annotations/types'
import { CommonComponentProps } from '../../common'
import { Symbols } from '../../Symbol/Symbol'
import { formationMarkerSymbols } from './formation-markers-defs'

const transform = new Matrix4()
const origin = new Vector3()
const color = new Color()

/**
 * FormationMarker props
 * @expand
 */
export type FormationMarkerProps = CommonComponentProps & {
  radialSegments?: number
  baseRadius?: number
  priority?: number
  stratColumnId: string,
  showAnnotations?: boolean
}

/**
 * Render formation markers along a wellbore trajectory. This uses the `Symbols` component internally.
 * 
 * @example
 * <Wellbore id={wellboreId}>
 *  <FormationMarkers showAnnotations stratColumnId="abcd" />
 * </Wellbore>
 * 
 * @see {@link Wellbore}
 * @see {@link Symbols}
 * 
 * @group Components
 */
export const FormationMarkers = forwardRef(({
  radialSegments = 8,
  baseRadius = 10,
  stratColumnId,
  showAnnotations = true,
  name,
  userData,
  position,
  visible,
  renderOrder,
  layers = createLayers(LAYERS.NOT_EMITTER),
  castShadow,
  receiveShadow,
  priority = 0,
}: FormationMarkerProps, fref: ForwardedRef<Group>) => {

  const ref = useRef<Group>(null)

  const { id, fromMsl } = useWellboreContext()
  const generator = useGenerator<SymbolsType>(formationMarkerSymbols, priority)
  const { addAnnotations } = useAnnotations('formation-markers', id)

  const [data, setData] = useState<SymbolsType | null>(null)

  useImperativeHandle(fref, () => ref.current!)

  const geometry = useMemo(() => {
    //const g = new RingGeometry(1, 0.5, radialSegments, radialSegments)
    const g = new CylinderGeometry(1, 1, 0.1, radialSegments, 1, false)
    //g.rotateX(-PI2)
    return g
  }, [radialSegments])

  const material = useMemo(() => {
    // const m = new MeshBasicMaterial({
    //   side: DoubleSide,
    // })
    const m = new TubeMaterial()
    return m
  }, [])

  useEffect(() => {
    if (generator && id) {
      generator(
        id,
        stratColumnId,
        fromMsl,
        baseRadius,
      ).then(response => {
        setData(response)
      })
    }
  }, [generator, id, fromMsl, baseRadius, stratColumnId])



  useEffect(() => {
    if (showAnnotations && data && data.data) {
      const annotations = data.data.map((d, i) => {
        transform.fromArray(data.transformations, i * 16)
        origin.setFromMatrixPosition(transform)
        ref.current?.localToWorld(origin)
        color.fromArray(data.colors!, i * 3)
        const annotation: AnnotationProps = {
          id: d.id as string,
          name: d.name as string,
          position: origin.toArray(),
          direction: d.direction as Vec3,
          priority: d.level as number,
          data: {
            depth: d.depth,
            tvd: d.tvd,
            color: color.getHexString()
          }

        }
        return annotation
      })
      return addAnnotations(annotations)
    }
    return undefined
  }, [data, addAnnotations, showAnnotations])

  return (
    <group ref={ref}>
      {data && (
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