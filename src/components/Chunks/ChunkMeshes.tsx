import { useEffect, useMemo } from 'react';
import { DoubleSide, Material, MeshStandardMaterial } from 'three';
import { makeOitCompatible } from '../../rendering/oit-material';
import { SurfaceChunk } from '../../sdk';
import { ChunkLayer } from './chunk-defs';

/** Fallback per-layer palette, cycled by layer order. */
const DEFAULT_PALETTE = [
  '#4e79a7',
  '#f28e2c',
  '#59a14f',
  '#e15759',
  '#af7aa1',
  '#76b7b2',
  '#edc949',
  '#9c755f',
];

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
        : make(layer.material ?? paletteAt(i), surfaceOpacity),
    );

    // `fill: true` means "the same as my own cap" — the common case for a zone
    // whose wall should read as the unit hanging below its top surface.
    const walls = layers.map((layer, i) => {
      const fill =
        layer.fill === true ? (layer.material ?? paletteAt(i)) : layer.fill;
      if (fill === undefined || fill === null || fill === false) return null;
      return fill instanceof Material ? fill : make(fill, wallOpacity);
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

  return (
    <group>
      {showWalls &&
        chunk.walls.map((wall, i) => {
          const material = materials.walls[wall.layer];
          if (!material) return null;
          return (
            <mesh key={`wall-${i}`} geometry={wall.geometry}>
              <primitive
                key={material.uuid}
                object={material}
                attach="material"
              />
            </mesh>
          );
        })}

      {showSurfaces &&
        chunk.surfaces.map((surface, i) => {
          const material = materials.surfaces[surface.layer];
          if (!material) return null;
          return (
            <mesh key={`surface-${i}`} geometry={surface.geometry}>
              <primitive
                key={material.uuid}
                object={material}
                attach="material"
              />
            </mesh>
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
