import { useEffect, useMemo } from 'react';
import { DoubleSide, Material, MeshStandardMaterial } from 'three';
import { makeOitCompatible } from '../../rendering/oit-material';
import { SurfaceChunk } from '../../sdk';
import { ChunkLayer, DEFAULT_PALETTE } from './chunk-defs';
import {
  ChunkInferenceStyle,
  createInferenceMaterial,
} from './inference-material';

/**
 * {@link ChunkMeshes} props.
 * @expand
 * @group Components
 */
export type ChunkMeshesProps = {
  /** a built chunk (from `createSurfaceChunk` or the `surfaceChunk` generator) */
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
};

/**
 * Presentational renderer for a built {@link SurfaceChunk}'s geological meshes
 * (surfaces + walls + basement). This is the reactive **appearance** layer: it
 * resolves each layer's material — a caller-supplied `Material`, a colour, or the
 * built-in palette — and rebuilds them on appearance change (a fresh identity so
 * the OIT pass re-classifies) but never touches geometry.
 *
 * ⚠️ A caller-supplied `Material` is used AS GIVEN and never disposed here, so it
 * must already be OIT-compatible (see `makeOitCompatible`) when the chunk is
 * rendered through an `OITRenderPass`. Materials built from a colour are owned and
 * disposed by this component.
 *
 * Geometry ownership (build + disposal) stays with the parent (`Chunk` /
 * `OceanChunk`); this component only owns the materials it created.
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
}: ChunkMeshesProps) => {
  const materials = useMemo(() => {
    // Materials built here are owned here; a caller's Material is passed through
    // untouched, so the two are tracked separately for disposal.
    const owned: Material[] = [];
    const make = (color: string, opacity: number) => {
      const material = makeOitCompatible(
        new MeshStandardMaterial({
          color,
          side: DoubleSide,
          metalness: 0,
          roughness: 1,
          opacity,
          transparent: opacity < 1,
          depthWrite: opacity >= 1,
          wireframe,
          toneMapped: false,
        }),
      );
      owned.push(material);
      return material;
    };

    const paletteAt = (i: number) =>
      DEFAULT_PALETTE[i % DEFAULT_PALETTE.length];

    const surfaces = layers.map((layer, i) =>
      layer.material instanceof Material
        ? layer.material
        : make(layer.material ?? paletteAt(i), layer.opacity ?? surfaceOpacity),
    );

    // `fill: true` means "the same as my own cap" — the common case for a zone
    // whose wall should read as the unit hanging below its top surface.
    const walls = layers.map((layer, i) => {
      const fill =
        layer.fill === true ? (layer.material ?? paletteAt(i)) : layer.fill;
      if (fill === undefined || fill === null || fill === false) return null;
      return fill instanceof Material
        ? fill
        : make(fill, layer.opacity ?? wallOpacity);
    });

    const basement = chunk.basement
      ? {
          surfaces: chunk.basement.surfaces.map(s => make(s.color, 1)),
          walls: chunk.basement.walls.map(w => make(w.color, 1)),
        }
      : null;

    return { surfaces, walls, basement, owned };
  }, [chunk, layers, surfaceOpacity, wallOpacity, wireframe]);

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
        built.set(opacity, createInferenceMaterial(inferredStyle, { opacity }));
      }
      return built.get(opacity) ?? null;
    };
    return {
      surface: (layer: number) => at(layers[layer]?.opacity ?? surfaceOpacity),
      wall: (layer: number) => at(layers[layer]?.opacity ?? wallOpacity),
      built,
    };
  }, [inferredStyle, layers, surfaceOpacity, wallOpacity, wireframe]);

  useEffect(() => {
    const { built } = overlays;
    return () => built.forEach(m => m?.dispose());
  }, [overlays]);

  return (
    <group>
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
            <group key={`wall-${i}`}>
              <mesh geometry={wall.geometry} material={material} />
              {overlay && <mesh geometry={wall.geometry} material={overlay} />}
            </group>
          );
        })}

      {showSurfaces &&
        chunk.surfaces.map((surface, i) => {
          // The ceiling of a void faces UP, so what it shows is the base of the
          // unit ABOVE it, not the cap of its own layer — take that interval's
          // fill. A layer with nothing above it is never split, so `layer - 1`
          // exists; the fallback only covers an interval left unfilled.
          const material = surface.ceiling
            ? (materials.walls[surface.layer - 1] ??
              materials.surfaces[surface.layer])
            : materials.surfaces[surface.layer];
          if (!material) return null;
          const overlay = surface.geometry.hasAttribute('inferred')
            ? overlays.surface(surface.layer)
            : null;
          return (
            <group key={`surface-${i}`}>
              <mesh geometry={surface.geometry}>
                <primitive
                  key={material.uuid}
                  object={material}
                  attach="material"
                />
              </mesh>
              {overlay && (
                <mesh geometry={surface.geometry}>
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

      {materials.basement && chunk.basement && (
        <group>
          {chunk.basement.walls.map((wall, i) => (
            <mesh key={`basement-wall-${i}`} geometry={wall.geometry}>
              <primitive
                key={materials.basement!.walls[i].uuid}
                object={materials.basement!.walls[i]}
                attach="material"
              />
            </mesh>
          ))}
          {chunk.basement.surfaces.map((surface, i) => (
            <mesh key={`basement-surface-${i}`} geometry={surface.geometry}>
              <primitive
                key={materials.basement!.surfaces[i].uuid}
                object={materials.basement!.surfaces[i]}
                attach="material"
              />
            </mesh>
          ))}
        </group>
      )}
    </group>
  );
};
