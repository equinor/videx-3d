import { createRef, useMemo } from 'react'
import { create } from 'zustand'
import { subscribeWithSelector } from 'zustand/middleware'
import { AnnotationInstance, AnnotationLayer, AnnotationProps } from './types'

export type AnnotationsState = {
  visible: boolean
  update: {
    required: boolean
    ref: ReturnType<typeof setTimeout> | null
    setRef: (v: ReturnType<typeof setTimeout>) => void
  }
  layers: Record<string, AnnotationLayer>
  annotations: Record<string, AnnotationProps[]>
  instances: AnnotationInstance[]
  toggleVisibility: () => void
  clear: () => void
  createLayer: (newLayer: AnnotationLayer) => () => void
  updateLayer: (id: string, updatedLayer: Partial<AnnotationLayer>) => void
  layerExist: (id: string) => boolean
  addLayerAnnotations: (
    layerId: string,
    scope: string,
    annotations: AnnotationProps[]
  ) => void
  removeLayerAnnotations: (layerId: string, scope?: string) => void
  setInstances: (newInstances: AnnotationInstance[]) => void
}

/**
 * Get access to annotations global state.
 * This is used internally and should not be used by other components. Use the `useAnnotations` hook instead.
 * @internal
 *
 * @see {@link useAnnotations}
 *
 * @group Hooks
 */
export const useAnnotationsState = create<
  AnnotationsState,
  [['zustand/subscribeWithSelector', never]]
>(
  subscribeWithSelector((set, get) => ({
    visible: true,
    update: {
      required: false,
      ref: null,
      setRef: (v: ReturnType<typeof setTimeout>) =>
        set((state) => ({ update: { ...state.update, ref: v } })),
    },
    layers: {},
    annotations: {},
    instances: [],
    clear: () => {
      set({
        layers: {},
        annotations: {},
        instances: [],
      })
    },
    setInstances: (newInstances) => set({ instances: newInstances }),
    layerExist: (id: string) => {
      return !!get().layers[id]
    },
    toggleVisibility: () => {
      set((state) => ({
        visible: !state.visible,
        update: { ...state.update, required: true },
      }))
    },
    createLayer: (newLayer) => {
      const id = newLayer.id
      set((state) => {
        const layers = state.layers
        if (layers[id]) {
          throw Error('Layer already exist!')
        }
        //newLayer.annotations = []
        return { layers: { ...layers, [id]: newLayer } }
      })

      return () => {
        set((state) => {
          const layers = { ...state.layers }
          delete layers[id]

          return {
            layers,
            update: { ...state.update, required: true },
          }
        })
      }
    },
    updateLayer: (id, updatedLayer) => {
      set((state) => {
        const layers = state.layers
        if (!layers[id]) {
          throw Error('Layer does not exist!')
        }
        return {
          layers: { ...layers, [id]: { ...layers[id], ...updatedLayer } },
          update: { ...state.update, required: true },
        }
      })
    },
    addLayerAnnotations: (layerId, scope, annotations) => {
      set((state) => {
        annotations.forEach((a) => {
          a.scope = scope
        })

        const existing = state.annotations
        const existingLayerAnnotations = existing[layerId]
          ? existing[layerId].filter((d) => d.scope !== scope)
          : []

        const newAnnotationsState = {
          ...existing,
          [layerId]: [...existingLayerAnnotations, ...annotations],
        }
        return {
          annotations: newAnnotationsState,
          update: { ...state.update, required: true },
        }
      })
    },
    removeLayerAnnotations: (layerId, scope?) => {
      set((state) => {
        const existing = state.annotations
        const existingLayerAnnotations = existing[layerId]
          ? existing[layerId].filter((d) => d.scope !== scope)
          : []

        return {
          annotations: {
            ...existing,
            [layerId]: existingLayerAnnotations,
          },
          update: { ...state.update, required: true },
        }
      })
    },
  }))
)

