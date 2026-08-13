import { ReactNode, useEffect, useMemo, useRef } from 'react';
import { Material, MeshStandardMaterial } from 'three';
import {
  createLevelledBase,
  LevelledBaseLevel,
  LevelledBaseMetrics,
  PlanarPolygonGeometry,
} from '../../sdk';
import { useSurfaceSampler } from './surface-sampler';

/**
 * {@link LevelledBase} props.
 * @expand
 * @group Components
 */
export type LevelledBaseProps = {
  /** the base's outline in scene XZ */
  footprint: PlanarPolygonGeometry;
  /**
   * Which of the ground's own heights to level at, or an absolute scene Y.
   * Default `'max'` — pure fill, so nothing is excavated.
   */
  level?: LevelledBaseLevel;
  /** raise the derived level by this much (m) */
  standoff?: number;
  /** how far the skirt cuts into the ground (m). Default 2. */
  embedment?: number;
  /** least the base stands proud of the ground (m). Default 1. */
  minThickness?: number;
  /** rim densification spacing (m); derived from the footprint when unset */
  spacing?: number;
  /** interior edge target of the draped underside (m) */
  resolution?: number;
  /** close the base underneath. Default true. */
  closed?: boolean;
  /** a colour (a material is then owned here) or a caller's own Material */
  material?: string | Material;
  /**
   * Sample this surface alone rather than the highest one drawn — e.g. to stand
   * on a horizon that something else is sitting on top of.
   */
  surface?: string;
  /** what the ground under the footprint turned out to be, once built */
  onBuild?: (metrics: LevelledBaseMetrics & { level: number }) => void;
  /** placed on the CENTRE of the levelled top, which is what it exists for */
  children?: ReactNode;
};

/**
 * A flat, levelled platform for something that cannot stand on sloping ground —
 * a template, a manifold, any structure needing a known base.
 *
 * The footprint is sampled against the surface a `ChunkStack` is DRAWING (see
 * `useSurfaceSampler`), a level is chosen from what the ground does there, and the
 * base is built between the two: a flat top, a skirt cut into the ground, and a
 * draped underside. `onBuild` reports how much fill the site needed and whether
 * the footprint lies fully on mapped ground.
 *
 * Renders nothing until there is a surface to sample, so it appears when the
 * chunk it stands on does.
 *
 * @example
 * <ChunkStack outline={field} surfaces={column}>
 *   <Chunk layers={layers} />
 *   <LevelledBase footprint={pad} standoff={2}>
 *     <SubseaTemplate />
 *   </LevelledBase>
 * </ChunkStack>
 *
 * @group Components
 */
export const LevelledBase = ({
  footprint,
  level = 'max',
  standoff = 0,
  embedment = 2,
  minThickness = 1,
  spacing,
  resolution,
  closed = true,
  material,
  surface,
  onBuild,
  children,
}: LevelledBaseProps) => {
  const sampler = useSurfaceSampler();

  const onBuildRef = useRef(onBuild);
  useEffect(() => {
    onBuildRef.current = onBuild;
  }, [onBuild]);

  const base = useMemo(() => {
    if (!sampler) return null;
    return createLevelledBase(
      footprint,
      (x, z) => sampler.getHeightAt(x, z, surface),
      { level, standoff, embedment, minThickness, spacing, resolution, closed },
    );
  }, [
    sampler,
    footprint,
    surface,
    level,
    standoff,
    embedment,
    minThickness,
    spacing,
    resolution,
    closed,
  ]);

  useEffect(() => {
    if (!base) return;
    onBuildRef.current?.({ ...base.metrics, level: base.level });
    return () => {
      base.top.dispose();
      base.skirt?.dispose();
      base.bottom?.dispose();
    };
  }, [base]);

  // A caller's Material is used as given and never disposed; a colour produces one
  // this component owns.
  const owned = useMemo(
    () =>
      material instanceof Material
        ? null
        : new MeshStandardMaterial({
            color: material ?? '#8b8579',
            roughness: 0.95,
          }),
    [material],
  );
  useEffect(() => {
    if (owned) return () => owned.dispose();
  }, [owned]);

  if (!base) return null;
  const surfaceMaterial = owned ?? (material as Material);
  const bounds = footprint.getBounds();

  return (
    <>
      <mesh geometry={base.top} material={surfaceMaterial} />
      {base.skirt && <mesh geometry={base.skirt} material={surfaceMaterial} />}
      {base.bottom && (
        <mesh geometry={base.bottom} material={surfaceMaterial} />
      )}
      {/* The base geometry is in absolute scene XZ, so children are placed on the
          CENTRE of its top rather than at the scene origin. */}
      <group
        position={[
          bounds.min[0] + bounds.size[0] / 2,
          base.level,
          bounds.min[1] + bounds.size[1] / 2,
        ]}
      >
        {children}
      </group>
    </>
  );
};
