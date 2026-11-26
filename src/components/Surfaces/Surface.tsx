import { useEffect, useMemo, useRef, useState } from 'react';
import {
  BufferGeometry,
  DoubleSide,
  Group,
  MeshBasicMaterial,
  Texture,
} from 'three';
import { CommonComponentProps, ContourColorMode } from '../../common/types';
import type { ColorRampRef } from '../../common/color-ramps';
import { PointerEvents } from '../../events/interaction-events';
import { useGenerator } from '../../hooks/useGenerator';
import { createLayers, LAYERS } from '../../layers/layers';
import { useRenderingState } from '../../rendering/rendering-state';
import { SurfaceMeta, unpackBufferGeometry, Vec2 } from '../../sdk';
import { SurfaceDetail } from '../../sdk/materials/surface-detail';
import {
  EventEmitterCallback,
  useEventEmitter,
} from '../EventEmitter/EventEmitterContext';
import {
  contourLabelStep,
  resolveReliefContourLabels,
  type ReliefContours,
} from '../Scenery/scenery-relief-look';
import { surfaceGeometry, SurfaceGeometryResponse } from './surface-defs';
import {
  resolveSurfaceContours,
  type SurfaceContours,
} from './surface-contours';
import { SurfaceContourLabels } from './SurfaceContourLabels';
import { useSurfaceMaterial } from './useSurfaceMaterial';

export type { SurfaceContours } from './surface-contours';

/**
 * Surface props
 * @expand
 */
export type SurfaceProps = CommonComponentProps &
  PointerEvents & {
    /** The surface's grid: its size, position and depth range, and the id its values are read by. */
    meta: SurfaceMeta;
    /** The colour with `useColorRamp` off. */
    color?: string;
    /** the colour ramp: a row of `colorRampTexture`, a ramp's name (`builtInColorRamps`, or registered), or a `ColorRamp`. Default 0, `'rainbow'` */
    colorRamp?: ColorRampRef;
    /** The depth at the ramp's start. Default the meta's `displayMin`. */
    rampMin?: number;
    /** The depth at the ramp's end. Default the meta's `displayMax`. */
    rampMax?: number;
    /** Run the ramp the other way. Default false. */
    reverseRamp?: boolean;
    /** Colour by depth along `colorRamp`; off, in `color`. Default true. */
    useColorRamp?: boolean;
    /**
     * contour lines by depth, and with `labels` each line's depth written along it (see
     * {@link SurfaceContours}); `true` for the defaults. Given, the `showContours` and
     * `contours*` props are not read
     */
    contours?: boolean | SurfaceContours;
    /** @deprecated use `contours` (these had no major lines: `major: 0`) */
    showContours?: boolean;
    /** @deprecated use `contours.interval` */
    contoursInterval?: number;
    /** @deprecated use `contours.colorMode` */
    contoursColorMode?: ContourColorMode;
    /** @deprecated use `contours.factor` */
    contoursColorModeFactor?: number;
    /** @deprecated use `contours.thickness` */
    contoursThickness?: number;
    /** @deprecated use `contours.color` */
    contoursColor?: string;
    /** Opacity (0..1). Below 1, composited with the scene's other transparent objects. Default 1. */
    opacity?: number;
    /** The priority of its builds on the generators (see `useGenerator`). Default 0. */
    priority?: number;
    /** How far the simplified mesh may depart from the grid, in metres. Default 5. */
    maxError?: number;
    /**
     * Cut no-data holes and the outer data extent with a clean traced rim
     * (constrained Delaunay) instead of filling them from valid neighbours.
     * Defaults to `true`.
     */
    cutHoles?: boolean;
    /**
     * When cutting holes, smooth the traced data rim by this strength so it reads
     * as a continuous curve instead of a grid staircase. `0` (default) keeps the
     * exact cell-edge rim. Trades boundary fidelity for smoothness.
     */
    edgeSmoothing?: number;
    /** Draw its underside too. Default true while opaque, false below 1. */
    doubleSide?: boolean;
    /** Draw its mesh as lines. */
    wireframe?: boolean;
    /** A normal map over the surface. */
    normalMap?: Texture;
    /** The strength of `normalMap`, in x and y. */
    normalScale?: Vec2;
    /**
     * Procedural relief up close, with the zone layers' presets: `'sand'`, `'silt'`,
     * `'shale'`, `'carbonate'`, `'salt'`, `'coal'`, `'basement'` or `'seabed'`, or
     * `{ preset, strength, scale }`. Texture-free and anchored in the scene, so a feature
     * keeps its size on every surface and nothing is set up per surface, as a normal map
     * would need. Which preset a surface takes is the host's call. Default none.
     */
    detail?: SurfaceDetail;
    /**
     * Precompute the surface normals into a compact texture instead of deriving
     * them per-fragment from the elevation map. This skips the normal recompute
     * the shader otherwise repeats across the order-independent transparency
     * passes, at the cost of a little extra texture memory. Defaults to `false`.
     */
    precomputeNormals?: boolean;
  };

/**
 * A depth surface (a horizon) from a regular grid of depths: its `SurfaceMeta` and the values the
 * data store holds for it (`SurfaceValues`). Its mesh is the grid simplified to within
 * `maxError` metres, built by a generator; holes and the edge of the data are cut cleanly
 * (`cutHoles`).
 *
 * Colour it by depth along a colour ramp (`colorRamp`, `rampMin`, `rampMax`) or in one `color`,
 * draw contour lines with their depths written along them (`contours`), and make it see-through
 * (`opacity`). The colours and contour lines read the full grid, however coarse the mesh.
 *
 * @example
 * <Surface meta={meta} />
 *
 * @group Components
 */
