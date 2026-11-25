import { useThree } from '@react-three/fiber';
import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import {
  BufferAttribute,
  BufferGeometry,
  DataTexture,
  DoubleSide,
  Group,
  IUniform,
  Material,
  Mesh,
  MeshBasicMaterial,
  Object3D,
  Vector4,
} from 'three';
import { useReleasedFrame } from '../../hooks/useReleasedFrame';
import { precompile, releaseMaterial } from '../../rendering/precompile';
import { PlanarPolygonCoordinates } from '../../sdk';
import {
  SurfaceZone,
  SurfaceZoneMesh,
} from '../../sdk/geometries/surface-zone';
import { StackTiling } from '../../sdk/geometries/surface-stack';
import type { HeightFieldClipUniforms } from '../../sdk/materials/height-field-clip';
import {
  capCullingBlocked,
  capCut,
  CapCutRule,
  capOpenTable,
  layerCapOpacity,
  openIntervals,
} from './cap-visibility';
import { ZoneContactTexture, resolveLayerContacts } from './zone-contacts';
import { ZONE_MATERIAL_LINGER, releaseGeometry } from './zone-resources';
import type { WaterBody } from '../../sdk/materials/water-body';
import { ZoneDepthMap } from './zone-depth-map';
import { ZoneDetail } from './zone-detail';
import {
  bindZoneNormalMap,
  ZoneMaterial,
  ZoneFenceUniforms,
  ZoneFenceOverlayUniforms,
  ZoneWaterTintParameters,
  createCapNormalTexture,
  createTileUniforms,
} from './zone-material';
import {
  ZoneFenceState,
  ZoneLayer,
  ZonePeel,
  ZoneSectionState,
  DEFAULT_BED_TINT_DEPTH,
  DEFAULT_PALETTE,
  resolvePeel,
  ZoneStackSea,
} from './zone-defs';
import {
  ZoneInferenceStyle,
  createInferenceMaterial,
} from './inference-material';
import { useZoneFenceFace } from './useZoneFenceFace';
import { useZoneSection } from './useZoneSection';
import { useCameraIntervals, useCulledCaps } from './useCapCulling';
import { zoneLodActive, useZoneLod } from './useZoneLod';

/** An untiled zone's layout: every point in tile 0. */
const SINGLE_TILE: StackTiling = {
  cells: 1,
  first: [0, 0],
  count: [1, 1],
  toGrid: [0, 0, 0, 0, 0, 0],
};

const NO_PATCHES = new Map<number, BufferGeometry>();

/**
 * {@link ZoneMeshes} props.
 * @expand
 * @group Components
 */
