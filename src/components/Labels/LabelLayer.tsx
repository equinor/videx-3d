import { useFrame, useThree } from '@react-three/fiber';
import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { Matrix4 } from 'three';
import { LabelLayerMesh } from './label-mesh';
import { useLabelAtlas } from './Labels';
import {
  Label,
  LABEL_STYLE_DEFAULTS,
  LabelsProvider,
  LabelStyle,
} from './types';

/**
 * LabelLayer props: its labels — a list, a provider asked for them each time the view
 * changes, or both — and how they are drawn (see {@link LabelStyle}).
 * @expand
 */
export type LabelLayerProps = Partial<LabelStyle> & {
  /** Default true */
  visible?: boolean;
  /** labels that stay where they are */
  labels?: Label[];
  /** labels for each view: keep it stable (`useCallback`), or it is asked again each render. The same array as last time writes nothing again */
  provider?: LabelsProvider;
  /**
   * a live multiplier on `size`, read each frame: for a size that follows the view
   * smoothly, set on the GPU alone, with no render and nothing written again
   */
  scaleRef?: { readonly current: number };
};

const NO_LABELS: Label[] = [];
const viewProjection = new Matrix4();

/**
 * A layer of text labels glued to the world: one instanced draw, each label a quad painted
 * where it lies, in the plane square to its normal, as large as the layer's `size` in world
 * units. It never moves, turns or resizes on its own; it fades out as it turns edge-on or
 * grows small, is hidden from behind, and behind the scene by the depth test. Its texts
 * are drawn once each into an atlas (its `<Labels>`'s, or the page's).
 *
 * Positions, normals and directions are in the layer's own frame, its parent's: it can
 * sit in a group with the data it labels. Its CPU work is done only when its labels change,
 * or, with a provider, when the view does; and while none of them could show — all past
 * `maxDistance`, or too small to read (`minPixels`) — it is not drawn at all.
 *
 * Drawn last by an `OITRenderPass` (`LAYERS.OVERLAY`), after the transparent layers
 * resolve, so its text and halos blend over everything as they are; elsewhere after the
 * transparent objects.
 *
 * @example
 * <LabelLayer
 *   labels={[{ text: '-2100', position: [x, y, z], normal: [0, 1, 0] }]}
 *   size={50}
 *   color="#ffd23f"
 * />
 *
 * @see {@link Labels}
 *
 * @group Components
 */
export const LabelLayer = ({
  visible = true,
  labels = NO_LABELS,
  provider,
  scaleRef,
  ...style
}: LabelLayerProps) => {
  const atlas = useLabelAtlas();
  const gl = useThree(state => state.gl);
  const camera = useThree(state => state.camera);
  const size = useThree(state => state.size);
  useEffect(
    () => atlas.setAnisotropy(gl.capabilities.getMaxAnisotropy()),
    [atlas, gl],
  );

  // By value, so a style written inline sets nothing again.
  const styleKey = JSON.stringify(style);
  const resolved = useMemo<LabelStyle>(
    () => ({
      ...LABEL_STYLE_DEFAULTS,
      ...(JSON.parse(styleKey) as Partial<LabelStyle>),
      // JSON has no Infinity.
      maxDistance: style.maxDistance ?? LABEL_STYLE_DEFAULTS.maxDistance,
      maxPixels: style.maxPixels ?? LABEL_STYLE_DEFAULTS.maxPixels,
    }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [styleKey],
  );

  const [layer] = useState(() => new LabelLayerMesh());
  useEffect(() => () => layer.dispose(), [layer]);
  useEffect(() => () => atlas.untrack(layer), [atlas, layer]);

  // What was drawn for: drawn again when the labels, the style or the atlas change, and,
  // with a provider, the view.
  const drawn = useRef({
    dirty: true,
    viewProjection: new Matrix4(),
    width: 0,
    height: 0,
    provided: NO_LABELS,
  });
  useLayoutEffect(() => {
    layer.setStyle(resolved);
    drawn.current.dirty = true;
  }, [layer, resolved, labels, provider, atlas]);

  useFrame(() => {
    if (!visible) {
      layer.mesh.visible = false;
      return;
    }
    const state = drawn.current;
    layer.setViewHeight(size.height);
    layer.setFar((camera as { far?: number }).far ?? 0);
    layer.setScale(scaleRef?.current ?? 1);
    let dirty = state.dirty || layer.generation !== atlas.generation;
    if (provider) {
      viewProjection.multiplyMatrices(
        camera.projectionMatrix,
        camera.matrixWorldInverse,
      );
      if (
        dirty ||
        !viewProjection.equals(state.viewProjection) ||
        size.width !== state.width ||
        size.height !== state.height
      ) {
        state.viewProjection.copy(viewProjection);
        state.width = size.width;
        state.height = size.height;
        const provided = provider({
          camera,
          width: size.width,
          height: size.height,
        });
        // The same labels as before: nothing to write again.
        if (provided !== state.provided) {
          state.provided = provided;
          dirty = true;
        }
      }
    }
    if (dirty) {
      state.dirty = false;
      const all = !provider
        ? labels
        : labels.length
          ? labels.concat(state.provided)
          : state.provided;
      layer.update(all, resolved, atlas);
    }
    // None could show (all too far, or too small to read): not drawn at all.
    layer.mesh.visible = layer.reachable(camera, size.height);
  });

  return <primitive object={layer.mesh} />;
};
