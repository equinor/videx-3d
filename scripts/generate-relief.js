/**
 * Generates the demo reliefs on demand into public/relief/, which git ignores: a raw
 * little-endian float32 grid per relief (`<id>.bin`, metres above mean sea level, NaN
 * for none, row-major from the northern row) and a `ReliefMeta` per relief in
 * `relief-meta.json`.
 *
 *   npm run generate-relief                    every relief not there yet
 *   npm run generate-relief -- <id> [<id>…]    only those
 *   npm run generate-relief -- --force         again, even those already there
 *
 * Sources (see documents/tiles.md, "Online sources"):
 *
 * - ETOPO 2022 Global Relief Model (ice surface), NOAA National Centers for
 *   Environmental Information, DOI 10.25921/fd45-gt74; public domain. From NOAA's
 *   OPeNDAP server.
 * - EMODnet Digital Bathymetry (DTM 2020), EMODnet Bathymetry Consortium,
 *   DOI 10.12770/bb6a87dd-e579-4036-abe1-e649cea9881a; free to use and redistribute
 *   with credit. Sea only; heights above lowest astronomical tide. From EMODnet's ERDDAP.
 *
 * Every source ends in `gridToRelief`, loaded as TypeScript by Node's own type stripping
 * (Node 22.18 or later).
 */

import fs from 'node:fs';
import { gridToRelief } from '../src/sdk/data/relief/grid-to-relief.ts';

const OUTPUT = 'public/relief';
const META = `${OUTPUT}/relief-meta.json`;
const LONLAT = '+proj=longlat +datum=WGS84 +no_defs';
// Rows per request, to keep each response small.
const ROWS_PER_REQUEST = 120;
const ATTEMPTS = 3;

const NOAA = 'https://www.ngdc.noaa.gov/thredds/dodsC/global/ETOPO2022';
const ERDDAP =
  'https://erddap.emodnet.eu/erddap/griddap/dtm_2020_v2_e0bf_e7e4_5b8f.asc';

const ETOPO_CREDIT =
  'NOAA National Centers for Environmental Information (2022): ETOPO 2022 Global Relief Model. DOI 10.25921/fd45-gt74. Public domain.';
const EMODNET_CREDIT =
  'EMODnet Bathymetry Consortium (2020): EMODnet Digital Bathymetry (DTM 2020). DOI 10.12770/bb6a87dd-e579-4036-abe1-e649cea9881a.';

/**
 * A grid on a server, about `inc` degrees between cell centres, read with
 * `[j0:1:j1][i0:1:i1]` index ranges (j from the south). Its axes are read first and
 * each value of the regular grid made takes the cell nearest it: EMODnet's axes skip a
 * cell here and there, so an index is not where `inc` alone would put it.
 */
const SOURCES = {
  etopo60: {
    url: `${NOAA}/60s/60s_surface_elev_netcdf/ETOPO_2022_v1_60s_N90W180_surface.nc.ascii`,
    variable: 'z',
    axes: { lon: 'lon', lat: 'lat' },
    inc: 1 / 60,
    none: value => value <= -99999,
    attribution: ETOPO_CREDIT,
  },
  // One 15° tile: 45–60°N, 0–15°E.
  etopo15N60E000: {
    url: `${NOAA}/15s/15s_surface_elev_netcdf/ETOPO_2022_v1_15s_N60E000_surface.nc.ascii`,
    variable: 'z',
    axes: { lon: 'lon', lat: 'lat' },
    inc: 1 / 240,
    none: value => value <= -99999,
    attribution: ETOPO_CREDIT,
  },
  emodnet2020: {
    url: ERDDAP,
    variable: 'elevation',
    axes: { lon: 'longitude', lat: 'latitude' },
    inc: 1 / 960,
    // Its fill value is 0, which its `.asc` writes as it is (its CSV writes NaN): there
    // is no land, and a seabed of exactly 0 m is none either.
    none: value => value === 0,
    attribution: EMODNET_CREDIT,
  },
};