export type ZoneMeshesProps = {
  /** a built zone (from the `surfaceZone` generator) */
  zone: SurfaceZone;
  /**
   * The layers the zone was built from, in the same order — the source of each
   * mesh's material. Every zone mesh carries its layer index, so a dropped layer
   * or an unfilled interval cannot shift the mapping.
   */
  layers: ZoneLayer[];
  /** surface (top) opacity. Reactive. Default 1. */
  surfaceOpacity?: number;
  /** wall opacity. Reactive. Default 1. */
  wallOpacity?: number;
  /** wireframe. Reactive. Default false. */
  wireframe?: boolean;
  /**
   * How the INVENTED part of the zone is marked — the geometry a seal built where
   * no surface was mapped. Drawn as a pattern OVER the unit's own material, so it
   * works whatever that material is. Default `'hatched'`. See
   * {@link ZoneInferenceStyle}.
   */
  inferredStyle?: ZoneInferenceStyle;
  /** render the surface tops. Default true. */
  showSurfaces?: boolean;
  /** render the side walls. Default true. */
  showWalls?: boolean;
  /**
   * The sea the enclosing `ZoneStack` declares, if any. Only its TINT is used
   * here: the sea's own geometry belongs to the stack.
   */
  sea?: ZoneStackSea | null;
  /** 1 while the stack draws its sea, 0 while not: the bed tint follows it */
  waterTintShown?: IUniform<number>;
  /** the stack's own water, which its sea bed's cap is seen through (`ZoneStackContextValue.waterBody`) */
  waterBody?: WaterBody | null;
  /**
   * The sea bed's depth grid, from the stack. Drives the bed tint by the water
   * standing over each fragment's MAP location instead of by its own depth — which
   * is what lets the sea-bed unit's rim WALL be tinted at all.
   */
  bathymetry?: ZoneDepthMap | null;
  /**
   * Whether layer 0 is the stack's sea BED. A sea a cut leaves whole keeps its bed
   * cap whole with it, the way a kept unit keeps the cap that floors it — and so
   * does a cut sea under `ZoneStackSea.keepBed`.
   */
  seabed?: boolean;
  /** whether the section takes the sea with it (see `ZoneSection.sea`) */
  sectionSea?: boolean;
  /** whether the fence takes the sea with it (see `ZoneFence.sea`) */
  fenceSea?: boolean;
  /**
   * Cap colour for the column's floor, when this zone closes the block (see
   * `ZoneStackProps.carrier`). The floor is INFERRED from a fill on the last
   * layer, so it has no `ZoneLayer` of its own to carry one. Omit it and the
   * floor is drawn with the fill of the unit resting on it.
   */
  carrierMaterial?: string;
  /** procedural detail for the floor's own material (see `ZoneCarrier.detail`) */
  carrierDetail?: ZoneDetail;
  /** contacts drawn as lines on every layer that does not opt out */
  contacts?: ZoneContactTexture[] | null;
  /**
   * The stack's live clip plane, if any (see `ZoneStackProps.section`). Drives
   * both the shader's cut and the cut FACE built from the zone's own channels.
   */
  section?: ZoneSectionState | null;
  /**
   * The same plane as a shared uniform, handed to every material built here so a
   * moving plane never rebuilds one. ⚠️ A caller-supplied `Material` cannot be
   * given it, so such a layer is not cut.
   */
  sectionUniform?: IUniform<Vector4>;
  /**
   * The negated plane (see `ZoneStackContextValue.sectionUniformInverse`), which
   * is what lets a cap's dropped fragments be restored only in the half the layer
   * that covered them was cut away from.
   */
  sectionUniformInverse?: IUniform<Vector4>;
  /**
   * Cut the column's floor with the rest of the block (see
   * `ZoneSection.carrier`). Default false, which leaves the block standing on an
   * intact base plate.
   */
  sectionCarrier?: boolean;
  /** whether the section is drawing (see `ZoneStackContextValue.sectionEnabled`) */
  sectionEnabled?: boolean;
  /** the stack's live fence, or `null` for none */
  fence?: ZoneFenceState | null;
  /** the fence's shared uniforms (see `ZoneStackContextValue.fenceUniforms`) */
  fenceUniforms?: ZoneFenceUniforms;
  /** their complement, for the peel patch */
  fenceUniformsInverse?: ZoneFenceUniforms;
  /** the fence faces' overlay (see `ZoneFence.overlay`), or `null` for none */
  fenceOverlayUniforms?: ZoneFenceOverlayUniforms | null;
  /** whether the column's floor is cut by the fence */
  fenceCarrier?: boolean;
  /**
   * The ground drawn over the stack (see `ZoneStackContextValue.heightClip`): every
   * material made here leaves out what lies above it
   */
  heightClip?: HeightFieldClipUniforms;
  /**
   * Peel units of the zone away to expose what is under them — see
   * {@link ZonePeel}. A number peels a prefix off the top; `{ from, count }`
   * opens a window and caps its exposed base with the next surface.
   *
   * ⭐ Exact and free, unlike lowering the opacity: alpha compounds, so a deep
   * stack at 0.5 is effectively opaque and a transparency slider cannot answer
   * "what is underneath". Not drawing part of the depth-ordered layers is exact.
   */
  peel?: ZonePeel;
  /** skip cap triangles buried inside the block (see `ZoneProps.cullHiddenCaps`). Default true. */
  cullHiddenCaps?: boolean;
  /** the polygon the zone was clipped to, in scene XZ: lets the culling tell a camera outside the block */
  boundary?: PlanarPolygonCoordinates | null;
  /** skip cap tiles outside the view while LOD draws (see `ZoneProps.cullOffscreen`). Default true. */
  cullOffscreen?: boolean;
  /**
   * The layers to draw so far — caps, walls and cut faces — or omit to draw
   * them all. What spreads a zone's GPU upload over frames.
   */
  layersShown?: ReadonlySet<number>;
  /** layers NOT to draw: a preview's, once the real zone draws them */
  layersHidden?: ReadonlySet<number>;
  /** saturation of every material made here: 1 (default) as lit, 0 grey */
  saturation?: number;
  /**
   * tint by tessellation tile and draw the seams, when the zone was tiled: by
   * level of detail while one is chosen, otherwise a checker
   */
  debugTiles?: boolean;
  /**
   * Draw every cap at this coarser level of detail (1 = the first), when the
   * zone was built with `lod`. A debug view: hidden-cap culling and peel patches
   * are off while it is set. Default 0 (full detail).
   */
  lodLevel?: number;
  /**
   * With levels of detail built, pick one per tile so that its height error
   * stays under this many pixels on screen. 0 = full detail everywhere.
   * Culling and peel patches are off while levels are in use. Default 2.
   */
  lodPixelError?: number;
};

/**
 * Presentational renderer for a built {@link SurfaceZone}'s geological meshes
 * (surfaces + walls). This is the reactive **appearance** layer: it
 * resolves each layer's material — a caller-supplied `Material`, a colour, or the
 * built-in palette — and rebuilds them on appearance change (a fresh identity so
 * the OIT pass re-classifies) but never touches geometry.
 *
 * ⚠️ A caller-supplied `Material` is used AS GIVEN and never disposed here. The
 * materials this component creates support the OIT pipeline; a caller's does not
 * have to, but one that does not will be drawn by `OITRenderPass` as an ordinary
 * opaque material (`makeOitCompatible` is offered for that, not required).
 * Materials built from a colour are owned and disposed by this component.
 *
 * Geometry ownership (build + disposal) stays with the parent (`Zone`); this
 * component only owns the materials it created.
 *
 * @group Components
 */
/**
 * The inference-marking overlays: one material per distinct (opacity, cut) pair,
 * built lazily, plus the lookups that pick the right one per layer.
 *
 * ⚠️⚠️ MODULE SCOPE, DELIBERATELY. These closures outlive a geometry rebuild —
 * they are memoized on APPEARANCE only — and V8 gives a function scope ONE
 * `Context` holding every variable captured by any closure inside it. Defined in
 * the component body they therefore pinned that render's `zone`, i.e. a whole
 * stack of geometry, until the appearance happened to change. Passing the inputs
 * as arguments keeps the captured scope to exactly these parameters.
 */
