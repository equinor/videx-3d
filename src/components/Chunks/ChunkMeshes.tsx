import { useEffect, useMemo, useState } from 'react';
import { useFrame } from '@react-three/fiber';
import {
  BufferAttribute,
  BufferGeometry,
  DoubleSide,
  IUniform,
  Material,
  MeshBasicMaterial,
  Vector4,
} from 'three';
import { SurfaceChunk } from '../../sdk';
import {
  DEFAULT_OCEAN_DEEP_COLOR,
  DEFAULT_OCEAN_WATER_OPACITY,
} from '../Ocean/ocean-material';
import { ChunkContactTexture, resolveLayerContacts } from './chunk-contacts';
import { releaseGeometry } from './chunk-resources';
import { ChunkDepthMap } from './chunk-depth-map';
import { ChunkDetail } from './chunk-detail';
import {
  ChunkMaterial,
  ChunkFenceUniforms,
  ChunkWaterTintParameters,
} from './chunk-material';
import {
  ChunkFenceState,
  ChunkLayer,
  ChunkPeel,
  ChunkSectionState,
  DEFAULT_BED_TINT_DEPTH,
  DEFAULT_PALETTE,
  resolvePeel,
  StackWater,
} from './chunk-defs';
import {
  ChunkInferenceStyle,
  createInferenceMaterial,
} from './inference-material';
import { useChunkFenceFace } from './useChunkFenceFace';
import { useChunkSection } from './useChunkSection';

/**
 * {@link ChunkMeshes} props.
 * @expand
 * @group Components
 */
export type ChunkMeshesProps = {
  /** a built chunk (from the `surfaceChunk` generator) */
  chunk: SurfaceChunk;
  /**
   * The layers the chunk was built from, in the same order — the source of each
   * mesh's material. Every chunk mesh carries its layer index, so a dropped layer
   * or an unfilled interval cannot shift the mapping.
   */
  layers: ChunkLayer[];
  /** surface (top) opacity. Reactive. Default 1. */
  surfaceOpacity?: number;
  /** wall opacity. Reactive. Default 1. */
  wallOpacity?: number;
  /** wireframe. Reactive. Default false. */
  wireframe?: boolean;
  /**
   * How the INVENTED part of the chunk is marked — the geometry a seal built where
   * no surface was mapped. Drawn as a pattern OVER the unit's own material, so it
   * works whatever that material is. Default `'hatched'`. See
   * {@link ChunkInferenceStyle}.
   */
  inferredStyle?: ChunkInferenceStyle;
  /** render the surface tops. Default true. */
  showSurfaces?: boolean;
  /** render the side walls. Default true. */
  showWalls?: boolean;
  /**
   * The sea the enclosing `ChunkStack` declares, if any. Only its TINT is used
   * here: the sea's own geometry belongs to the stack.
   */
  water?: StackWater | null;
  /**
   * The sea bed's depth grid, from the stack. Drives the bed tint by the water
   * standing over each fragment's MAP location instead of by its own depth — which
   * is what lets the sea-bed unit's rim WALL be tinted at all.
   */
  bathymetry?: ChunkDepthMap | null;
  /**
   * Cap colour for the column's floor, when this chunk closes the block (see
   * `ChunkStackProps.carrier`). The floor is INFERRED from a fill on the last
   * layer, so it has no `ChunkLayer` of its own to carry one. Omit it and the
   * floor is drawn with the fill of the unit resting on it.
   */
  carrierMaterial?: string;
  /** contacts drawn as lines on every layer that does not opt out */
  contacts?: ChunkContactTexture[] | null;
  /**
   * The stack's live clip plane, if any (see `ChunkStackProps.section`). Drives
   * both the shader's cut and the cut FACE built from the chunk's own channels.
   */
  section?: ChunkSectionState | null;
  /**
   * The same plane as a shared uniform, handed to every material built here so a
   * moving plane never rebuilds one. ⚠️ A caller-supplied `Material` cannot be
   * given it, so such a layer is not cut.
   */
  sectionUniform?: IUniform<Vector4>;
  /**
   * The negated plane (see `ChunkStackContextValue.sectionUniformInverse`), which
   * is what lets a cap's dropped fragments be restored only in the half the layer
   * that covered them was cut away from.
   */
  sectionUniformInverse?: IUniform<Vector4>;
  /**
   * Cut the column's floor with the rest of the block (see
   * `ChunkSection.carrier`). Default false, which leaves the block standing on an
   * intact base plate.
   */
  sectionCarrier?: boolean;
  /** whether the section is drawing (see `ChunkStackContextValue.sectionEnabled`) */
  sectionEnabled?: boolean;
  /** the stack's live fence, or `null` for none */
  fence?: ChunkFenceState | null;
  /** the fence's shared uniforms (see `ChunkStackContextValue.fenceUniforms`) */
  fenceUniforms?: ChunkFenceUniforms;
  /** their complement, for the peel patch */
  fenceUniformsInverse?: ChunkFenceUniforms;
  /** whether the column's floor is cut by the fence */
  fenceCarrier?: boolean;
  /**
   * Peel units of the chunk away to expose what is under them — see
   * {@link ChunkPeel}. A number peels a prefix off the top; `{ from, count }`
   * opens a window and caps its exposed base with the next surface.
   *
   * ⭐ Exact and free, unlike lowering the opacity: alpha compounds, so a deep
   * stack at 0.5 is effectively opaque and a transparency slider cannot answer
   * "what is underneath". Not drawing part of the depth-ordered layers is exact.
   */
  peel?: ChunkPeel;
};

