import { SurfaceMeta } from '../../sdk/data/types/SurfaceMeta';
import { distinctByName } from '../hooks/useSurfaceMeta';

/**
 * Stratigraphic ages for the demo dataset's surfaces — **storybook only**.
 *
 * ⚠️ This is NOT a data dependency and must not become one. Mapping a surface name
 * to a stratigraphic unit is the HOST APP's job (see `documents/chunks.md` §9.3):
 * the library takes the caller's array order as the stratigraphic order and knows
 * nothing about strat columns. The stories need *some* correct order to demo with,
 * and this is it.
 *
 * Extracted once from `import/_johs/strat-columns.json`, strat column
 * `ad215071-c4f1-2e4b-e053-c918a4881b5c` ("JOHAN SVERDRUP 2015", the id in
 * `import/_johs/config.json`), by matching each unit's `top`/`base` surface name to
 * its `top_age`/`base_age` in Ma.
 *
 * 32 of the 35 demo surfaces match. The three that do not:
 * - `Intra_Hordaland_Top` — underscore-style name with no unit in the column
 * - `HO_Multicolor_Clay_Top` — ditto (the column has `HO Multicolor Clay JS Top`)
 * - `Intra-Upper Triassic Unconformity` — an unconformity surface, not a unit
 *   top/base, so it has no age of its own
 */
export const STRAT_AGES: Readonly<Record<string, number>> = Object.freeze({
  'NORDLAND GP. Top': 0.001,
  'Utsira Fm. Top': 4.5,
  'Utsira Fm. Base': 12,
  'Skade Fm. Top': 16,
  'Skade Fm. Base': 22,
  'HO Late Oligocene Un. Top': 24,
  'HO Late Oligocene Un. Base': 26,
  'Balder Fm. Top': 52,
  'Sele Fm. Top': 57,
  'Lista Fm. Top': 60,
  'Vaale Fm. Top': 63,
  'SHETLAND GP. Top': 64,
  'Tor Fm. Top': 66,
  'Hod Fm. Top': 75,
  'Blodoeks Fm. Top': 88,
  'Svarte Fm. Top': 90,
  'CROMER KNOLL GP. Top': 95,
  'Sola Fm. Top': 110,
  'Aasgard Fm. Top': 115,
  'VIKING GP. Top': 139,
  'Draupne Fm. 1 JS Top': 155,
  'VIKING GP. Base': 161,
  'Eiriksson Fm. 2 JS Top': 204,
  'Eiriksson Fm. 2.2 JS Top': 205,
  'Eiriksson Fm. 2.1 JS Top': 205.5,
  'Eiriksson Fm. 1 JS Top': 206,
  'HEGRE GP. Top': 208,
  'ZECHSTEIN GP. Top': 245,
  'Turbot Bank Fm. 1 JS Top': 248,
  'Halibut Bank Fm. 2 JS Top': 254.5,
  'Halibut Bank Fm. 2 JS Base': 255.75,
  'Basement Base': 600,
});

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
 *
 * Duplicate names are dropped first (see {@link distinctByName}).
 */
export function sortByStratAge(metas: SurfaceMeta[]): SurfaceMeta[] {
  const distinct = distinctByName(metas);
  const missing = distinct.filter(m => stratAge(m.name) === undefined);
  if (missing.length > 0) {
    console.warn(
      '[strat-ages] no age, EXCLUDED from the stack:',
      missing.map(m => m.name),
    );
  }
  return distinct
    .filter(m => stratAge(m.name) !== undefined)
    .sort((a, b) => stratAge(a.name)! - stratAge(b.name)!);
}
