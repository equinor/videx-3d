import { createContext } from 'react';
import { PlanarPolygonGeometry } from '../../sdk';
import { CutoutSource } from './cutout';

/**
 * Shared configuration a {@link ChunkStack} publishes to its child chunks. Chunks
 * read this when a prop is left to inherit (e.g. `outline="inherit"`).
 *
 * @group Contexts
 */
export type ChunkStackContextValue = {
  /** default outline polygon (scene XZ) shared by chunks that inherit it */
  outline: PlanarPolygonGeometry | null;
  /**
   * default cut source shared by chunks that inherit it. Takes precedence over
   * `outline` when set (an explicit `polygon` source is equivalent to `outline`).
   */
  cutSource?: CutoutSource;
  /** default rim densification spacing (world units) */
  rimSpacing?: number;
  /** default interior simplification error (grid height units) */
  maxError?: number;
};

/**
 * Context published by {@link ChunkStack}.
 *
 * @group Contexts
 */
export const ChunkStackContext = createContext<ChunkStackContextValue>({
  outline: null,
});