/**
 * Presentational renderer for a built {@link SurfaceChunk}'s geological meshes
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
 * Geometry ownership (build + disposal) stays with the parent (`Chunk`); this
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
 * the component body they therefore pinned that render's `chunk`, i.e. a whole
 * stack of geometry, until the appearance happened to change. Passing the inputs
 * as arguments keeps the captured scope to exactly these parameters.
 */
function buildInferenceOverlays(
  inferredStyle: ChunkInferenceStyle,
  layers: ChunkLayer[],
  surfaceOpacity: number,
  wallOpacity: number,
  wireframe: boolean,
  sectionUniform?: IUniform<Vector4>,
  fenceUniforms?: ChunkFenceUniforms,
) {
  const built = new Map<string, Material | null>();
  const at = (opacity: number, cut: boolean) => {
    if (wireframe) return null;
    const key = `${opacity}/${cut}`;
    if (!built.has(key)) {
      built.set(
        key,
        createInferenceMaterial(inferredStyle, {
          opacity,
          sectionPlane: cut ? sectionUniform : undefined,
          fence: cut ? fenceUniforms : undefined,
        }),
      );
    }
    return built.get(key) ?? null;
  };
  const keptUnit = (i: number) => layers[i]?.section === false;
  return {
    surface: (layer: number) =>
      at(
        layers[layer]?.opacity ?? surfaceOpacity,
        !keptUnit(layer) && !keptUnit(layer - 1),
      ),
    wall: (layer: number) =>
      at(layers[layer]?.opacity ?? wallOpacity, !keptUnit(layer)),
    // Never cut, for the reason the face's own material is not: it lies on the
    // cut, so testing it against it would hatch nothing at all.
    face: (layer: number) => at(layers[layer]?.opacity ?? wallOpacity, false),
    built,
  };
}

