import { Line, Mesh, Object3D } from 'three';
import { create } from 'zustand';
import { LAYERS } from '../../layers/layers';

type ObjectRef = {
  object: Mesh | Line;
  instanceIndex?: number;
};

type HighlightState = {
  highlighted: ObjectRef[];
  set: (
    partial:
      | ((state: HighlightState) => Partial<HighlightState>)
      | Partial<HighlightState>,
  ) => void;
};

const keyOf = (o: Object3D, idx?: number) => {
  if (idx) return `${o.id}_${idx}`;
  return `${o.id}`;
};

function addObjects(
  object: Object3D,
  set: Record<string, ObjectRef>,
  index?: number,
) {
  object.traverseVisible(o => {
    if (!o.layers.isEnabled(LAYERS.NOT_EMITTER)) {
      if (o.type === 'Mesh' || o.type === 'Line') {
        set[keyOf(o, index)] = {
          object: o as Mesh | Line,
          instanceIndex: index,
        };
      }
    }
  });
}

function removeObjects(
  object: Object3D,
  set: Record<string, ObjectRef>,
  index?: number,
) {
  object.traverse(o => {
    if (o.type === 'Mesh' || o.type === 'Line') {
      delete set[keyOf(o, index)];
    }
  });
}

export const useHighlightState = create<HighlightState>(set => ({
  highlighted: [],
  set,
}));

/**
 * Allows a component to interact with the `Highlighter` handler component.
 *
 * @example
 * const highlighter = useHighlighter()
 *
 * return (
 *   <Wellbore
 *     id={wellbore.id}
 *    ...
 *    onPointerEnter={async (event) => {
 *      if (!isSelected) {
 *        highlighter.highlight(event.target)
 *      }
 *    }}
 *    onPointerLeave={async () => {
 *      highlighter.removeAll()
 *    }}
 *    ...
 *  />
 * )
 *
 * @see {@link EventEmitter}
 * @see {@link Highlighter}
 *
 * @group Hooks
 */
export const useHighlighter = () => {
  const set = useHighlightState(state => state.set);

  return {
    highlight: (obj: Object3D, index?: number) =>
      set(prev => {
        const objSet: Record<string, ObjectRef> = prev.highlighted.reduce(
          (acc, d) => ({ ...acc, [keyOf(d.object, d.instanceIndex)]: d }),
          {},
        );
        addObjects(obj, objSet, index);
        return {
          highlighted: Object.values(objSet).filter(
            d => d.object.layers.isEnabled(LAYERS.EMITTER) && d.object.visible,
          ),
        };
      }),
    removeHighlight: (obj: Object3D, index?: number) =>
      set(prev => {
        const objSet: Record<string, ObjectRef> = prev.highlighted.reduce(
          (acc, d) => ({ ...acc, [keyOf(d.object, d.instanceIndex)]: d }),
          {},
        );
        removeObjects(obj, objSet, index);
        return {
          highlighted: Object.values(objSet).filter(
            d => d.object.layers.isEnabled(LAYERS.EMITTER) && d.object.visible,
          ),
        };
      }),
    removeAll: () => {
      set({ highlighted: [] });
    },
  };
};