/** The reliefs: a source, the area to crop (degrees), and source cells per value. */
const RELIEFS = {
  'etopo-2022-nordic': {
    name: 'ETOPO 2022, Norway to the British Isles',
    description:
      'ETOPO 2022 Global Relief Model (ice surface), 60 arc-seconds averaged to 2 arc-minutes.',
    source: SOURCES.etopo60,
    area: { west: -12, east: 32, south: 49, north: 72 },
    block: 2,
  },
  'etopo-2022-15s-sw-norway': {
    name: 'ETOPO 2022 15″, south-western Norway',
    description:
      'ETOPO 2022 Global Relief Model (ice surface), 15 arc-seconds, from Volve east to the coast.',
    source: SOURCES.etopo15N60E000,
    area: { west: 1.5, east: 6.5, south: 58, north: 59.5 },
    block: 1,
  },
  'emodnet-2020-sw-norway': {
    name: 'EMODnet DTM 2020, south-western Norway',
    description:
      'EMODnet Digital Bathymetry (DTM 2020), 1/16 arc-minute averaged 2 x 2, from Volve east to the coast. Sea only; heights above lowest astronomical tide.',
    source: SOURCES.emodnet2020,
    area: { west: 1.5, east: 6.5, south: 58, north: 59.5 },
    block: 2,
  },
  'emodnet-2020-volve': {
    name: 'EMODnet DTM 2020, around Volve',
    description:
      'EMODnet Digital Bathymetry (DTM 2020), 1/16 arc-minute, around the Volve field. Sea only; heights above lowest astronomical tide.',
    source: SOURCES.emodnet2020,
    area: { west: 1.38, east: 2.38, south: 58.19, north: 58.69 },
    block: 1,
  },
};

// An axis of a source, as the server has it: ascending values.
const axes = new Map();
async function axis(source, name) {
  const key = `${source.url}|${name}`;
  if (!axes.has(key)) {
    const text = await fetchText(`${source.url}?${name}`);
    const lines = text.split('\n');
    const at = lines.findIndex(line =>
      new RegExp(`^${name}\\[\\d+\\]`).test(line.trim()),
    );
    if (at < 0) throw new Error(`no ${name} axis`);
    axes.set(key, lines[at + 1].split(',').map(Number));
  }
  return axes.get(key);
}

// A regular grid of `inc` along an axis from `from` to `to`: where it starts (the first
// value at or past `from`), and the source index nearest each of its values.
function regular(values, inc, from, to) {
  const nearest = target => {
    let lo = 0;
    let hi = values.length - 1;
    while (hi - lo > 1) {
      const mid = (lo + hi) >> 1;
      if (values[mid] < target) lo = mid;
      else hi = mid;
    }
    return Math.abs(values[lo] - target) <= Math.abs(values[hi] - target)
      ? lo
      : hi;
  };
  let first = nearest(from);
  if (values[first] < from - inc * 1e-3) first++;
  const start = values[first];
  const count = Math.round((to - from) / inc);
  const indices = [];
  for (let k = 0; k < count; k++) indices.push(nearest(start + k * inc));
  return { start, indices };
}

async function fetchText(url) {
  for (let attempt = 1; ; attempt++) {
    try {
      const response = await fetch(url);
      if (!response.ok)
        throw new Error(`${response.status} ${response.statusText}`);
      return await response.text();
    } catch (error) {
      if (attempt >= ATTEMPTS) throw error;
      console.warn(`  retrying (${error.message})`);
      await new Promise(resolve => setTimeout(resolve, 2000 * attempt));
    }
  }
}

// Rows `j0` to `j0 + count - 1` (from the south) of columns `i0` to `i0 + cols - 1`: each
// an array of numbers, NaN for none. Both servers write a grid row as `[k], v, v, …`.
async function fetchRows(source, j0, count, i0, cols) {
  const range = `%5B${j0}:1:${j0 + count - 1}%5D%5B${i0}:1:${i0 + cols - 1}%5D`;
  const text = await fetchText(`${source.url}?${source.variable}${range}`);
  const rows = [];
  for (const line of text.split('\n')) {
    if (!line.startsWith('[')) continue;
    const row = line
      .slice(line.indexOf(',') + 1)
      .split(',')
      .map(v => {
        const value = Number(v);
        return Number.isFinite(value) && !source.none(value) ? value : NaN;
      });
    if (row.length !== cols) throw new Error(`a row of ${row.length} values`);
    rows.push(row);
  }
  if (rows.length !== count) throw new Error(`${rows.length} rows`);
  return rows;
}

