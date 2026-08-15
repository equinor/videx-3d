import { SurfaceMeta } from '../../sdk/data/types/SurfaceMeta';
import { distinctByName } from '../hooks/useSurfaceMeta';
import storyArgs from '../story-args.json';

/**
 * Stratigraphic ages for the demo dataset's surfaces — **storybook only**.
 *
 * ⚠️ This is NOT a data dependency and must not become one. Mapping a surface name
 * to a stratigraphic unit is the HOST APP's job (see `documents/chunks.md` §9.3):
 * the library takes the caller's array order as the stratigraphic order and knows
 * nothing about strat columns. The stories need *some* correct order to demo with,
 * and this is it.
 *
 * Generated, not written: `scripts/generate-story-args.js` matches each surface
 * name against the `top`/`base` horizons of the strat column named by the dataset
 * config, and records the corresponding `topAge`/`baseAge` in Ma. A surface with no
 * matching horizon — an unconformity, or a name the column does not carry — simply
 * has no entry.
 */
export const STRAT_AGES: Readonly<Record<string, number>> = Object.freeze(
  storyArgs.stratAges as Record<string, number>,
);

/** The unit's age, or `undefined` when the name has no match in the column. */
export function stratAge(name: string | undefined): number | undefined {
  return name ? STRAT_AGES[name] : undefined;
}

/**
 * Put a list of surfaces into stratigraphic order (shallowest/youngest first) —
 * the order `Chunk.groups` expects.
 *
 * Age is the only ordering key that is right by construction; depth is a
 * *consequence* of the geology, not a definition of it. `SurfaceMeta.min`/`.max`
 * describe a surface's whole extent, so sorting by either mis-sorts any surface
 * whose relief outside a chunk's footprint differs from the relief inside it — on
 * the demo field, `meta.max` inverts about half of every adjacent pair.
 *
 * Surfaces with no age are **excluded**, not guessed at: placing them by depth
 * means falling back on exactly the key that misorders the stack (doing so put
 * three shallow surfaces at the bottom and took the crossings from 19k to 183k).
 * ⚠️ That makes an unaged dataset render NOTHING rather than render wrongly, so
 * the exclusion is reported as an error, not a debug note.
 *
 * Ties are real — the base of one unit and the top of the next are the same
 * horizon and carry the same age — so name breaks them, keeping the order stable
 * whatever order the metas arrive in.
 *
 * Duplicate names are dropped first (see {@link distinctByName}).
 */
export function sortByStratAge(metas: SurfaceMeta[]): SurfaceMeta[] {
  const distinct = distinctByName(metas);
  const missing = distinct.filter(m => stratAge(m.name) === undefined);
  if (missing.length > 0) {
    console.error(
      `[strat-ages] ${missing.length} of ${distinct.length} surfaces have no age and are EXCLUDED from the stack — regenerate story-args if the dataset changed:`,
      missing.map(m => m.name),
    );
  }
  return distinct
    .filter(m => stratAge(m.name) !== undefined)
    .sort(
      (a, b) =>
        stratAge(a.name)! - stratAge(b.name)! || a.name.localeCompare(b.name),
    );
}
