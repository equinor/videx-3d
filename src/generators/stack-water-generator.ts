import { transfer } from 'comlink';
import {
  StackWaterResponse,
  StackWaterSpec,
} from '../components/Chunks/chunk-defs';
import {
  buildSurfaceStack,
  densifyChunkRim,
  packBufferGeometry,
  PlanarPolygonGeometry,
  ReadonlyStore,
  STACK_MASK_DATA,
  StackReference,
} from '../sdk';
import { getStackCandidates, getStackContext } from './surface-stack-context';

/**
 * Build a `ChunkStack`'s sea: the lid over the whole outline, and the water body
 * beneath it down to the sea bed.
 *
 * ⭐ It is built as a stack in its own right, of exactly two boundaries — the
 * level and the bed — which is what makes it cheap AND correct. The level is a
 * FLUID, so it is never the authority for what lies under it; being the first
 * layer, there is then nothing left in the stack to order at all, and the bed
 * keeps its own shape. An island rises through the plane instead of being
 * flattened onto it, and the body simply runs out of thickness where it does —
 * which is the shoreline, drawn by the ordinary interval machinery.
 *
 * ⭐⭐ The bed is not resampled here: it is the COLUMN's shallowest surface, taken
 * from the very channels every chunk is built on (`getStackContext`, cache hit),
 * sealed and ordered exactly as they draw it. A second opinion about where the sea
 * bed is would show up as a gap along the whole shoreline.
 *
 * ⚠️ The two still meet on DIFFERENT tessellations — this one is refined for the
 * water, the chunk's for its own stack — so they agree only within `maxError`, the
 * same residual already accepted where two chunks meet.
 *
 * @group Generators
 */
export async function generateStackWater(
  this: ReadonlyStore,
  spec: StackWaterSpec,
): Promise<StackWaterResponse | null> {
  const context = await getStackContext(this, spec.stack, spec.resolve);
  if (!context) return null;

  // The sea bed is the shallowest surface of the column, by definition: a flag
  // saying so could never point anywhere else.
  const bed = context.expansion[0]?.[0];
  if (bed === undefined) return null;

  const outline = new PlanarPolygonGeometry(
    spec.polygon.coordinates,
    spec.polygon.offset,
  );
  const { densified } = densifyChunkRim(outline, spec.rimSpacing ?? 250);
  const maxError = spec.maxError ?? 5;

  const header = context.reference.header;
  const nodes = header.nx * header.ny;
  const reference: StackReference = {
    ...context.reference,
    channels: [
      new Float32Array(nodes).fill(-spec.depth),
      context.reference.channels[bed],
    ],
    masks: [
      new Uint8Array(nodes).fill(STACK_MASK_DATA),
      context.reference.masks[bed],
    ],
  };

  const { candidates: columnCandidates } = await getStackCandidates(
    context,
    maxError,
  );
  const sealing = spec.resolve?.seal !== false;

  const build = buildSurfaceStack(
    reference,
    [{ depth: spec.depth }, context.layers[0]],
    {
      polygon: densified,
      maxError,
      // A level plane needs no refinement of its own; the bed's is already done
      // for the column. The shoreline comes from the thickness crossings
      // `refineTerminations` adds to both.
      candidates: [new Uint32Array(0), columnCandidates[bed]],
      fills: [true, false],
      // The bed is drawn by whichever chunk that horizon is the lid of.
      caps: [true, false],
      fluid: [true, false],
      unbounded: [{ resolution: spec.resolution }, null],
      collapseThreshold: spec.resolve?.collapseThreshold,
      // Sealing gives the bed's unmapped region a shape, so dropping it for want
      // of data would take the water body with it.
      coverageAbsence: sealing ? false : spec.resolve?.coverageAbsence,
      refineTerminations: spec.resolve?.refineTerminations,
      constrainCoverage: spec.resolve?.constrainCoverage,
      section: spec.section,
    },
  );
  if (!build) return null;

  const lid = build.layers[0]?.geometry ?? null;
  const body = build.walls[0] ?? null;
  const transferables: ArrayBufferLike[] = [];
  const pack = (geometry: typeof lid) => {
    if (!geometry) return null;
    const [packed, buffers] = packBufferGeometry(geometry);
    transferables.push(...buffers);
    return packed;
  };

  const packed = { lid: pack(lid), body: pack(body), section: build.section };

  if (build.section) {
    const { positionsXZ, indices, heights, intervals, inferred } =
      build.section;
    transferables.push(positionsXZ.buffer, indices.buffer);
    for (const at of heights) transferables.push(at.buffer);
    for (const at of intervals) if (at) transferables.push(at.buffer);
    for (const at of inferred ?? []) transferables.push(at.buffer);
  }

  // ⚠️ The section shares buffers with the packed geometries above — the shared
  // triangle index at least — and a repeated buffer is a DataCloneError.
  return transfer(packed, [...new Set(transferables)]);
}