// The mean of each `block` x `block` of the source rows that is not NaN, rows from the south.
function averageBlocks(rows, cols, block) {
  const nx = Math.floor(cols / block);
  const ny = Math.floor(rows.length / block);
  const values = new Float32Array(nx * ny);
  for (let j = 0; j < ny; j++) {
    for (let i = 0; i < nx; i++) {
      let sum = 0;
      let n = 0;
      for (let b = 0; b < block; b++) {
        const row = rows[j * block + b];
        for (let a = 0; a < block; a++) {
          const value = row[i * block + a];
          if (value === value) {
            sum += value;
            n++;
          }
        }
      }
      values[j * nx + i] = n > 0 ? sum / n : NaN;
    }
  }
  return { values, nx, ny };
}

async function generate(id, relief) {
  const { source, area, block } = relief;
  const lon = regular(
    await axis(source, source.axes.lon),
    source.inc,
    area.west,
    area.east,
  );
  const lat = regular(
    await axis(source, source.axes.lat),
    source.inc,
    area.south,
    area.north,
  );
  const i0 = Math.min(...lon.indices);
  const i1 = Math.max(...lon.indices);
  const j0 = Math.min(...lat.indices);
  const j1 = Math.max(...lat.indices);
  // The source rows from j0 to j1, then the regular grid's picked out of them.
  const fetched = [];
  for (let from = j0; from <= j1; from += ROWS_PER_REQUEST) {
    const count = Math.min(ROWS_PER_REQUEST, j1 - from + 1);
    fetched.push(...(await fetchRows(source, from, count, i0, i1 - i0 + 1)));
    console.log(`  rows ${from + count - j0} of ${j1 - j0 + 1}`);
  }
  const rows = lat.indices.map(j => {
    const row = fetched[j - j0];
    return lon.indices.map(i => row[i - i0]);
  });
  const { values, nx, ny } = averageBlocks(rows, lon.indices.length, block);
  const inc = source.inc * block;
  // The centre of the first block.
  const shift = ((block - 1) / 2) * source.inc;
  return gridToRelief(
    {
      values,
      size: [nx, ny],
      origin: [lon.start + shift, lat.start + shift],
      cell: [inc, inc],
      crs: LONLAT,
      rows: 'south',
    },
    {
      id,
      name: relief.name,
      description: relief.description,
      attribution: source.attribution,
    },
  );
}

async function main() {
  const args = process.argv.slice(2);
  const force = args.includes('--force');
  const named = args.filter(arg => !arg.startsWith('--'));
  const unknown = named.filter(id => !RELIEFS[id]);
  if (unknown.length) {
    throw new Error(
      `unknown relief ${unknown.join(', ')}; known: ${Object.keys(RELIEFS).join(', ')}`,
    );
  }
  const ids = named.length ? named : Object.keys(RELIEFS);

  fs.mkdirSync(OUTPUT, { recursive: true });
  const metas = fs.existsSync(META)
    ? JSON.parse(fs.readFileSync(META, 'utf8'))
    : {};
  // Records from before the relief contract (a `header`, not a `grid`) are made again.
  for (const id of Object.keys(metas)) {
    if (!metas[id]?.grid) delete metas[id];
  }

  for (const id of ids) {
    const file = `${OUTPUT}/${id}.bin`;
    if (!force && metas[id] && fs.existsSync(file)) {
      console.log(`${id}: there already (--force to make it again)`);
      continue;
    }
    console.log(`${id}:`);
    const { meta, values } = await generate(id, RELIEFS[id]);
    fs.writeFileSync(file, Buffer.from(values.buffer));
    metas[id] = meta;
    // After each, so an interrupted run keeps what it made.
    fs.writeFileSync(META, `${JSON.stringify(metas, null, 2)}\n`);
    const [nx, ny] = meta.grid.size;
    console.log(
      `  ${file}: ${nx} x ${ny}, ${meta.min.toFixed(0)} to ${meta.max.toFixed(0)} m, ${(values.byteLength / 1e6).toFixed(1)} MB`,
    );
  }
}

main().catch(error => {
  console.error(error);
  process.exit(1);
});
