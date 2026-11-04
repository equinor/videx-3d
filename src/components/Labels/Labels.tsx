import { useThree } from '@react-three/fiber';
import {
  createContext,
  ReactNode,
  useContext,
  useEffect,
  useMemo,
  useState,
} from 'react';
import type { Object3D } from 'three';
import { LabelGroup, LABEL_MARGIN } from './label-group';

const LabelGroupContext = createContext<LabelGroup | null>(null);

// Each scene's own group, for the layers in it under no `<Labels>`, and how many use it.
const sceneGroups = new WeakMap<
  Object3D,
  { group: LabelGroup; users: number }
>();

/**
 * The label group the labels here are drawn and kept apart in: their `<Labels>`'s, or their
 * scene's, made with its first layer and put in the scene while any layer uses it.
 */
export function useLabelGroup(): LabelGroup {
  const own = useContext(LabelGroupContext);
  const scene = useThree(state => state.scene);
  const gl = useThree(state => state.gl);
  const shared = useMemo(() => {
    if (own) return null;
    let entry = sceneGroups.get(scene);
    if (!entry) {
      entry = { group: new LabelGroup(), users: 0 };
      sceneGroups.set(scene, entry);
    }
    return entry;
  }, [own, scene]);
  useEffect(() => {
    if (!shared) return;
    if (shared.users++ === 0) scene.add(shared.group.root);
    return () => {
      if (--shared.users > 0) return;
      scene.remove(shared.group.root);
      // Its GPU resources, made anew if used again.
      shared.group.release(gl);
    };
  }, [shared, scene, gl]);
  return own ?? shared!.group;
}

/** The atlas the labels here draw their texts from: their label group's. */
export function useLabelAtlas() {
  return useLabelGroup().atlas;
}

/**
 * Labels props.
 * @expand
 */
export type LabelsProps = {
  children?: ReactNode;
  /** pixels kept between labels on screen. Default 1 */
  margin?: number;
};

/**
 * A label group of its own for the label layers (`LabelLayer`) under it: one glyph atlas,
 * one draw (two: depth tested, and over everything) and its labels kept apart on screen
 * among themselves alone, freed with it. Optional: the layers of a scene under none share
 * the scene's, and keep apart from each other.
 *
 * Labels are scene objects: they need nothing of the render loop. In an `OITRenderPass`
 * they are drawn last, on the `LAYERS.OVERLAY` layer, after the transparent layers resolve;
 * elsewhere after the transparent objects.
 *
 * @example
 * <Labels>
 *   <LabelLayer provider={gridLabels} size={50} color="#ffffff" />
 *   <LabelLayer labels={contourLabels} size={30} color="#ffd23f" priority={1} />
 * </Labels>
 *
 * @see {@link LabelLayer}
 *
 * @group Components
 */
export const Labels = ({ children, margin = LABEL_MARGIN }: LabelsProps) => {
  const gl = useThree(state => state.gl);
  const [group] = useState(() => new LabelGroup());
  useEffect(() => {
    group.margin = margin;
    group.invalidate();
  }, [group, margin]);
  useEffect(() => () => group.dispose(gl), [group, gl]);
  return (
    <LabelGroupContext.Provider value={group}>
      <primitive object={group.root} />
      {children}
    </LabelGroupContext.Provider>
  );
};