function buildInferenceOverlays(
  inferredStyle: ZoneInferenceStyle,
  layers: ZoneLayer[],
  surfaceOpacity: number,
  wallOpacity: number,
  wireframe: boolean,
  seabedBySection: boolean,
  seabedByFence: boolean,
  sectionUniform?: IUniform<Vector4>,
  fenceUniforms?: ZoneFenceUniforms,
  heightClip?: HeightFieldClipUniforms,
) {
  const cutSection = (i: number) => capCut(layers, i, seabedBySection);
  const cutFence = (i: number) => capCut(layers, i, seabedByFence);
  const built = new Map<string, Material | null>();
  const at = (opacity: number, section: boolean, fence: boolean) => {
    if (wireframe) return null;
    const key = `${opacity}/${section}/${fence}`;
    if (!built.has(key)) {
      built.set(
        key,
        createInferenceMaterial(inferredStyle, {
          opacity,
          sectionPlane: section ? sectionUniform : undefined,
          fence: fence ? fenceUniforms : undefined,
          heightClip,
        }),
      );
    }
    return built.get(key) ?? null;
  };
  const keptUnit = (i: number) => layers[i]?.section === false;
  return {
    surface: (layer: number) =>
      at(
        layerCapOpacity(layers[layer], surfaceOpacity),
        cutSection(layer),
        cutFence(layer),
      ),
    wall: (layer: number) =>
      at(
        layers[layer]?.opacity ?? wallOpacity,
        !keptUnit(layer),
        !keptUnit(layer),
      ),
    // Never cut, for the reason the face's own material is not: it lies on the
    // cut, so testing it against it would hatch nothing at all.
    face: (layer: number) =>
      at(layers[layer]?.opacity ?? wallOpacity, false, false),
    built,
  };
}