export const Surface = ({
  meta,
  color,
  colorRamp = 0,
  rampMin,
  rampMax,
  reverseRamp = false,
  useColorRamp = true,
  contours,
  showContours,
  contoursInterval,
  contoursColorMode,
  contoursColorModeFactor,
  contoursThickness,
  contoursColor,
  opacity = 1,
  priority = 0,
  maxError = 5,
  cutHoles = true,
  edgeSmoothing = 0,
  doubleSide = opacity === 1 || false,
  wireframe = false,
  normalMap,
  normalScale,
  detail,
  precomputeNormals = false,
  name,
  userData,
  receiveShadow,
  castShadow,
  layers,
  position,
  renderOrder,
  visible = true,
  onPointerClick,
  onPointerEnter,
  onPointerLeave,
  onPointerMove,
}: SurfaceProps) => {
  const ref = useRef<Group>(null!);
  const geometryGenerator = useGenerator<SurfaceGeometryResponse>(
    surfaceGeometry,
    priority,
  );

  const [geometry, setGeometry] = useState<BufferGeometry | null>(null);

  const notEmitterLayers = useMemo(() => createLayers(LAYERS.NOT_EMITTER), []);

  // When an OITRenderPass is active it resolves surface self-transparency
  // correctly, so the back-face depth mask is not needed (and would wrongly
  // occlude the transparent surface).
  const oitActive = useRenderingState(s => s.transparencyMode === 'oit');

  // Its contours, by value: the deprecated props mapped in where `contours` is not given.
  const linesKey = JSON.stringify(
    resolveSurfaceContours(contours, {
      showContours,
      contoursInterval,
      contoursColorMode,
      contoursColorModeFactor,
      contoursThickness,
      contoursColor,
    }),
  );
  const lines = useMemo(
    () => JSON.parse(linesKey) as Required<ReliefContours> | null,
    [linesKey],
  );
  const labelLook = useMemo(() => {
    const labels = resolveReliefContourLabels(lines);
    return lines && labels
      ? { step: contourLabelStep(lines, labels), labels }
      : null;
  }, [lines]);

  const material = useSurfaceMaterial(meta, {
    color,
    colorRamp,
    rampMin,
    rampMax,
    reverseRamp,
    useColorRamp,
    contours: lines ?? false,
    opacity,
    doubleSide,
    wireframe,
    normalMap,
    normalScale,
    detail,
    precomputeNormals,
    priority,
  });

  /* This is used to write back-side faces to the depth buffer to avoid self-transparency issues when opacity < 1 */
  const maskMaterial = useMemo(() => {
    const m = new MeshBasicMaterial({
      transparent: true,
      side: DoubleSide,
      colorWrite: false,
      depthWrite: true,
    });
    return m;
  }, []);

  const eventHandler = useEventEmitter();

  // register event handlers
  useEffect(() => {
    let unregister: (() => void) | null = null;
    if (eventHandler && ref.current) {
      const handlers: Record<string, EventEmitterCallback> = {};

      if (onPointerClick) handlers.click = onPointerClick;
      if (onPointerEnter) handlers.enter = onPointerEnter;
      if (onPointerLeave) handlers.leave = onPointerLeave;
      if (onPointerMove) handlers.move = onPointerMove;

      if (Object.keys(handlers).length) {
        unregister = eventHandler.register({
          object: ref.current,
          handlers,
          ref: meta.id,
        });
      }
    }

    return () => {
      if (unregister) unregister();
    };
  }, [
    eventHandler,
    onPointerClick,
    onPointerEnter,
    onPointerLeave,
    onPointerMove,
    meta.id,
  ]);

  useEffect(() => {
    if (geometryGenerator) {
      geometryGenerator(meta.id, maxError, cutHoles, edgeSmoothing).then(
        response => {
          let bufferGeometry: BufferGeometry | null = null;
          if (response) {
            bufferGeometry = unpackBufferGeometry(response);
          }
          setGeometry(bufferGeometry);
        },
      );
    }
  }, [geometryGenerator, meta.id, maxError, cutHoles, edgeSmoothing]);

  // Dispose the library-created geometry when it is replaced or on unmount.
  useEffect(() => {
    return () => {
      geometry?.dispose();
    };
  }, [geometry]);

  // Dispose the library-created back-face mask material on unmount.
  useEffect(() => {
    return () => {
      maskMaterial.dispose();
    };
  }, [maskMaterial]);

  return (
    <group
      ref={ref}
      name={name}
      userData={userData}
      visible={visible}
      position={position}
    >
      {geometry && opacity < 1 && !oitActive && (
        <mesh
          geometry={geometry}
          material={maskMaterial}
          layers={notEmitterLayers}
          renderOrder={(renderOrder || 0) - 0.1}
        />
      )}
      {geometry && (
        <mesh
          castShadow={castShadow}
          receiveShadow={receiveShadow}
          geometry={geometry}
          material={material}
          layers={layers}
          renderOrder={renderOrder}
        />
      )}
      {geometry && labelLook && (
        <SurfaceContourLabels
          meta={meta}
          material={material}
          look={labelLook}
          visible={visible}
          frame={ref}
        />
      )}
    </group>
  );
};
