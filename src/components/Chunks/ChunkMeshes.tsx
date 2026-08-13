import { useEffect, useMemo } from 'react';
import { IUniform, Material, Vector4 } from 'three';
import { SurfaceChunk } from '../../sdk';
import {
  DEFAULT_OCEAN_DEEP_COLOR,
  DEFAULT_OCEAN_WATER_OPACITY,
} from '../Ocean/ocean-material';
import { ChunkDetail } from './chunk-detail';
import { ChunkMaterial, ChunkWaterTintParameters } from './chunk-material';
import {
  ChunkLayer,
  ChunkSectionState,
  DEFAULT_BED_TINT_DEPTH,
  DEFAULT_PALETTE,
  StackWater,
} from './chunk-defs';
import {
  ChunkInferenceStyle,
  createInferenceMaterial,
} from './inference-material';
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
   * Cap material for the column's floor, when this chunk closes the block (see
   * `ChunkStackProps.carrier`). The floor is INFERRED from a fill on the last
   * layer, so it has no `ChunkLayer` of its own to carry one. Omit it and the
   * floor is drawn with the fill of the unit resting on it.
   */
  carrierMaterial?: string | Material;
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
   * Cut the column's floor with the rest of the block (see
   * `ChunkSection.carrier`). Default true; false leaves the block standing on an
   * intact base plate.
   */
  sectionCarrier?: boolean;
};

