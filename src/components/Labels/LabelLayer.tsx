import { useFrame } from '@react-three/fiber';
import { useLayoutEffect, useMemo, useRef } from 'react';
import type { Object3D } from 'three';
import { LabelGroupLayer } from './label-group';
import { useLabelGroup } from './Labels';
import {
  Label,
  LabelsProvider,
  LabelStyle,
  resolveLabelStyle,
  ResolvedLabelStyle,
} from './types';

/**
 * LabelLayer props: its labels — a list, a provider asked for them each time the view
 * changes, or both — how they are drawn (see {@link LabelStyle}), and how much they are
 * wanted where labels meet.
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
  /**
   * how much its labels are wanted where labels of its group meet on screen: the higher
   * kept, the lower pushed out (each label's own `priority` added). Default 0
   */
  priority?: number;
  /** its labels may overlap any others, and keep none out. Default false */
  overlap?: boolean;
};

const NO_LABELS: Label[] = [];

/**
 * A layer of text labels glued to the world, each a quad painted where it lies, in the
 * plane square to its normal. As large as the layer's `size` in world units (`sizing`
 * `'world'`, the default), or in CSS pixels on screen at any distance (`'screen'`), or near
 * and shrinking with distance (`'auto'`); `size` may be a preset (`'xsmall'` to
 * `'xlarge'`), a size on screen tuned to read well. It never moves or turns on its own; it
 * fades out as it turns edge-on or grows small, is hidden from behind, and behind the
 * scene by the depth test.
 *
 * Its labels are kept apart on screen from those of every layer in its group — its
 * `<Labels>`, or its scene's — by `priority`, then those shown already, whole, central and
 * near: those pushed out fade away, and come back once there is room. A near label may lie
 * over a far one (near and distant, as annotations', by `distanceFactor`), drawn in
 * front. All of a group's labels are one draw (two: those depth tested, and those not);
 * their glyphs are drawn once each into its atlas, their texts runs of them.
 *
 * Positions, normals and directions are in the layer's own frame, its parent's: it can
 * sit in a group with the data it labels. A label given room of its own (`bounds`) is
 * broken into the fewest lines that fit it at the size it is drawn, and shrunk to fit
 * where none do; one given `places` is drawn at the first whose text fits there — as a
 * polygon's name, in the shape that fits the polygon best (`GeoLabels`). Both again as
 * zooming changes its size on screen. Its CPU work is done when its labels change, or,
 * with a provider, when the view does; and its labels are placed on screen as the view
 * moves. While none of them could show — all past `maxDistance`, or too small to read
 * (`minPixels`) — they cost nothing.
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
 * @example
 * // 14 pixels on screen near, shrinking past a view 5 km high; kept over the grid's
 * <LabelLayer labels={names} size="medium" sizing="auto" distanceFactor={5000} priority={1} />
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
  priority = 0,
  overlap = false,
  ...style
}: LabelLayerProps) => {
  const group = useLabelGroup();
  // By value, so a style written inline sets nothing again. JSON writes Infinity as null,
  // which resolving leaves out, as not given: the defaults' Infinity.
  const styleKey = JSON.stringify(style);
  const resolved = useMemo<ResolvedLabelStyle>(
    () => resolveLabelStyle(JSON.parse(styleKey) as Partial<LabelStyle>),
    [styleKey],
  );
  // Its frame: its parent's.
  const frame = useRef<Object3D>(null);
  const layer = useMemo(() => new LabelGroupLayer(group), [group]);
  useLayoutEffect(() => {
    group.add(layer);
    return () => group.remove(layer);
  }, [group, layer]);
  // Each render: only what changed is written again.
  useLayoutEffect(() => {
    layer.set({
      labels,
      provider,
      style: resolved,
      priority,
      overlap,
      visible,
      scaleRef,
      frame: frame.current,
    });
  });

  // The group's work for the frame, done once whichever of its layers asks first.
  useFrame(state =>
    group.frame({
      camera: state.camera,
      width: state.size.width,
      height: state.size.height,
      time: state.clock.elapsedTime,
      renderer: state.gl,
      invalidate: state.invalidate,
    }),
  );

  return <object3D ref={frame} />;
};
