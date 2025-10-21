import { PropsWithChildren, useEffect, useLayoutEffect, useMemo, useRef } from 'react'
import { useAnnotationsState } from './annotations-state'
import { DefaultLabelComponent } from './DefaultLabelComponent'
import { AnnotationLayer } from './types'

/**
 * AnnotationsLayer props
 * @expand
 */
export type AnnotationsLayerProps = Partial<AnnotationLayer> & {
  id: string,
  name: string,
}

/**
 * Use the AnnotationsLayer component to register and configure a layer for adding 
 * annotations. This needs to be added as a child of the `Annotations` component.
 * 
 * @example
 * <Annotations>
 *  <AnnotationsLayer
 *   id="wellbore-labels"
 *   name="Wellbore Labels"
 *   priority={4}
 *   anchorSize={5}
 *   anchorColor='cyan'
 *   connectorWidth={1.5}
 *   distanceFactor={1000}
 *   labelOffset={50}
 *   minDistance={1}
 *   maxDistance={10000}
 *   anchorOcclusionRadius={20}
 *   labelComponent={WellboreAnnotationLabel}
 *   onClick={(annotation: AnnotationComponentProps) => {
 *     dispatchEvent(new CameraFocusAtPointEvent({ point: annotation.position, distance: 500 }))
 *   }}
 *  />
 * </Annotations>
 * 
 * @remarks
 * The AnnotationsLayer component is for adding and configuring a layer. Annotations are added to a layer 
 * using the `useAnnotations` hook with a layer id and a user defined scope.
 * 
 * @see [Storybook](/videx-3d/?path=/docs/components-misc-annotations--docs)
 * @see {@link Annotations}
 * @see {@link useAnnotations}
 * 
 * @group Components
 */
export const AnnotationsLayer = ({
  id,
  name,
  priority = 0,
  visible = true,
  distanceFactor = 100,
  minDistance = 10,
  maxDistance = 5000,
  anchorOcclusionRadius = 15,
  anchorSize = 0.25,
  anchorColor = 'white',
  connectorWidth = 1,
  connectorColor = anchorColor || 'white',
  labelOffset = 100,
  labelComponent = DefaultLabelComponent,
  onClick,
  children,
}: PropsWithChildren<AnnotationsLayerProps>) => {
  const create = useAnnotationsState(state => state.createLayer)
  const update = useAnnotationsState(state => state.updateLayer)
  const layerExist = useAnnotationsState(state => state.layerExist)

  const dispose = useRef<(() => void) | null>(null)

  const layer = useMemo(() => {
    return {
      id,
      name,
      priority,
      visible,
      distanceFactor,
      minDistance,
      maxDistance,
      labelOffset,
      anchorOcclusionRadius,
      anchorSize,
      anchorColor,
      connectorWidth,
      connectorColor,
      labelComponent,
      onClick,
    }
  }, [
    id,
    name,
    priority,
    visible,
    anchorOcclusionRadius,
    anchorSize,
    anchorColor,
    connectorWidth,
    connectorColor,
    minDistance,
    maxDistance,
    labelOffset,
    distanceFactor,
    labelComponent,
    onClick,
  ])

  useLayoutEffect(() => {
    const exist = layerExist(layer.id)
    if (!exist) {
      dispose.current = create(layer)
    } else {
      update(layer.id, layer)
    }
  }, [
    create,
    update,
    layerExist,
    layer
  ])

  useEffect(() => {
    return () => {
      if (dispose.current) {
        dispose.current()
      }
    }
  }, [])

  return (
    <group>
      {children}
    </group>
  )
}