export const ZoneMeshes = ({
  zone,
  layers,
  surfaceOpacity = 1,
  wallOpacity = 1,
  wireframe = false,
  inferredStyle = 'hatched',
  showSurfaces = true,
  showWalls = true,
  sea = null,
  waterTintShown,
  bathymetry = null,
  seabed = false,
  sectionSea = false,
  waterBody,
  fenceSea = false,
  carrierMaterial,
  carrierDetail,
  contacts = null,
  section = null,
  sectionUniform,
  sectionUniformInverse,
  sectionCarrier = false,
  sectionEnabled = true,
  fence = null,
  fenceUniforms,
  fenceUniformsInverse,
  fenceOverlayUniforms = null,
  fenceCarrier = false,
  heightClip,
  peel = 0,
  cullHiddenCaps = true,
  boundary = null,
  cullOffscreen = true,
  layersShown,
  layersHidden,
  saturation = 1,
  debugTiles = false,
  lodLevel = 0,
  lodPixelError = 2,
}: ZoneMeshesProps) => {
  // ⚠️ `fence` is a STABLE object mutated from the frame loop, so a change to
  // `fence.debug` is invisible to React and the materials below would keep the
  // ones they were first built with. Mirroring it into state is what makes the
  // toggle work without a remount.
  const [fenceDebug, setFenceDebug] = useState(fence?.debug === true);
  useReleasedFrame(() => {
    const wanted = fence?.debug === true;
    if (wanted !== fenceDebug) setFenceDebug(wanted);
  });

  // One saturation for every material made here, so changing it rebuilds none.
  const [saturationUniform] = useState<IUniform<number>>(() => ({ value: 1 }));
  useEffect(() => {
    saturationUniform.value = saturation;
  }, [saturationUniform, saturation]);

  // Keyed by the layout, not the zone: the closures below must not pin geometry.
  // Each tile's level, which the caps read their normals by and the tint shows; an
  // untiled zone with levels is one tile.
  const hasLevels = !!zone.metrics.lodErrors;
  const tiling = zone.metrics.tiling ?? (hasLevels ? SINGLE_TILE : undefined);
  const tilingKey = tiling ? JSON.stringify(tiling) : '';
  const tileUniforms = useMemo(
    () => (tilingKey ? createTileUniforms(JSON.parse(tilingKey)) : undefined),
    [tilingKey],
  );
  useEffect(() => () => tileUniforms?.values.value.dispose(), [tileUniforms]);

  // Whether each cut leaves the sea bed's cap whole: the sea is kept, or `keepBed`.
  const keepBed = sea?.keepBed === true;
  const seabedBySection = seabed && (!sectionSea || keepBed);
  const seabedByFence = seabed && (!fenceSea || keepBed);

  // Its materials are let go through the renderer's compile queue (`releaseMaterial`): not
  // while their programs link, and kept a while for the next build's, made once it comes in,
  // to take their programs over rather than compile them again (Zone lets the old zone
  // go at once).
  const gl = useThree(state => state.gl);

  const materials = useMemo(() => {
    // Every material built here is owned here and disposed on cleanup.
    const owned: Material[] = [];
    const make = (
      color: string,
      opacity: number,
      detail?: ZoneDetail,
      wall = false,
      waterTint?: ZoneWaterTintParameters,
      options?: {
        section?: boolean;
        fence?: boolean;
        inverse?: boolean;
        contacts?: ZoneContactTexture[];
        fenceOverlay?: ZoneFenceOverlayUniforms;
        overlayOnly?: boolean;
      },
    ) => {
      // A unit kept whole opts out of both cuts; the floor opts out of each
      // separately, since only one of the two is ever live.
      const cutSection = options?.section !== false;
      const cutFence = options?.fence !== false;
      const material = new ZoneMaterial({
        color,
        opacity,
        transparent: opacity < 1,
        depthWrite: opacity >= 1,
        wireframe,
        detail,
        wall,
        waterTint,
        contacts: options?.contacts,
        fenceOverlay: options?.fenceOverlay,
        fenceOverlayOnly: options?.overlayOnly,
        saturation: saturationUniform,
        tiles: debugTiles ? tileUniforms : undefined,
        tileLevels: hasLevels ? tileUniforms : undefined,
        sectionPlane: !cutSection
          ? undefined
          : options?.inverse
            ? sectionUniformInverse
            : sectionUniform,
        fence: !cutFence
          ? undefined
          : options?.inverse
            ? fenceUniformsInverse
            : fenceUniforms,
        heightClip,
        // The seabed alone lies under the water: the shallowest cap, given the tint. The
        // stack's own water, and the cuts that take it.
        water: waterTint && waterBody ? waterBody : undefined,
        waterCut:
          waterTint && waterBody
            ? {
                section: sectionSea ? sectionUniform : undefined,
                fence: fenceSea ? fenceUniforms : undefined,
              }
            : undefined,
      });
      owned.push(material);
      return material;
    };

    // ⚠️ Every contact on every layer unless the caller says otherwise: a contact
    // is interpreted data drawn as given, and masking it to a unit is the host's
    // interpretation to add.
    const layerContacts = (i: number) =>
      contacts
        ? resolveLayerContacts(contacts, layers[i]?.contacts)
        : undefined;

    const paletteAt = (i: number) =>
      DEFAULT_PALETTE[i % DEFAULT_PALETTE.length];

    // ⭐ A unit is bounded by TWO caps, so keeping one whole has to keep the cap
    // that FLOORS it as well — a lid over open space is the hollow shell the
    // section exists to avoid. Hence the `i - 1` term: a cap survives the cut when
    // the unit above it or the unit below it does. Keeping adjacent units shares
    // the cap between them, once. A sea left whole by a cut keeps its bed the same way.
    const keptUnit = (i: number) => layers[i]?.section === false;
    const cutWall = (i: number) => !keptUnit(i);
    const cutCapBySection = (i: number) => capCut(layers, i, seabedBySection);
    const cutCapByFence = (i: number) => capCut(layers, i, seabedByFence);

    // The sea's water over the SHALLOWEST cap: its wet band at the shoreline. The water
    // column over it fades it, as everything in the water, by the scene's water (water-body.glsl).
    const waterTint = ((): ZoneWaterTintParameters | undefined => {
      if (!sea) return undefined;
      return {
        level: -(sea.depth ?? 0),
        strength: 1,
        depth: DEFAULT_BED_TINT_DEPTH,
        map: bathymetry ?? undefined,
        wetBand: sea.wetBand,
        wetStrength: sea.wetStrength,
        shown: waterTintShown,
      };
    })();

    const surfaces = layers.map((layer, i) =>
      make(
        layer.material ?? paletteAt(i),
        layerCapOpacity(layer, surfaceOpacity),
        layer.detail,
        false,
        i === 0 ? waterTint : undefined,
        {
          section: cutCapBySection(i),
          fence: cutCapByFence(i),
          contacts: layerContacts(i),
        },
      ),
    );

    // A void's upper copy is drawn with the material of the interval ABOVE it, but
    // it is a CAP: it has no `wallV` attribute, so it needs its own instance rather
    // than the wall's (which anchors bedding to that axis). Made on first use, as
    // are the patches below: a streamed zone's caps are still arriving.
    // ⚠️ These getters pin the render that made them, which holds only this
    // build's zone because a new build remounts this component.
    const ceilings = new Map<number, Material | null>();
    const ceiling = (i: number) => {
      if (!ceilings.has(i)) {
        const layer = layers[i];
        const fill = layer ? fillOf(layer, i) : null;
        ceilings.set(
          i,
          fill === null
            ? null
            : // A ceiling is the BASE of the interval above it, so it follows
              // that unit rather than its own layer index.
              make(
                fill,
                layer.opacity ?? wallOpacity,
                layer.detail,
                false,
                undefined,
                {
                  section: !keptUnit(i),
                  fence: !keptUnit(i),
                  contacts: layerContacts(i),
                },
              ),
        );
      }
      return ceilings.get(i) ?? null;
    };

    // `fill: true` means "the same as my own cap" — the common case for a layer
    // whose wall should read as the unit hanging below its top surface.
    const fillOf = (layer: ZoneLayer, i: number) => {
      const fill =
        layer.fill === true ? (layer.material ?? paletteAt(i)) : layer.fill;
      return fill === undefined || fill === null || fill === false
        ? null
        : fill;
    };

    const walls = layers.map((layer, i) => {
      const fill = fillOf(layer, i);
      if (fill === null) return null;
      return make(
        fill,
        layer.opacity ?? wallOpacity,
        layer.detail,
        true,
        undefined,
        {
          section: cutWall(i),
          fence: cutWall(i),
          contacts: layerContacts(i),
        },
      );
    });

    // ⚠️⚠️ A cut FACE must not carry the cut it exists to close, whichever cut it
    // is. A fence's face lies exactly on the curve while the shader tests the
    // field's INTERPOLATED zero crossing — metres out against an offset of
    // centimetres — so testing it punches holes along its whole length. A plane's
    // test IS exact either side, but the face still has to sit PROUD of the block
    // (which survives right up to the plane), and proud means on the removed side
    // of its own test.
    const faces =
      !fence && !sectionUniform
        ? []
        : layers.map((layer, i) => {
            if (fence && fenceDebug) {
              const material = new MeshBasicMaterial({
                color: '#ff00ff',
                wireframe: true,
                side: DoubleSide,
                toneMapped: false,
              });
              owned.push(material);
              return material;
            }
            const fill = fillOf(layer, i);
            return make(
              fill === null ? paletteAt(i) : fill,
              layer.opacity ?? wallOpacity,
              layer.detail,
              true,
              undefined,
              {
                section: false,
                fence: false,
                contacts: layerContacts(i),
                fenceOverlay: fence
                  ? (fenceOverlayUniforms ?? undefined)
                  : undefined,
              },
            );
          });

    const carrier = !carrierMaterial
      ? null
      : make(carrierMaterial, surfaceOpacity, carrierDetail, false, undefined, {
          // The floor is the base of the deepest unit, so keeping that unit keeps
          // it — AND'd with the explicit toggle rather than overriding it, so a
          // caller can still keep the base plate whole on its own.
          section: sectionCarrier && !keptUnit(layers.length - 1),
          fence: fenceCarrier && !keptUnit(layers.length - 1),
        });

    // A fence face across an unfilled interval carries the overlay and nothing else.
    const gapFace =
      fence && fenceOverlayUniforms
        ? make('#000000', 1, undefined, true, undefined, {
            section: false,
            fence: false,
            fenceOverlay: fenceOverlayUniforms,
            overlayOnly: true,
          })
        : null;

    // ⭐ The fragments a cap gave up because a layer ABOVE covered them, restored
    // where that cover has gone. Two ways it can go, so two materials: peeled away
    // entirely (draw wherever the cap draws, cut as it is) or cut away by the
    // section or fence (draw only in the half it vacated, which is what the inverse
    // uniforms give).
    const patches = new Map<
      number,
      { open: Material; cut: Material | null } | null
    >();
    const patch = (layer: number) => {
      if (!patches.has(layer)) {
        const declared = layers[layer];
        patches.set(
          layer,
          !declared
            ? null
            : {
                open: make(
                  declared.material ?? paletteAt(layer),
                  layerCapOpacity(declared, surfaceOpacity),
                  declared.detail,
                  false,
                  layer === 0 ? waterTint : undefined,
                  {
                    // Peeled, the patch is part of the revealed surface: cut as its cap is.
                    section: cutCapBySection(layer),
                    fence: cutCapByFence(layer),
                    contacts: layerContacts(layer),
                  },
                ),
                cut: sectionUniformInverse
                  ? make(
                      declared.material ?? paletteAt(layer),
                      layerCapOpacity(declared, surfaceOpacity),
                      declared.detail,
                      false,
                      layer === 0 ? waterTint : undefined,
                      {
                        inverse: true,
                        contacts: layerContacts(layer),
                      },
                    )
                  : null,
              },
        );
      }
      return patches.get(layer) ?? null;
    };

    return {
      surfaces,
      walls,
      ceiling,
      carrier,
      patch,
      owned,
      faces,
      gapFace,
    };
  }, [
    layers,
    surfaceOpacity,
    wallOpacity,
    wireframe,
    sea,
    waterTintShown,
    bathymetry,
    seabedBySection,
    seabedByFence,
    carrierMaterial,
    carrierDetail,
    contacts,
    sectionUniform,
    sectionUniformInverse,
    sectionCarrier,
    fence,
    fenceDebug,
    fenceUniforms,
    fenceUniformsInverse,
    fenceOverlayUniforms,
    fenceCarrier,
    heightClip,
    saturationUniform,
    tileUniforms,
    debugTiles,
    hasLevels,
    waterBody,
    sectionSea,
    fenceSea,
  ]);

  useEffect(() => {
    return () =>
      materials.owned.forEach(m =>
        releaseMaterial(gl, m, { linger: ZONE_MATERIAL_LINGER }),
      );
  }, [materials, gl]);

  // The marking is drawn OVER the unit's own material rather than being part of
  // it, so it works over a caller-supplied (possibly textured) Material as well as
  // over ours. One per distinct opacity, since a translucent unit should not be
  // marked opaquely. ⚠️ Suppressed in wireframe, where an overlay is only noise.
  // ⚠️⚠️ Keyed on whether it is CUT as well: the overlay is a second mesh with its
  // own material, so a kept unit whose marking was still cut would lose its
  // hatching at the plane while the rock stayed.
  const overlays = useMemo(
    () =>
      buildInferenceOverlays(
        inferredStyle,
        layers,
        surfaceOpacity,
        wallOpacity,
        wireframe,
        seabedBySection,
        seabedByFence,
        sectionUniform,
        fenceUniforms,
        heightClip,
      ),
    [
      inferredStyle,
      layers,
      surfaceOpacity,
      wallOpacity,
      wireframe,
      seabedBySection,
      seabedByFence,
      sectionUniform,
      fenceUniforms,
      heightClip,
    ],
  );

  useEffect(() => {
    const { built } = overlays;
    return () =>
      built.forEach(
        m => m && releaseMaterial(gl, m, { linger: ZONE_MATERIAL_LINGER }),
      );
  }, [overlays, gl]);

  // The cut face of each filled interval, rebuilt every frame from the zone's own
  // channels. It is drawn with the interval's own fill material, so per-layer
  // opacity, detail and a caller's own `Material` all carry onto the section.
  const planeFaces = useZoneSection(
    zone.section,
    section,
    layers,
    sectionEnabled,
  );
  const fenceFaces = useZoneFenceFace(zone.section, fence, layers);
  const faces = fence?.enabled ? fenceFaces : planeFaces;

  // Shares the cap's attributes and carries only the fragments the cap gave up, so
  // the patch costs one small object and adds no overdraw where the cap already
  // draws.
  // ⚠️ Disposed with the zone: three releases the shared attribute buffers with
  // it, which for a surviving sibling degrades to a re-upload — the same trade
  // `buildStackGeometries` already documents for the shared index. Kept PER CAP
  // for that reason, so a streamed cap arriving never releases its siblings'.
  const patchCache = useRef(new Map<SurfaceZoneMesh, BufferGeometry>());
  const [patchState, setPatchState] = useState<{
    surfaces: SurfaceZoneMesh[];
    built: Map<number, BufferGeometry>;
  } | null>(null);
  // An effect, not a memo: a remount (StrictMode, Fast Refresh) runs the cleanup
  // below, and only an effect runs again to rebuild what it released.
  useEffect(() => {
    const cache = patchCache.current;
    const live = new Set(zone.surfaces);
    for (const [surface, geometry] of cache) {
      if (live.has(surface)) continue;
      releaseGeometry(geometry);
      cache.delete(surface);
    }
    const built = new Map<number, BufferGeometry>();
    for (const surface of zone.surfaces) {
      if (!surface.patchIndex || surface.ceiling) continue;
      let geometry = cache.get(surface);
      if (!geometry) {
        geometry = new BufferGeometry();
        for (const name in surface.geometry.attributes) {
          geometry.setAttribute(name, surface.geometry.attributes[name]);
        }
        geometry.setIndex(new BufferAttribute(surface.patchIndex, 1));
        // A patch is a subset of the cap's triangles and carries no `position`, so
        // reuse the cap's bounds — a conservative but valid bound that keeps three
        // from culling the patch when the local origin leaves a close-up view.
        if (surface.geometry.boundingSphere)
          geometry.boundingSphere = surface.geometry.boundingSphere.clone();
        if (surface.geometry.boundingBox)
          geometry.boundingBox = surface.geometry.boundingBox.clone();
        cache.set(surface, geometry);
      }
      built.set(surface.layer, geometry);
    }
    setPatchState({ surfaces: zone.surfaces, built });
  }, [zone.surfaces]);
  const patchGeometries =
    patchState?.surfaces === zone.surfaces ? patchState.built : NO_PATCHES;

  useEffect(() => {
    const cache = patchCache.current;
    return () => {
      cache.forEach(geometry => releaseGeometry(geometry));
      cache.clear();
    };
  }, []);

  // Each cap's normal map, bound per draw: one material can draw caps with
  // different maps (a void's ceiling and the cap of the same layer). Read only on
  // tiles drawn coarser, so bound only while LOD draws.
  const lodDrawing = useRef(false);
  const normalCache = useRef(
    new Map<
      SurfaceZoneMesh,
      { bind: Object3D['onBeforeRender']; texture: DataTexture | null }
    >(),
  );
  const normalBindings = useMemo(() => {
    const built = new Map<SurfaceZoneMesh, Object3D['onBeforeRender']>();
    // A patch is cut from the layer's own cap (never a ceiling's).
    const patches = new Map<number, Object3D['onBeforeRender']>();
    for (const surface of zone.surfaces) {
      let entry = normalCache.current.get(surface);
      if (!entry) {
        const made = surface.normalMap
          ? createCapNormalTexture(surface.normalMap)
          : null;
        const texture = made?.texture ?? null;
        const toUv = made?.toUv ?? null;
        entry = {
          texture,
          bind: (_renderer, _scene, _camera, _geometry, material) =>
            bindZoneNormalMap(
              material,
              lodDrawing.current ? texture : null,
              toUv,
            ),
        };
        normalCache.current.set(surface, entry);
      }
      built.set(surface, entry.bind);
      if (!surface.ceiling) patches.set(surface.layer, entry.bind);
    }
    return { caps: built, patches };
  }, [zone.surfaces]);

  useEffect(() => {
    const cache = normalCache.current;
    const live = new Set(zone.surfaces);
    for (const [surface, entry] of cache) {
      if (live.has(surface)) continue;
      entry.texture?.dispose();
      cache.delete(surface);
    }
  }, [zone.surfaces]);

  useEffect(() => {
    const cache = normalCache.current;
    return () => {
      cache.forEach(entry => entry.texture?.dispose());
      cache.clear();
    };
  }, []);

  const root = useRef<Group>(null);

  // A material not drawn before compiles in the background with the zone hidden, rather
  // than stalling the frame that first draws it. Checked every render: caps stream in.
  const scene = useThree(state => state.scene);
  const camera = useThree(state => state.camera);
  const compiled = useRef(new WeakSet<Material>());
  const compiling = useRef(0);
  useLayoutEffect(() => {
    const group = root.current;
    if (!group) return;
    const fresh = new Set<Material>();
    group.traverse(object => {
      const material = (
        object as Object3D & { material?: Material | Material[] }
      ).material;
      if (!material) return;
      for (const m of Array.isArray(material) ? material : [material]) {
        if (!compiled.current.has(m)) fresh.add(m);
      }
    });
    // A cap drawn by someone else (`drawCap: false`) is compiled too, from a stand-in never
    // added to the scene, so taking it back does not stall.
    const undrawn = new Group();
    for (const surface of zone.surfaces) {
      if (surface.ceiling || layers[surface.layer]?.drawCap !== false) continue;
      const material = materials.surfaces[surface.layer];
      if (!material || compiled.current.has(material)) continue;
      undrawn.add(new Mesh(surface.geometry, material));
      compiled.current.add(material);
    }
    if (undrawn.children.length > 0)
      void precompile(gl, undrawn, camera, scene);
    if (fresh.size === 0) return;
    const generation = ++compiling.current;
    const done = () => {
      if (generation !== compiling.current) return;
      fresh.forEach(m => compiled.current.add(m));
      group.visible = true;
    };
    const pending = precompile(gl, group, camera, scene);
    if (!pending) {
      done();
      return;
    }
    group.visible = false;
    pending.then(done);
  });

  // Peeling drops whole UNITS: a unit's cap and its volume go together. `top` is
  // the first survivor (its own cap stays, closing the block); a window also sets
  // `base`, the floor cap that seals the exposed bottom — the next surface, which
  // already exists, so no carrier is needed.
  const { top, base } = resolvePeel(peel, layers.length);

  const drawn = (layer: number) =>
    (!layersShown || layersShown.has(layer)) && !layersHidden?.has(layer);

  // ⭐ A cap triangle with an opaque, closed unit against BOTH faces cannot be
  // seen. The topology comes from the build; which units are open is decided here,
  // per frame (see `cap-visibility`).
  const cullable =
    cullHiddenCaps &&
    showSurfaces &&
    !!zone.horizons &&
    !capCullingBlocked({
      layers,
      surfaceOpacity,
      wallOpacity,
      wireframe,
      showWalls,
    });
  const cameraUnits = useCameraIntervals(zone, root, cullable, boundary);
  const capTables = useMemo(() => {
    const horizons = zone.horizons;
    if (!cullable || !horizons) return null;
    const open = openIntervals(horizons, {
      layers,
      surfaceOpacity,
      wallOpacity,
      wireframe,
      showWalls,
      top,
      base,
      cameraUnits,
    });
    if (!open) return null;
    const cuts: CapCutRule[] = [];
    if (section || sectionUniform) {
      cuts.push({ carrier: sectionCarrier, seaKept: seabedBySection });
    }
    if (fence) {
      cuts.push({ carrier: fenceCarrier, seaKept: seabedByFence });
    }
    return zone.surfaces.map(surface =>
      surface.above
        ? capOpenTable(open, horizons, surface, layers, cuts)
        : null,
    );
  }, [
    zone,
    cullable,
    layers,
    surfaceOpacity,
    wallOpacity,
    wireframe,
    showWalls,
    top,
    base,
    cameraUnits,
    section,
    sectionUniform,
    sectionCarrier,
    seabedBySection,
    fence,
    fenceCarrier,
    seabedByFence,
  ]);
  // A cap not drawn yet gets no table, so its culled view is built when it is.
  const revealedTables = useMemo(
    () =>
      capTables?.map((table, i) => {
        const layer = zone.surfaces[i].layer;
        return (!layersShown || layersShown.has(layer)) &&
          !layersHidden?.has(layer)
          ? table
          : null;
      }) ?? null,
    [capTables, layersShown, layersHidden, zone.surfaces],
  );
  // While LOD draws, it culls its own caps (see `useZoneLod`).
  const lodActive = zoneLodActive(zone, lodPixelError, lodLevel);
  const capGeometries = useCulledCaps(zone, lodActive ? null : revealedTables);

  // A level of detail per tile: chosen on screen, or one `lodLevel` everywhere.
  const lodViews = useZoneLod(
    zone,
    root,
    lodPixelError,
    lodLevel,
    revealedTables,
    tileUniforms?.values.value,
    cullOffscreen,
  );
  const levelViews = lodViews?.caps ?? null;
  useEffect(() => {
    lodDrawing.current = levelViews !== null;
    if (tileUniforms) tileUniforms.byValue.value = levelViews ? 1 : 0;
  }, [tileUniforms, levelViews]);

  // three builds its wireframe from `position`, which a cap does not carry (the
  // shader assembles it from `xz` and `y`), so in wireframe it would draw nothing.
  // An all-zero one, shared by every cap and made only while wireframe is on.
  const wireframeViews = useMemo(() => {
    if (!wireframe) return null;
    const zeros = new Map<number, BufferAttribute>();
    const views = new Map<SurfaceZoneMesh, BufferGeometry>();
    for (const surface of zone.surfaces) {
      const source = levelViews?.get(surface) ?? surface.geometry;
      const count = source.getAttribute('xz')?.count;
      if (source.hasAttribute('position') || !count) continue;
      let position = zeros.get(count);
      if (!position) {
        position = new BufferAttribute(new Float32Array(count * 3), 3);
        zeros.set(count, position);
      }
      const view = new BufferGeometry();
      for (const name in source.attributes) {
        view.setAttribute(name, source.attributes[name]);
      }
      view.setAttribute('position', position);
      view.setIndex(source.getIndex());
      // Shared, so it follows a level of detail as that is rewritten.
      view.drawRange = source.drawRange;
      view.boundingBox = source.boundingBox?.clone() ?? null;
      view.boundingSphere = source.boundingSphere?.clone() ?? null;
      views.set(surface, view);
    }
    return views;
  }, [wireframe, zone.surfaces, levelViews]);
  useEffect(
    () => () =>
      wireframeViews?.forEach(view => {
        // Only the placeholder is the view's own; the rest belongs to the cap.
        for (const name of Object.keys(view.attributes)) {
          if (name !== 'position') view.deleteAttribute(name);
        }
        view.setIndex(null);
        view.dispose();
      }),
    [wireframeViews],
  );

  // ⭐ A weld or truncation drop is justified only where the layer above is ACTUALLY
  // DRAWN, and both a peel and a section can shrink that region. `'open'` = it is
  // gone everywhere, `'cut'` = gone only in the half the section removed.
  const patchMode = (surface: SurfaceZoneMesh): 'open' | 'cut' | null => {
    const layer = surface.layer;
    const patched = lodViews
      ? lodViews.patches.has(surface)
      : patchGeometries.has(layer);
    if (!patched) return null;
    if (layer === top && top > 0) return 'open';
    // This cap survives the cut but the one above it does not. Where it draws is
    // left to the inverse uniforms, which follow whichever cut is live.
    if (
      (section || fence) &&
      !capCut(layers, layer, false) &&
      capCut(layers, layer - 1, false)
    )
      return 'cut';
    return null;
  };

  return (
    // Names match the React keys, so what an inspector shows lines up with what
    // the code renders.
    <group ref={root} name="ZoneMeshes">
      {faces?.map(face => {
        if (!drawn(face.layer)) return null;
        if (face.layer < top || face.layer >= base) return null;
        const material = face.gap
          ? fenceDebug
            ? materials.faces[face.layer]
            : materials.gapFace
          : (materials.faces[face.layer] ?? materials.walls[face.layer]);
        if (!material) return null;
        const overlay =
          !face.gap && face.geometry.hasAttribute('inferred')
            ? overlays.face(face.layer)
            : null;
        const key = `section-${face.interval}-${face.wall}${face.gap ? '-gap' : ''}`;
        return (
          <group key={key} name={key}>
            {/* ⚠️ Never culled: the buffers are preallocated and only the draw
                range moves, so a bounding volume computed from them is meaningless. */}
            <mesh
              name={`${key}:face`}
              geometry={face.geometry}
              material={material}
              frustumCulled={false}
              userData={{
                layer: face.layer,
                kind: 'section',
                gap: face.gap === true,
              }}
            />
            {overlay && (
              <mesh
                name={`${key}:inferred`}
                geometry={face.geometry}
                material={overlay}
                frustumCulled={false}
                userData={{ layer: face.layer, kind: 'section' }}
              />
            )}
          </group>
        );
      })}

      {showWalls &&
        zone.walls.map((wall, i) => {
          if (!drawn(wall.layer)) return null;
          if (wall.layer < top || wall.layer >= base) return null;
          const material = materials.walls[wall.layer];
          if (!material) return null;
          const overlay = wall.geometry.hasAttribute('inferred')
            ? overlays.wall(wall.layer)
            : null;
          // ⚠️ Always the `material` PROP, never a `<primitive attach>` child:
          // removing the prop makes R3F reset it to a fresh `Mesh`'s default, a
          // white MeshBasicMaterial. R3F does not dispose materials passed as
          // props; the ones built here are disposed by the effect above.
          const key = `wall-${i}`;
          return (
            // oxlint-disable-next-line react/no-array-index-key -- `layer` is NOT unique: a void split gives two meshes the same layer index.
            <group key={key} name={`${key} (layer ${wall.layer})`}>
              <mesh
                name={`${key}:fill`}
                geometry={wall.geometry}
                material={material}
                userData={{ layer: wall.layer, kind: 'wall' }}
              />
              {overlay && (
                <mesh
                  name={`${key}:inferred`}
                  geometry={wall.geometry}
                  material={overlay}
                  userData={{ layer: wall.layer, kind: 'wall' }}
                />
              )}
            </group>
          );
        })}

      {showSurfaces &&
        zone.surfaces.map((surface, i) => {
          if (!drawn(surface.layer)) return null;
          // A cap belongs to the unit BELOW it, so the first survivor's cap stays
          // — that is what keeps the block closed. A void ceiling faces up into the
          // unit above, so it goes with that one instead.
          if (surface.layer < top + (surface.ceiling ? 1 : 0)) return null;
          // Below the window's floor cap, or the ceiling copy AT it (a void's
          // underside must not stand in for the floor). The carrier sits at
          // `layers.length` and is ceiling-tagged for its material, but it IS the
          // natural base, so only guard against a ceiling on a real window base.
          if (
            surface.layer > base ||
            (surface.layer === base && surface.ceiling && base < layers.length)
          )
            return null;
          const declared = layers[surface.layer];
          // Drawn by someone else; a void's ceiling is the unit above's, not this cap.
          if (!surface.ceiling && declared?.drawCap === false) return null;
          // The floor is appended past the caller's layers (it is inferred from a
          // fill on the last one), so it is the one cap with nothing declaring it.
          // ⚠️ EXACTLY one past: a larger index is a cap of a zone that no longer
          // matches these layers, and taking it for the floor gives it a material,
          // which keeps it drawing.
          const isCarrier = !declared && surface.layer === layers.length;
          // The ceiling of a void, and the carrier that closes the block, both
          // face UP, so what they show is the base of the unit ABOVE them rather
          // than a cap of their own — take that interval's fill. A layer with
          // nothing above it is never split, so `layer - 1` exists; the fallback
          // covers an interval left unfilled, and a floor given a material of its
          // own, which is the one case where it reads as its own thing.
          const fromAbove =
            surface.ceiling && !(isCarrier && materials.carrier);
          const material = fromAbove
            ? (materials.ceiling(surface.layer - 1) ??
              materials.walls[surface.layer - 1] ??
              materials.surfaces[surface.layer])
            : isCarrier
              ? materials.carrier
              : materials.surfaces[surface.layer];
          if (!material) return null;
          // `null` = every triangle of this cap is buried this frame.
          const capGeometry =
            wireframeViews?.get(surface) ??
            levelViews?.get(surface) ??
            (capGeometries ? capGeometries[i] : surface.geometry);
          const overlay =
            capGeometry && surface.geometry.hasAttribute('inferred')
              ? overlays.surface(surface.layer)
              : null;
          // The fragments this cap gave up to a layer that is no longer covering
          // them. Same colour and shading as the cap; only the plane differs.
          const mode = patchMode(surface);
          const patch = mode ? materials.patch(surface.layer) : null;
          const patchMaterial = !patch
            ? null
            : mode === 'open'
              ? patch.open
              : patch.cut;
          const patchGeometry = lodViews
            ? lodViews.patches.get(surface)
            : patchGeometries.get(surface.layer);
          const bindNormals = normalBindings.caps.get(surface);
          const key = `surface-${i}`;
          const role = isCarrier
            ? 'carrier'
            : surface.ceiling
              ? 'ceiling'
              : 'cap';
          return (
            // oxlint-disable-next-line react/no-array-index-key -- `layer` is NOT unique: a void split gives two meshes the same layer index.
            <group key={key} name={`${key} (${role} ${surface.layer})`}>
              {/* A pointer hit reports the Object3D it landed on, so the layer
                  index rides along with it — otherwise a handler knows a zone
                  was hit but not which unit. */}
              {capGeometry && (
                <mesh
                  name={`${key}:${role}`}
                  geometry={capGeometry}
                  onBeforeRender={bindNormals}
                  userData={{ layer: surface.layer, kind: 'surface' }}
                >
                  <primitive
                    key={material.uuid}
                    object={material}
                    attach="material"
                  />
                </mesh>
              )}
              {patchMaterial && patchGeometry && (
                <mesh
                  name={`${key}:patch`}
                  geometry={patchGeometry}
                  onBeforeRender={normalBindings.patches.get(surface.layer)}
                  userData={{ layer: surface.layer, kind: 'surface' }}
                >
                  <primitive
                    key={patchMaterial.uuid}
                    object={patchMaterial}
                    attach="material"
                  />
                </mesh>
              )}
              {overlay && capGeometry && (
                <mesh
                  name={`${key}:inferred`}
                  geometry={capGeometry}
                  userData={{ layer: surface.layer, kind: 'surface' }}
                >
                  <primitive
                    key={overlay.uuid}
                    object={overlay}
                    attach="material"
                  />
                </mesh>
              )}
            </group>
          );
        })}
    </group>
  );
};
