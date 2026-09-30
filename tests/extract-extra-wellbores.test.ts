import { execSync } from 'child_process';
import { existsSync, readFileSync, writeFileSync } from 'fs';
import { expect, it } from 'vitest';

/**
 * Extracts the wells of a TEMPORARILY loaded data set that fail to build a fence, as anonymous extra
 * wellbores, then checks they fail the same way once the committed data set is back:
 *   EXTRA_PREFIX=Y npx vitest run tests/extract-extra-wellbores.test.ts   (other data set loaded)
 *   EXTRA_VERIFY=Y npx vitest run tests/extract-extra-wellbores.test.ts   (committed data restored)
 * Only anonymous labels are written or printed — no names, ids or head positions.
 */

const MARGINS = [0.1, 0.5, 4, 5];
const DIR = 'private/extra-wellbores';
const HEADERS = 'public/data/wellbore-headers.json';

type ExtractFile = {
  wellbores: Record<string, number[]>;
  /** per id, per margin: the build error, or null when it built */
  expected: Record<string, Record<string, string | null>>;
};

function prefixOf(value: string): string {
  if (!/^[A-Z]{1,3}$/.test(value)) throw new Error(`prefix must be 1–3 capital letters, got "${value}"`);
  return value;
}

function committedDataLoaded(): boolean {
  const committed = execSync(`git show HEAD:${HEADERS}`, { maxBuffer: 1 << 28 }).toString();
  const current = readFileSync(HEADERS, 'utf-8');
  return committed.replace(/\r\n/g, '\n') === current.replace(/\r\n/g, '\n');
}

async function fixtures() {
  const fx = await import('./fence-fixtures');
  const { buildWellboreFence } = await import('../src/sdk');
  /** the build error, null when it built, undefined when there is no curve to build from */
  const verdict = (id: string, margin: number): string | null | undefined => {
    const curve = fx.trajectoryCurve(id);
    if (!curve) return undefined;
    try {
      return buildWellboreFence(curve, { rings: fx.ringsFor(id), margin }) ? null : 'no fence (null)';
    } catch (e) {
      return (e instanceof Error ? e.message : String(e)).slice(0, 160);
    }
  };
  return { ...fx, verdict };
}

it.skipIf(!process.env.EXTRA_PREFIX)('extract extra wellbores', { timeout: 3_600_000 }, async () => {
  const prefix = prefixOf(process.env.EXTRA_PREFIX!);
  const out = `${DIR}/${prefix.toLowerCase()}.json`;
  if (committedDataLoaded()) throw new Error(`${HEADERS} is the committed data set — load the other one first`);
  if (existsSync(out)) throw new Error(`${out} already exists`);

  const { wellboreIds, extraWellboreIds, verdict } = await fixtures();
  if (extraWellboreIds.some(id => id.startsWith(prefix))) {
    throw new Error(`extra wellbores with prefix ${prefix} are already loaded`);
  }
  const logs: Record<string, number[]> = JSON.parse(readFileSync('public/data/position-logs.json', 'utf-8'));

  const t0 = performance.now();
  const failing: { log: number[]; results: Record<string, string | null> }[] = [];
  let swept = 0;
  for (const id of wellboreIds) {
    const results: Record<string, string | null> = {};
    let failed = false;
    for (const margin of MARGINS) {
      const v = verdict(id, margin);
      if (v === undefined) break;
      results[margin] = v;
      if (v !== null) failed = true;
    }
    if (Object.keys(results).length === 0) continue;
    swept++;
    if (failed) failing.push({ log: logs[id], results });
  }
  expect(swept).toBeGreaterThan(0);

  const width = Math.max(2, String(failing.length).length);
  const file: ExtractFile = { wellbores: {}, expected: {} };
  const lines: string[] = [];
  failing.forEach(({ log, results }, k) => {
    const label = `${prefix}${String(k + 1).padStart(width, '0')}`;
    file.wellbores[label] = log;
    file.expected[label] = results;
    lines.push(label, ...MARGINS.map(m => `  m${m}: ${results[m] ?? 'built'}`));
  });
  if (failing.length > 0) writeFileSync(out, JSON.stringify(file));
  console.log(
    [
      `${swept} wells swept at margins ${MARGINS.join(', ')} in ${((performance.now() - t0) / 1000).toFixed(0)} s`,
      `${failing.length} fail at one margin or more${failing.length > 0 ? ` → ${out}` : ''}`,
      ...lines,
    ].join('\n'),
  );
});

it.skipIf(!process.env.EXTRA_VERIFY)('verify extra wellbores', { timeout: 3_600_000 }, async () => {
  const prefix = prefixOf(process.env.EXTRA_VERIFY!);
  const path = `${DIR}/${prefix.toLowerCase()}.json`;
  if (!committedDataLoaded()) throw new Error(`${HEADERS} is not the committed data set — restore it first`);
  const file: ExtractFile = JSON.parse(readFileSync(path, 'utf-8'));
  expect(Object.keys(file.expected ?? {}).length).toBeGreaterThan(0);

  const { wellboreIds, extraWellboreIds, verdict } = await fixtures();
  const lines: string[] = [];
  let same = 0;
  let reworded = 0;
  let changed = 0;
  for (const [label, expected] of Object.entries(file.expected)) {
    if (!extraWellboreIds.includes(label)) {
      lines.push(`${label}: not loaded`);
      changed++;
      continue;
    }
    for (const margin of MARGINS) {
      const was = expected[margin] ?? null;
      const v = verdict(label, margin);
      const now = v === undefined ? 'no curve' : v;
      if (now === was) same++;
      else if ((now === null) === (was === null)) {
        reworded++;
        lines.push(`${label} m${margin}: same outcome, message was "${was}" now "${now}"`);
      } else {
        changed++;
        lines.push(`${label} m${margin}: OUTCOME CHANGED — was ${was ?? 'built'}, now ${now ?? 'built'}`);
      }
    }
  }

  const hostLines: string[] = [];
  for (const margin of MARGINS) {
    let built = 0;
    for (const id of wellboreIds) if (verdict(id, margin) === null) built++;
    hostLines.push(`host m${margin}: built ${built}/${wellboreIds.length}`);
  }
  console.log(
    [
      `${prefix} extras: ${same} identical, ${reworded} same outcome with another message, ${changed} changed`,
      ...lines,
      ...hostLines,
    ].join('\n'),
  );
});
