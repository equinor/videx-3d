import { PropsWithChildren, useMemo } from 'react';
import { PlanarPolygonGeometry } from '../../sdk';
import { ChunkStackContext, ChunkStackContextValue } from './ChunkContext';
import { CutoutSource } from './cutout';

/**
 * {@link ChunkStack} props.
 * @expand
 * @group Components
 */
export type ChunkStackProps = {
  /**
   * Default outline polygon (scene XZ) shared by child chunks that inherit it
   * (the common case). Individual chunks may override with their own outline.
   */
  outline?: PlanarPolygonGeometry | null;
  /**
   * Default cut source shared by child chunks that inherit it. Use this for a
   * wellbore-derived outline (`{ kind: 'wellbores', wellbores, options }`); takes
   * precedence over `outline` when both are set.
   */
  cutSource?: CutoutSource;
  /** default rim densification spacing (world units) for child chunks */
  rimSpacing?: number;
  /** default interior simplification error (grid height units) for child chunks */
  maxError?: number;
};

/**
 * Groups a set of {@link Chunk} components and publishes shared build inputs (the
 * outline and tessellation defaults) via context, so chunks can `inherit` them.
 *
 * This is the parent/provider of the chunk component family — analogous to how
 * `Wells` groups `Wellbore`s. Place it inside a `UtmArea` (chunks resolve their
 * world placement from the UTM context).
 *
 * @example
 * <UtmArea origin={origin} utmZone={utmZone}>
 *   <ChunkStack outline={polygon}>
 *     <Chunk groups={groups} />
 *     <Chunk groups={deeperGroups} basement={{ thickness: 800 }} />
 *   </ChunkStack>
 * </UtmArea>
 *
 * @group Components
 */
export const ChunkStack = ({
  outline = null,
  cutSource,
  rimSpacing,
  maxError,
  children,
}: PropsWithChildren<ChunkStackProps>) => {
  const value = useMemo<ChunkStackContextValue>(
    () => ({ outline, cutSource, rimSpacing, maxError }),
    [outline, cutSource, rimSpacing, maxError],
  );
  return (
    <ChunkStackContext.Provider value={value}>
      {children}
    </ChunkStackContext.Provider>
  );
};