const updateInstances = () => {
  useAnnotationsState.setState((state) => {
    if (!state.visible) {
      return {
        instances: [],
        update: { ...state.update, required: false, ref: null },
      }
    }

    const layers = state.layers
    const instanceMap = new Map(state.instances.map((d) => [d.id, d]))
    const instances: AnnotationInstance[] = []
    const priorityRange = [0, 0]

    Object.keys(layers).forEach((layerId) => {
      const layer = layers[layerId]
      if (layer.visible) {
        state.annotations[layerId]?.forEach((annotation) => {
          const id = `${layerId}_${annotation.scope}_${annotation.id}`
          let instance: AnnotationInstance
          const existing = instanceMap.get(id)

          if (existing) {
            instance = existing
            // update annotation properties
            instance.annotation.name = annotation.name
            instance.annotation.data = annotation.data
            instance.annotation.direction = annotation.direction
            instance.annotation.position = annotation.position
            instance.annotation.priority = annotation.priority
          } else {
            instance = {
              id,
              ref: layer.labelComponent ? createRef<HTMLDivElement>() : null,
              layer,
              annotation,
              priority: 0,
              rank: 0,
              state: {
                visible: false,
                distance: Infinity,
                health: 0,
                labelWidht: 0,
                labelHeight: 0,
                screenPosition: [0, 0],
                zIndex: 0,
              },
            }
          }

          instance.priority = (annotation.priority || 0) + (layer.priority || 0)
          priorityRange[0] = Math.min(priorityRange[0], instance.priority)
          priorityRange[1] = Math.max(priorityRange[1], instance.priority)

          instances.push(instance)
        })
      }
    })
    const prioritySpan = Math.abs(priorityRange[1] - priorityRange[0])

    instances.forEach((instance) => {
      instance.priority =
        prioritySpan > 0
          ? (instance.priority - priorityRange[0]) / prioritySpan
          : 0
    })

    return {
      instances,
      update: { ...state.update, required: false, ref: null },
    }
  })
}

// update instances when layers changes
useAnnotationsState.subscribe(
  (state) => state.update.required,
  (required) => {
    if (required) {
      const updateState = useAnnotationsState.getState().update
      if (updateState.ref) {
        clearTimeout(updateState.ref)
      }
      const timeoutRef: ReturnType<typeof setTimeout> = setTimeout(
        () => updateInstances(),
        500
      )
      updateState.setRef(timeoutRef)
      // if (updateState.ref === null) {
      //   const timeoutRef = setTimeout(() => updateInstances(), 1000)
      //   updateState.setRef(timeoutRef)
      // }
    }
  }
)

/**
 * This hook allow you to add annotations to an exisiting `AnnotationsLayer`.
 * A scope is a user defined string, which should uniquely tie the added anotations to your component.
 * If your annotations belong to a specific wellbore, the wellbore name or id would work well as a scope.
 *
 * A single function `addAnnotations` is returned, which you can call from within a `useEffect`
 * hook to set annotations. Annotations must be an array of `AnnotationProps`.
 * The `addAnnotations` function will return a dispose function when invoked, which you should
 * call within the effect dispose function.
 *
 * @example
 * const { addAnnotations } = useAnnotations('casings', scope)
 *
 * @remarks
 * Note that annotation positions needs to be in world space. If your data is relative to
 * for instance a wellbore, you could add an Object3D element with a ref in your component render function
 * and update the position data in a `useEffect` hook:
 *
 * @example
 * useEffect(() => {
 *   let dispose: (() => void) | null = null
 *   if (generator && id) {
 *     const v = new Vector3()
 *     generator(id).then(response => {
 *       if (response && positionRef.current) {
 *         response.forEach((d, i) => {
 *           v.set(...d.position)
 *           positionRef.current.localToWorld(v)
 *           d.position = v.toArray()
 *           d.id = i.toString()
 *         })
 *         dispose = addAnnotations(response || [])
 *       }
 *     })
 *   }
 *
 *   return () => {
 *     if (dispose) dispose()
 *   }
 * }, [addAnnotations, id, generator, positionRef])
 *
 * @see {@link AnnotationsLayer}
 * @see {@link Annotations}
 *
 * @group Hooks
 */
export const useAnnotations = (layer: string, scope: string) => {
  const add = useAnnotationsState((state) => state.addLayerAnnotations)
  const remove = useAnnotationsState((state) => state.removeLayerAnnotations)

  const annotations = useMemo(() => {
    return {
      addAnnotations: (annotations: AnnotationProps[]) => {
        if (annotations.length) {
          add(layer, scope, annotations)
          return () => {
            remove(layer, scope)
          }
        }
        return undefined
      },
    }
  }, [add, remove, layer, scope])

  return annotations
}
