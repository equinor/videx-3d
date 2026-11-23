import { useEffect, useMemo, useState } from 'react';
import { Color, DataTexture, DoubleSide, FrontSide, Texture } from 'three';
import { ColorRampRef, resolveColorRamp } from '../../common/color-ramps';
import { ContourColorMode } from '../../common/types';
import { useGenerator } from '../../hooks/useGenerator';
import {
  createElevationTexture,
  createPackedNormalTexture,
  SurfaceDetail,
  SurfaceMeta,
  Vec2,
} from '../../sdk';
import type { ReliefContours } from '../Scenery/scenery-relief-look';
import { surfaceTextures, SurfaceTexturesResponse } from './surface-defs';
import {
  resolveSurfaceContours,
  type SurfaceContours,
} from './surface-contours';
import { SurfaceMaterial } from './SurfaceMaterial';

/** Appearance options for {@link useSurfaceMaterial}. */
export type SurfaceMaterialOptions = {
  color?: string;
  /** a row of `colorRampTexture`, a ramp's name, or a `ColorRamp` (`resolveColorRamp`) */
  colorRamp?: ColorRampRef;
  /** colour ramp lower bound. Defaults to the meta's `displayMin`. */
  rampMin?: number;
  /** colour ramp upper bound. Defaults to the meta's `displayMax`. */
  rampMax?: number;
  reverseRamp?: boolean;
  useColorRamp?: boolean;
  /**
   * contour lines by depth (see {@link SurfaceContours}; their `labels` are a `Surface`'s
   * to draw); `true` for the defaults. Given, the `showContours` and `contours*` options
   * are not read
   */
  contours?: boolean | SurfaceContours;
  /** @deprecated use `contours` */
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
  opacity?: number;
  doubleSide?: boolean;
  wireframe?: boolean;
  normalMap?: Texture;
  normalScale?: Vec2;
  /**
   * procedural relief up close, a chunk layer's presets (`'sand'`, `'shale'`, …, or
   * `{ preset, strength, scale }`; see {@link SurfaceMaterial.detail}). Default none
   */
  detail?: SurfaceDetail;
  /**
   * Precompute the surface normals into a compact texture instead of deriving
   * them per-fragment from the elevation map. Defaults to `false`.
   */
  precomputeNormals?: boolean;
  /**
   * Trust the GEOMETRY where the grid has no data, instead of discarding there.
   * Defaults to `false` — set it when drawing on a **chunk** layer, whose mesh is
   * authoritative (see {@link SurfaceMaterial.geometryFallback}). On a `Surface`,
   * whose mesh is built from the grid, the discard is correct and this must stay
   * off.
   */
  geometryFallback?: boolean;
  /** generator priority for the texture fetch */
  priority?: number;
};

/**
 * Build (and keep up to date) a {@link SurfaceMaterial} configured for one
 * surface: its elevation texture is fetched via the `surfaceTextures` generator,
 * and the grid uniforms are taken from the `SurfaceMeta`.
 *
 * The material reads the grid through the geometry's **UV attribute**, so it works
 * on anything carrying grid-space `[0, 1]` UVs for that surface — a `Surface`
 * mesh, or a chunk layer built on a shared tessellation (which writes per-layer
 * grid UVs). That is what makes it usable as `Chunk`'s `topMaterial`.
 *
 * The material is created and disposed by this hook, so the caller must not
 * dispose it.
 *
 * @example
 * const topMaterial = useSurfaceMaterial(topMeta, { contours: true });
 * <Chunk groups={groups} topMaterial={topMaterial} />
 *
 * @group Hooks
 */
