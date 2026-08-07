import { useContext, useEffect, useMemo, useRef, useState } from 'react';
import {
  BufferGeometry,
  DoubleSide,
  Group,
  MeshBasicMaterial,
  Texture,
} from 'three';
import { CommonComponentProps } from '../../common/types';
import { PointerEvents } from '../../events/interaction-events';
import { useGenerator } from '../../hooks/useGenerator';
import { createLayers, LAYERS } from '../../layers/layers';
import { GlyphsContext } from '../../main';
import { useRenderingState } from '../../rendering/rendering-state';
import { SurfaceMeta, unpackBufferGeometry, Vec2 } from '../../sdk';
import {
  EventEmitterCallback,
  useEventEmitter,
} from '../EventEmitter/EventEmitterContext';
import { surfaceGeometry, SurfaceGeometryResponse } from './surface-defs';
import { ContourColorMode } from './SurfaceMaterial';
import { useSurfaceMaterial } from './useSurfaceMaterial';

/**
 * Surface props
 * @expand
 */
export type SurfaceProps = CommonComponentProps &
  PointerEvents & {
    meta: SurfaceMeta;
    color?: string;
    colorRamp?: number;
    rampMin?: number;
    rampMax?: number;
    reverseRamp?: boolean;
    useColorRamp?: boolean;
    showContours?: boolean;
    contoursInterval?: number;
    contoursColorMode?: ContourColorMode;
    contoursColorModeFactor?: number;
    contoursThickness?: number;
    contoursColor?: string;
    opacity?: number;
    priority?: number;
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
    doubleSide?: boolean;
    wireframe?: boolean;
    normalMap?: Texture;
    normalScale?: Vec2;
    /**
     * Precompute the surface normals into a compact texture instead of deriving
     * them per-fragment from the elevation map. This skips the normal recompute
     * the shader otherwise repeats across the order-independent transparency
     * passes, at the cost of a little extra texture memory. Defaults to `false`.
     */
    precomputeNormals?: boolean;
    debug?: boolean;
  };

/**
 * This component renderes a TIN model from an elevation map, according to the `SurfaceMeta` and `SurfaveValues` data types.
 *
 * It has several customization options for rendering the surfaces, including color ramps, contour lines and transparency.
 *
 * Surface values are expected to be in a regular grid. An optimized triangulation is used for the geometry, but color ramp
 * values and contour lines are always using the full resolution of the data for accuracy.
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
  showContours = false,
  contoursInterval = 100,
  contoursColorMode = ContourColorMode.darken,
  contoursColorModeFactor = 0.5,
  contoursThickness = 0.8,
  contoursColor = 'black',
  opacity = 1,
  priority = 0,
  maxError = 5,
  cutHoles = true,
  edgeSmoothing = 0,
  doubleSide = opacity === 1 || false,
  wireframe = false,
  normalMap,
  normalScale,
  precomputeNormals = false,
  name,
  userData,
  receiveShadow,
  castShadow,
  layers,
  position,
  renderOrder,
  visible = true,
  debug = false,
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

  const glyphContext = useContext(GlyphsContext);

  const material = useSurfaceMaterial(meta, {
    color,
    colorRamp,
    rampMin,
    rampMax,
    reverseRamp,
    useColorRamp,
    showContours,
    contoursInterval,
    contoursColorMode,
    contoursColorModeFactor,
    contoursThickness,
    contoursColor,
    opacity,
    doubleSide,
    wireframe,
    normalMap,
    normalScale,
    precomputeNormals,
    priority,
  });

  useEffect(() => {
    if (debug && glyphContext) {
      material.uniformsGroups = [glyphContext.glyphData];
      material.defines.GLYPHS_LENGTH = glyphContext.glyphsCount;
      material.uniforms.glyphAtlas.value = glyphContext.glyphAtlas;
      material.uniforms.digits.value = [
        ...glyphContext.encodeText('0123456789.-').indices,
      ];
    } else {
      material.uniformsGroups = [];
      material.defines.GLYPHS_LENGTH = 1;
      material.uniforms.glyphAtlas.value = null;
      material.uniforms.digits.value = [0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0];
    }
    material.debug = debug;
    material.needsUpdate = true;
    material.uniformsNeedUpdate = true;
  }, [debug, material, glyphContext]);

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

  if (debug && !glyphContext) return null;

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
    </group>
  );
};