/**
 * Presentational renderer for a built {@link SurfaceChunk}'s geological meshes
 * (surfaces + walls). This is the reactive **appearance** layer: it
 * resolves each layer's material — a caller-supplied `Material`, a colour, or the
 * built-in palette — and rebuilds them on appearance change (a fresh identity so
 * the OIT pass re-classifies) but never touches geometry.
 *
 * ⚠️ A caller-supplied `Material` is used AS GIVEN and never disposed here, so it
 * must already be OIT-compatible (see `makeOitCompatible`) when the chunk is
 * rendered through an `OITRenderPass`. Materials built from a colour are owned and
 * disposed by this component.
 *
 * Geometry ownership (build + disposal) stays with the parent (`Chunk`); this
 * component only owns the materials it created.
 *
 * @group Components
 */
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
  carrierMaterial,
  section = null,
  sectionUniform,
  sectionCarrier = true,
}: ChunkMeshesProps) => {
  const materials = useMemo(() => {
    // Materials built here are owned here; a caller's Material is passed through
    // untouched, so the two are tracked separately for disposal.
    const owned: Material[] = [];
    const make = (
      color: string,
      opacity: number,
      detail?: ChunkDetail,
      wall = false,
      waterTint?: ChunkWaterTintParameters,
      options?: { section?: boolean },
    ) => {
      const material = new ChunkMaterial({
        color,
        opacity,
        transparent: opacity < 1,
        depthWrite: opacity >= 1,
        wireframe,
        detail,
        wall,
        waterTint,
        sectionPlane: options?.section === false ? undefined : sectionUniform,
      });
      owned.push(material);
      return material;
    };

    const paletteAt = (i: number) =>
      DEFAULT_PALETTE[i % DEFAULT_PALETTE.length];

    // The sea tints the SHALLOWEST cap toward the water colour, as if seen through
    // the water column — the body itself only stands at the rim and the shoreline,
    // and the surface's own alpha is reflection, not absorption.
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
      };
    })();

    const surfaces = layers.map((layer, i) =>
      layer.material instanceof Material
        ? layer.material
        : make(
            layer.material ?? paletteAt(i),
            layer.opacity ?? surfaceOpacity,
            layer.detail,
            false,
            i === 0 ? waterTint : undefined,
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
      return fill instanceof Material
        ? fill
        : make(fill, layer.opacity ?? wallOpacity, layer.detail, true);
    });

    const ceilings = layers.map((layer, i) => {
      if (!ceilingOf.has(i)) return null;
      const fill = fillOf(layer, i);
      if (fill === null) return null;
      return fill instanceof Material
        ? fill
        : make(fill, layer.opacity ?? wallOpacity, layer.detail);
    });

    const carrier = !carrierMaterial
      ? null
      : carrierMaterial instanceof Material
        ? carrierMaterial
        : make(carrierMaterial, surfaceOpacity, undefined, false, undefined, {
            section: sectionCarrier,
          });

    return { surfaces, walls, ceilings, carrier, owned };
  }, [
    chunk.surfaces,
    layers,
    surfaceOpacity,
    wallOpacity,
    wireframe,
    water,
    carrierMaterial,
    sectionUniform,
    sectionCarrier,
  ]);

  useEffect(() => {
    return () => materials.owned.forEach(m => m.dispose());
  }, [materials]);

  // The marking is drawn OVER the unit's own material rather than being part of
  // it, so it works over a caller-supplied (possibly textured) Material as well as
  // over ours. One per distinct opacity, since a translucent unit should not be
  // marked opaquely. ⚠️ Suppressed in wireframe, where an overlay is only noise.
  const overlays = useMemo(() => {
    const built = new Map<number, Material | null>();
    const at = (opacity: number) => {
      if (wireframe) return null;
      if (!built.has(opacity)) {
        built.set(
          opacity,
          createInferenceMaterial(inferredStyle, {
            opacity,
            sectionPlane: sectionUniform,
          }),
        );
      }
      return built.get(opacity) ?? null;
    };
    return {
      surface: (layer: number) => at(layers[layer]?.opacity ?? surfaceOpacity),
      wall: (layer: number) => at(layers[layer]?.opacity ?? wallOpacity),
      built,
    };
  }, [
    inferredStyle,
    layers,
    surfaceOpacity,
    wallOpacity,
    wireframe,
    sectionUniform,
  ]);

  useEffect(() => {
    const { built } = overlays;
    return () => built.forEach(m => m?.dispose());
  }, [overlays]);

  // The cut face of each filled interval, rebuilt every frame from the chunk's own
  // channels. It is drawn with the interval's own fill material, so per-layer
  // opacity, detail and a caller's own `Material` all carry onto the section.
  const faces = useChunkSection(chunk.section, section);

  return (
    <group>
      {faces?.map(face => {
        const material = materials.walls[face.layer];
        if (!material) return null;
        const overlay = face.geometry.hasAttribute('inferred')
          ? overlays.wall(face.layer)
          : null;
        return (
          <group key={`section-${face.interval}`}>
            {/* ⚠️ Never culled: the buffers are preallocated and only the draw
                range moves, so a bounding volume computed from them is meaningless. */}
            <mesh
              geometry={face.geometry}
              material={material}
              frustumCulled={false}
              userData={{ layer: face.layer, kind: 'section' }}
            />
            {overlay && (
              <mesh
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
          const material = materials.walls[wall.layer];
          if (!material) return null;
          const overlay = wall.geometry.hasAttribute('inferred')
            ? overlays.wall(wall.layer)
            : null;
          // ⚠️ Always the `material` PROP, never a `<primitive attach>` child:
          // removing the prop makes R3F reset it to a fresh `Mesh`'s default, a
          // white MeshBasicMaterial. R3F does not dispose materials passed as
          // props; the ones built here are disposed by the effect above.
          return (
            // oxlint-disable-next-line react/no-array-index-key -- `layer` is NOT unique: a void split gives two meshes the same layer index.
            <group key={`wall-${i}`}>
              <mesh
                geometry={wall.geometry}
                material={material}
                userData={{ layer: wall.layer, kind: 'wall' }}
              />
              {overlay && (
                <mesh
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
          const declared = layers[surface.layer];
          // The floor is appended past the caller's layers (it is inferred from a
          // fill on the last one), so it is the one cap with nothing declaring it.
          const isCarrier = !declared;
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
          return (
            // oxlint-disable-next-line react/no-array-index-key -- `layer` is NOT unique: a void split gives two meshes the same layer index.
            <group key={`surface-${i}`}>
              {/* A pointer hit reports the Object3D it landed on, so the layer
                  index rides along with it — otherwise a handler knows a chunk
                  was hit but not which unit. */}
              <mesh
                geometry={surface.geometry}
                userData={{ layer: surface.layer, kind: 'surface' }}
              >
                <primitive
                  key={material.uuid}
                  object={material}
                  attach="material"
                />
              </mesh>
              {overlay && (
                <mesh
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