export const ChunkMeshes = ({
  chunk,
  layers,
  surfaceOpacity = 1,
  wallOpacity = 1,
  wireframe = false,
  inferredStyle = 'hatched',
  showSurfaces = true,
  showWalls = true,
  water = null,
  bathymetry = null,
  carrierMaterial,
  contacts = null,
  section = null,
  sectionUniform,
  sectionUniformInverse,
  sectionCarrier = false,
  sectionEnabled = true,
  fence = null,
  fenceUniforms,
  fenceUniformsInverse,
  fenceCarrier = false,
  peel = 0,
}: ChunkMeshesProps) => {
  // ⚠️ `fence` is a STABLE object mutated from the frame loop, so a change to
  // `fence.debug` is invisible to React and the materials below would keep the
  // ones they were first built with. Mirroring it into state is what makes the
  // toggle work without a remount.
  const [fenceDebug, setFenceDebug] = useState(fence?.debug === true);
  useFrame(() => {
    const wanted = fence?.debug === true;
    if (wanted !== fenceDebug) setFenceDebug(wanted);
  });

  const materials = useMemo(() => {
    // Every material built here is owned here and disposed on cleanup.
    const owned: Material[] = [];
    const make = (
      color: string,
      opacity: number,
      detail?: ChunkDetail,
      wall = false,
      waterTint?: ChunkWaterTintParameters,
      options?: {
        section?: boolean;
        fence?: boolean;
        inverse?: boolean;
        contacts?: ChunkContactTexture[];
      },
    ) => {
      // A unit kept whole opts out of both cuts; the floor opts out of each
      // separately, since only one of the two is ever live.
      const cutSection = options?.section !== false;
      const cutFence = options?.fence !== false;
      const material = new ChunkMaterial({
        color,
        opacity,
        transparent: opacity < 1,
        depthWrite: opacity >= 1,
        wireframe,
        detail,
        wall,
        waterTint,
        contacts: options?.contacts,
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
    // the cap between them, once.
    const keptUnit = (i: number) => layers[i]?.section === false;
    const cutWall = (i: number) => !keptUnit(i);
    const cutCap = (i: number) => !keptUnit(i) && !keptUnit(i - 1);

    // The sea tints the SHALLOWEST cap toward the water colour, as if seen through
    // the water column standing over it — the body itself only stands at the rim and
    // the shoreline, and the surface's own alpha is reflection, not absorption.
    const waterTint = ((): ChunkWaterTintParameters | undefined => {
      if (!water) return undefined;
      const strength =
        water.bedTint ?? water.waterOpacity ?? DEFAULT_OCEAN_WATER_OPACITY;
      if (strength <= 0) return undefined;
      return {
        color: water.deepColor ?? DEFAULT_OCEAN_DEEP_COLOR,
        level: -(water.depth ?? 0),
        strength,
        depth: water.bedTintDepth ?? DEFAULT_BED_TINT_DEPTH,
        map: bathymetry ?? undefined,
        wetBand: water.wetBand,
        wetStrength: water.wetStrength,
      };
    })();

    const surfaces = layers.map((layer, i) =>
      make(
        layer.material ?? paletteAt(i),
        layer.opacity ?? surfaceOpacity,
        layer.detail,
        false,
        i === 0 ? waterTint : undefined,
        {
          section: cutCap(i),
          fence: cutCap(i),
          contacts: layerContacts(i),
        },
      ),
    );

    // A void's upper copy is drawn with the material of the interval ABOVE it, but
    // it is a CAP: it has no `wallV` attribute, so it needs its own instance rather
    // than the wall's (which anchors bedding to that axis). Only built where the
    // chunk actually has such a copy.
    const ceilingOf = new Set<number>();
    for (const surface of chunk.surfaces) {
      if (surface.ceiling) ceilingOf.add(surface.layer - 1);
    }

    // `fill: true` means "the same as my own cap" — the common case for a zone
    // whose wall should read as the unit hanging below its top surface.
    const fillOf = (layer: ChunkLayer, i: number) => {
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

    const ceilings = layers.map((layer, i) => {
      if (!ceilingOf.has(i)) return null;
      const fill = fillOf(layer, i);
      if (fill === null) return null;
      // A ceiling is the BASE of the interval above it, so it follows that unit
      // rather than its own layer index.
      return make(
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
              { section: false, fence: false, contacts: layerContacts(i) },
            );
          });

    const carrier = !carrierMaterial
      ? null
      : make(carrierMaterial, surfaceOpacity, undefined, false, undefined, {
          // The floor is the base of the deepest unit, so keeping that unit keeps
          // it — AND'd with the explicit toggle rather than overriding it, so a
          // caller can still keep the base plate whole on its own.
          section: sectionCarrier && !keptUnit(layers.length - 1),
          fence: fenceCarrier && !keptUnit(layers.length - 1),
        });

    // ⭐ The fragments a cap gave up because a layer ABOVE covered them, restored
    // where that cover has gone. Two ways it can go, so two materials: peeled away
    // entirely (draw everywhere) or cut away by the section (draw only in the half
    // it vacated, which is what the negated plane gives).
    const patches = new Map<number, { open: Material; cut: Material | null }>();
    for (const surface of chunk.surfaces) {
      if (!surface.patchIndex || surface.ceiling) continue;
      const declared = layers[surface.layer];
      if (!declared) continue;
      patches.set(surface.layer, {
        open: make(
          declared.material ?? paletteAt(surface.layer),
          declared.opacity ?? surfaceOpacity,
          declared.detail,
          false,
          surface.layer === 0 ? waterTint : undefined,
          {
            section: false,
            fence: false,
            contacts: layerContacts(surface.layer),
          },
        ),
        cut: sectionUniformInverse
          ? make(
              declared.material ?? paletteAt(surface.layer),
              declared.opacity ?? surfaceOpacity,
              declared.detail,
              false,
              surface.layer === 0 ? waterTint : undefined,
              {
                inverse: true,
                contacts: layerContacts(surface.layer),
              },
            )
          : null,
      });
    }

    return { surfaces, walls, ceilings, carrier, patches, owned, faces };
  }, [
    chunk.surfaces,
    layers,
    surfaceOpacity,
    wallOpacity,
    wireframe,
    water,
    bathymetry,
    carrierMaterial,
    contacts,
    sectionUniform,
    sectionUniformInverse,
    sectionCarrier,
    fence,
    fenceDebug,
    fenceUniforms,
    fenceUniformsInverse,
    fenceCarrier,
  ]);

  useEffect(() => {
    return () => materials.owned.forEach(m => m.dispose());
  }, [materials]);

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
        sectionUniform,
        fenceUniforms,
      ),
    [
      inferredStyle,
      layers,
      surfaceOpacity,
      wallOpacity,
      wireframe,
      sectionUniform,
      fenceUniforms,
    ],
  );

  useEffect(() => {
    const { built } = overlays;
    return () => built.forEach(m => m?.dispose());
  }, [overlays]);

  // The cut face of each filled interval, rebuilt every frame from the chunk's own
  // channels. It is drawn with the interval's own fill material, so per-layer
  // opacity, detail and a caller's own `Material` all carry onto the section.
  const planeFaces = useChunkSection(
    chunk.section,
    section,
    layers,
    sectionEnabled,
  );
  const fenceFaces = useChunkFenceFace(chunk.section, fence, layers);
  const faces = fence?.enabled ? fenceFaces : planeFaces;

  // Shares the cap's attributes and carries only the fragments the cap gave up, so
  // the patch costs one small object and adds no overdraw where the cap already
  // draws.
  // ⚠️ Disposed with the chunk: three releases the shared attribute buffers with
  // it, which for a surviving sibling degrades to a re-upload — the same trade
  // `buildStackGeometries` already documents for the shared index.
  const patchGeometries = useMemo(() => {
    const built = new Map<number, BufferGeometry>();
    for (const surface of chunk.surfaces) {
      if (!surface.patchIndex || surface.ceiling) continue;
      const geometry = new BufferGeometry();
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
      built.set(surface.layer, geometry);
    }
    return built;
  }, [chunk.surfaces]);

  useEffect(() => {
    return () => patchGeometries.forEach(g => releaseGeometry(g));
  }, [patchGeometries]);

  // Peeling drops whole UNITS: a unit's cap and its volume go together. `top` is
  // the first survivor (its own cap stays, closing the block); a window also sets
  // `base`, the floor cap that seals the exposed bottom — the next surface, which
  // already exists, so no carrier is needed.
  const { top, base } = resolvePeel(peel, layers.length);

  // ⭐ A weld or truncation drop is justified only where the layer above is ACTUALLY
  // DRAWN, and both a peel and a section can shrink that region. `'open'` = it is
  // gone everywhere, `'cut'` = gone only in the half the section removed.
  const patchMode = (layer: number): 'open' | 'cut' | null => {
    if (!patchGeometries.has(layer)) return null;
    if (layer === top && top > 0) return 'open';
    const kept = (i: number) => layers[i]?.section === false;
    const capCut = (i: number) => !kept(i) && !kept(i - 1);
    // This cap survives the section but the one above it does not.
    if (section?.enabled !== false && !capCut(layer) && capCut(layer - 1))
      return 'cut';
    return null;
  };

  return (
    // Names match the React keys, so what an inspector shows lines up with what
    // the code renders.
    <group name="ChunkMeshes">
      {faces?.map(face => {
        if (face.layer < top || face.layer >= base) return null;
        const material =
          materials.faces[face.layer] ?? materials.walls[face.layer];
        if (!material) return null;
        const overlay = face.geometry.hasAttribute('inferred')
          ? overlays.face(face.layer)
          : null;
        const key = `section-${face.interval}-${face.wall}`;
        return (
          <group key={key} name={key}>
            {/* ⚠️ Never culled: the buffers are preallocated and only the draw
                range moves, so a bounding volume computed from them is meaningless. */}
            <mesh
              name={`${key}:face`}
              geometry={face.geometry}
              material={material}
              frustumCulled={false}
              userData={{ layer: face.layer, kind: 'section' }}
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
        chunk.walls.map((wall, i) => {
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
        chunk.surfaces.map((surface, i) => {
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
          // The floor is appended past the caller's layers (it is inferred from a
          // fill on the last one), so it is the one cap with nothing declaring it.
          // ⚠️ EXACTLY one past: a larger index is a cap of a chunk that no longer
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
            ? (materials.ceilings[surface.layer - 1] ??
              materials.walls[surface.layer - 1] ??
              materials.surfaces[surface.layer])
            : isCarrier
              ? materials.carrier
              : materials.surfaces[surface.layer];
          if (!material) return null;
          const overlay = surface.geometry.hasAttribute('inferred')
            ? overlays.surface(surface.layer)
            : null;
          // The fragments this cap gave up to a layer that is no longer covering
          // them. Same colour and shading as the cap; only the plane differs.
          const mode = patchMode(surface.layer);
          const patch = mode ? materials.patches.get(surface.layer) : null;
          const patchMaterial = !patch
            ? null
            : mode === 'open'
              ? patch.open
              : patch.cut;
          const patchGeometry = patchGeometries.get(surface.layer);
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
                  index rides along with it — otherwise a handler knows a chunk
                  was hit but not which unit. */}
              <mesh
                name={`${key}:${role}`}
                geometry={surface.geometry}
                userData={{ layer: surface.layer, kind: 'surface' }}
              >
                <primitive
                  key={material.uuid}
                  object={material}
                  attach="material"
                />
              </mesh>
              {patchMaterial && patchGeometry && (
                <mesh
                  name={`${key}:patch`}
                  geometry={patchGeometry}
                  userData={{ layer: surface.layer, kind: 'surface' }}
                >
                  <primitive
                    key={patchMaterial.uuid}
                    object={patchMaterial}
                    attach="material"
                  />
                </mesh>
              )}
              {overlay && (
                <mesh
                  name={`${key}:inferred`}
                  geometry={surface.geometry}
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
