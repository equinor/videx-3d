import { useEffect, useMemo } from 'react';
import { DoubleSide, Material, MeshStandardMaterial } from 'three';
import { makeOitCompatible } from '../../rendering/oit-material';
import { SurfaceChunk } from '../../sdk';

/**
 * {@link ChunkMeshes} props.
 * @expand
 * @group Components
 */
export type ChunkMeshesProps = {
  /** a built chunk (from `createSurfaceChunk`) */
  chunk: SurfaceChunk;
  /** surface (top) opacity. Reactive. Default 1. */
  surfaceOpacity?: number;
  /** wall opacity. Reactive. Default 1. */
  wallOpacity?: number;
  /** wireframe. Reactive. Default false. */
  wireframe?: boolean;
  /**
   * Material for the chunk's UPPERMOST surface (the first surface of the first
   * group) — e.g. a `SurfaceMaterial`. Everything else keeps the standard material
   * built from the layer colours.
   *
   * ⚠️ Owned by the caller: it is never disposed here, and it is used as given, so
   * it must already be OIT-compatible (see `makeOitCompatible`) when the chunk is
   * rendered through an `OITRenderPass`.
   */
  topMaterial?: Material;
  /** render the surface tops. Default true. */
  showSurfaces?: boolean;
  /** render the side walls. Default true. */
  showWalls?: boolean;
};

/**
 * Presentational renderer for a built {@link SurfaceChunk}'s geological meshes
 * (grouped surfaces + walls + basement). This is the reactive **appearance** layer:
 * it builds OIT-compatible materials from the chunk's baked colours and the given
 * opacity/wireframe, rebuilding them on appearance change (a fresh identity so the
 * OIT pass re-classifies) but never touching geometry.
 *
 * Geometry ownership (build + disposal) stays with the parent (`Chunk` /
 * `OceanChunk`); this component only owns its materials. The ocean-top water is
 * rendered separately (by `OceanChunk`, via the `Ocean` shader).
 *
 * @group Components
 */
export const ChunkMeshes = ({
  chunk,
  surfaceOpacity = 1,
  wallOpacity = 1,
  wireframe = false,
  topMaterial,
  showSurfaces = true,
  showWalls = true,
}: ChunkMeshesProps) => {
  const materials = useMemo(() => {
    const make = (color: string, opacity: number) =>
      makeOitCompatible(
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
    return {
      groups: chunk.groups.map(group => ({
        surfaces: group.surfaces.map(s => make(s.color, surfaceOpacity)),
        walls: group.walls.map(w => make(w.color, wallOpacity)),
      })),
      basement: chunk.basement
        ? {
          surfaces: chunk.basement.surfaces.map(s => make(s.color, 1)),
          walls: chunk.basement.walls.map(w => make(w.color, 1)),
        }
        : null,
    };
  }, [chunk, surfaceOpacity, wallOpacity, wireframe]);

  useEffect(() => {
    return () => {
      materials.groups.forEach(g => {
        g.surfaces.forEach(m => m.dispose());
        g.walls.forEach(m => m.dispose());
      });
      materials.basement?.surfaces.forEach(m => m.dispose());
      materials.basement?.walls.forEach(m => m.dispose());
    };
  }, [materials]);

  return (
    <group>
      {showWalls &&
        chunk.groups.map((group, gi) =>
          group.walls.map((wall, i) => (
            <mesh key={`wall-${gi}-${i}`} geometry={wall.geometry}>
              <primitive
                key={materials.groups[gi].walls[i].uuid}
                object={materials.groups[gi].walls[i]}
                attach="material"
              />
            </mesh>
          )),
        )}

      {showSurfaces &&
        chunk.groups.map((group, gi) =>
          group.surfaces.map((surface, i) => {
            // The chunk's uppermost surface may be handed a caller-owned material.
            const material =
              topMaterial && gi === 0 && i === 0
                ? topMaterial
                : materials.groups[gi].surfaces[i];
            return (
              <mesh key={`surface-${gi}-${i}`} geometry={surface.geometry}>
                <primitive
                  key={material.uuid}
                  object={material}
                  attach="material"
                />
              </mesh>
            );
          }),
        )}

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
            <mesh key={`basement-cap-${i}`} geometry={surface.geometry}>
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
