import { CSSProperties, forwardRef, useCallback } from 'react'
import { useAnnotationsState } from './annotations-state'
import { AnnotationInstanceState, AnnotationLayer, AnnotationProps } from './types'
import { useStore } from 'zustand'

const rootStyle: CSSProperties = {
  pointerEvents: 'none',
  width: '100%',
  height: '100%',
}

const annotationStyle: CSSProperties = {
  position: 'absolute',
  top: 0,
  left: 0,
  visibility: 'hidden',
  userSelect: 'none',
  cursor: 'pointer',
  pointerEvents: 'visible',
}

type InstanceProps = {
  id: string,
  state: AnnotationInstanceState,
  layer: AnnotationLayer,
  annotation: AnnotationProps,
}

const InstanceHTML = forwardRef<HTMLDivElement, InstanceProps>(({ id, state, layer, annotation }, ref) => {
  const onClick = useCallback(() => {
    if (layer.onClick) {
      layer.onClick({ instanceId: id, ...annotation })
    }
  }, [annotation, id, layer])

  const onPointerEnter = useCallback(() => {
    state.labelHovered = true
  }, [state])

  const onPointerLeave = useCallback(() => {
    state.labelHovered = false
  }, [state])

  return (
    <div
      ref={ref}
      style={annotationStyle}
      onClick={onClick}
      onPointerEnter={onPointerEnter}
      onPointerLeave={onPointerLeave}
    >
      {
        layer.labelComponent && <layer.labelComponent
          {...{ instanceId: id, ...annotation }}
        />
      }
    </div>
  )
})

export const AnnotationsHTML = () => {
  const instances = useStore(useAnnotationsState, (state => state.instances))
  //const domInstances = useMemo(() => instances.filter(d => d.layer.labelComponent !== null), [instances])
  return (
    <div style={rootStyle}>
      {instances.map(instance =>
        <InstanceHTML
          key={instance.id}
          ref={instance.ref}
          id={instance.id}
          state={instance.state}
          layer={instance.layer}
          annotation={instance.annotation}
        />
      )}
    </div>
  )
}