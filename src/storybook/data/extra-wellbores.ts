import { WellboreHeader } from '../../sdk/data/types/WellboreHeader';

/**
 * Extra wellbores for debug sessions, from optional, uncommitted `private/extra-wellbores/*.json`
 * files: `{ wellbores: { [id]: [dE, tvd, dN, md, …] } }` — position-log deltas with no head.
 * {@link withExtraWellbores} gives each a synthetic header whose head centres its plan bounds on
 * the host field's wells. Translation only: fences are judged in metres, so the shape must not change.
 */
type ExtraWellboresFile = { wellbores: Record<string, number[]> };

const files = import.meta.glob<ExtraWellboresFile>(
  '../../../private/extra-wellbores/*.json',
  { eager: true, import: 'default' },
);

/** Every extra wellbore's position log, by id — placed by {@link withExtraWellbores}. */
export const EXTRA_WELLBORE_LOGS: Readonly<Record<string, number[]>> = {};
const EXTRA_LOGS = EXTRA_WELLBORE_LOGS as Record<string, number[]>;
for (const [path, file] of Object.entries(files)) {
  for (const [id, log] of Object.entries(file.wellbores ?? {})) {
    if (EXTRA_LOGS[id]) console.warn(`extra wellbore ${id} in ${path} is a duplicate — skipped`);
    else if (log.length >= 8) EXTRA_LOGS[id] = log;
  }
}

/** Every extra wellbore id, sorted — empty unless the private files exist. */
export const EXTRA_WELLBORE_IDS = Object.keys(EXTRA_LOGS).sort((a, b) =>
  a.localeCompare(b),
);

export const isExtraWellbore = (id: string | null | undefined): boolean =>
  !!id && id in EXTRA_LOGS;

/** A header as stored in `wellbore-headers.json`, where `drilled` is a date string. */
export type WellboreHeaderRecord = Omit<WellboreHeader, 'drilled'> & {
  drilled: string | null;
};

type Placed = { easting: number; northing: number };

/**
 * `headers` and `logs`, keyed by wellbore id as in the data files, with every extra wellbore
 * appended. The host's own records are untouched, and the inputs are returned as they are when
 * there are no extras.
 */
export function withExtraWellbores<H extends Placed>(
  headers: Record<string, H>,
  logs: Record<string, number[]>,
): {
  headers: Record<string, H | WellboreHeaderRecord>;
  logs: Record<string, number[]>;
} {
  if (EXTRA_WELLBORE_IDS.length === 0) return { headers, logs };
  const host = planBounds();
  for (const id of Object.keys(headers)) {
    const log = logs[id];
    if (log && log.length >= 8) {
      host.add(log, headers[id].easting, headers[id].northing);
    }
  }
  const [ce, cn] = host.centre();
  const outHeaders: Record<string, H | WellboreHeaderRecord> = { ...headers };
  const outLogs = { ...logs };
  for (const id of EXTRA_WELLBORE_IDS) {
    const log = EXTRA_LOGS[id];
    const own = planBounds();
    own.add(log, 0, 0);
    const [de, dn] = own.centre();
    outHeaders[id] = {
      id,
      name: id,
      well: id,
      depthReferenceElevation: 0,
      kickoffDepthMsl: null,
      parent: null,
      drilled: '2000-01-01T00:00:00.000Z',
      easting: ce - de,
      northing: cn - dn,
      depthMdMsl: log[log.length - 1],
      waterDepth: null,
      status: 'extra',
    };
    outLogs[id] = log;
  }
  return { headers: outHeaders, logs: outLogs };
}

function planBounds() {
  let e0 = Infinity;
  let e1 = -Infinity;
  let n0 = Infinity;
  let n1 = -Infinity;
  return {
    add(log: ArrayLike<number>, easting: number, northing: number) {
      for (let j = 0; j + 3 < log.length; j += 4) {
        const e = easting + log[j];
        const n = northing + log[j + 2];
        if (e < e0) e0 = e;
        if (e > e1) e1 = e;
        if (n < n0) n0 = n;
        if (n > n1) n1 = n;
      }
    },
    centre: (): [number, number] => [(e0 + e1) / 2, (n0 + n1) / 2],
  };
}