export function useSurfaceMaterial(
  meta: SurfaceMeta,
  options?: SurfaceMaterialOptions,
): SurfaceMaterial;
export function useSurfaceMaterial(
  meta: SurfaceMeta | null | undefined,
  options?: SurfaceMaterialOptions,
): SurfaceMaterial | undefined;
export function useSurfaceMaterial(
  meta: SurfaceMeta | null | undefined,
  options: SurfaceMaterialOptions = {},
): SurfaceMaterial | undefined {
  const {
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
    doubleSide = opacity === 1 || false,
    wireframe = false,
    normalMap,
    normalScale,
    detail,
    precomputeNormals = false,
    geometryFallback = false,
    priority = 0,
  } = options;

  const texturesGenerator = useGenerator<SurfaceTexturesResponse>(
    surfaceTextures,
    priority,
  );

  const [elevationTexture, setElevationTexture] = useState<DataTexture | null>(
    null,
  );
  const [normalTexture, setNormalTexture] = useState<DataTexture | null>(null);

  const material = useMemo(() => {
    return new SurfaceMaterial({
      useColorRamp: true,
      forceSinglePass: true,
      saturation: 1,
      brightness: 0,
      colorRampIndex: 0,
      colorRampReverse: false,
      colorRampMin: 0,
      colorRampMax: 0,
      referenceDepth: 0,
      side: FrontSide,
      wireframe: false,
      flatShading: false,
      transparent: true,
      opacity: 1,
      depthWrite: false,
    });
  }, []);

  // By value, so contours written inline set nothing again.
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

  // --- grid uniforms (from the meta) + the reactive appearance ---------------
  useEffect(() => {
    if (!meta) return;
    material.uniforms.colorRampIndex.value = resolveColorRamp(colorRamp);
    material.uniforms.opacity.value = opacity;
    material.uniforms.colorRampMin.value = rampMin ?? meta.displayMin;
    material.uniforms.colorRampMax.value = rampMax ?? meta.displayMax;
    material.uniforms.colorRampReverse.value = reverseRamp;
    material.uniforms.referenceDepth.value = meta.max;
    material.uniforms.size.value.set(meta.header.nx, meta.header.ny);
    material.uniforms.scale.value.set(meta.header.xinc, meta.header.yinc);
    material.uniforms.rotation.value = meta.header.rot * (Math.PI / 180);
    material.uniformsNeedUpdate = true;
    if (normalScale) {
      material.uniforms.normalScale.value.set(...normalScale);
    }
  }, [
    material,
    meta,
    colorRamp,
    opacity,
    rampMin,
    rampMax,
    reverseRamp,
    normalScale,
  ]);

  useEffect(() => {
    const lines = JSON.parse(linesKey) as Required<ReliefContours> | null;
    material.showContours = !!lines;
    if (!lines) return;
    const { uniforms } = material;
    uniforms.contoursInterval.value = lines.interval;
    uniforms.contoursMajor.value = lines.major;
    uniforms.contoursThickness.value = lines.thickness;
    uniforms.contoursColorMode.value = lines.colorMode;
    uniforms.contoursColorModeFactor.value = lines.factor;
    (uniforms.contoursColor.value as Color).set(lines.color);
    material.uniformsNeedUpdate = true;
  }, [material, linesKey]);

  // By value, so an inline `{ preset, strength }` does not rewrite it every render.
  const detailKey = JSON.stringify(detail ?? null);
  useEffect(() => {
    material.detail = JSON.parse(detailKey) as SurfaceDetail | null;
  }, [material, detailKey]);

  useEffect(() => {
    material.wireframe = wireframe;
    material.useColorRamp = useColorRamp;
    material.geometryFallback = geometryFallback;
    material.color = color || material.color;
    material.side = doubleSide ? DoubleSide : FrontSide;
    if (normalMap) {
      material.normalMap = normalMap;
    }
    const depthWrite = opacity === 1;
    if (depthWrite !== material.depthWrite) {
      material.depthWrite = depthWrite;
      material.needsUpdate = true;
    }
  }, [
    material,
    useColorRamp,
    wireframe,
    color,
    doubleSide,
    geometryFallback,
    normalMap,
    opacity,
  ]);

  // --- textures --------------------------------------------------------------
  useEffect(() => {
    if (!texturesGenerator || !meta) return;
    let cancelled = false;
    texturesGenerator(meta.id, precomputeNormals).then(response => {
      if (cancelled || !response) return;
      const { elevationImageBuffer, normalImageBuffer } = response;
      setElevationTexture(
        createElevationTexture(
          elevationImageBuffer,
          meta.header.nx,
          meta.header.ny,
        ),
      );
      // Only upload the precomputed normals when the feature is enabled, so the
      // memory cost is opt-in (the buffer is generated either way, off the main
      // thread).
      setNormalTexture(
        precomputeNormals && normalImageBuffer
          ? createPackedNormalTexture(
              normalImageBuffer,
              meta.header.nx,
              meta.header.ny,
            )
          : null,
      );
    });
    return () => {
      cancelled = true;
    };
  }, [texturesGenerator, meta, precomputeNormals]);

  useEffect(() => {
    return () => {
      elevationTexture?.dispose();
    };
  }, [elevationTexture]);

  useEffect(() => {
    return () => {
      normalTexture?.dispose();
    };
  }, [normalTexture]);

  useEffect(() => {
    material.usePrecomputedNormals = precomputeNormals && !!normalTexture;
    material.uniforms.normalTexture.value = normalTexture;
  }, [material, precomputeNormals, normalTexture]);

  useEffect(() => {
    if (!elevationTexture) return;
    const { width, height } = elevationTexture.image;
    const sx = (width - 1) / width;
    const sy = (height - 1) / height;
    const tx = (1 - sx) / 2;
    const ty = (1 - sy) / 2;
    material.uniforms.elevationTexture.value = elevationTexture;
    material.uniforms.gridUvMat.value.setUvTransform(tx, ty, sx, sy, 0, 0, 0);
  }, [elevationTexture, material]);

  useEffect(() => {
    return () => {
      material.dispose();
    };
  }, [material]);

  return meta ? material : undefined;
}
