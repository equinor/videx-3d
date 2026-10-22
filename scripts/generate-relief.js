/**
 * Crops the demo relief for the stories from ETOPO 2022 (NOAA National Centers for
 * Environmental Information, 2022: ETOPO 2022 Global Relief Model, ice surface, 60
 * arc-seconds, DOI 10.25921/fd45-gt74; public domain): 12°W–32°E, 49–72°N, which holds
 * Norway, Denmark, the British Isles and the North Sea, averaged over 2x2 cells to 2
 * arc-minutes. Writes a `relief-meta` record and its `relief-values` into public/relief/:
 *
 *   node scripts/generate-relief.js
 *
 * The values are raw little-endian float32, metres above mean sea level (negative below,
 * NaN for no data), row-major from the northern row, as the demo surfaces are stored.
 */

import fs from 'node:fs';

const SOURCE =
  'https://www.ngdc.noaa.gov/thredds/dodsC/global/ETOPO2022/60s/60s_surface_elev_netcdf/ETOPO_2022_v1_60s_N90W180_surface.nc.ascii';
const OUTPUT = 'public/relief';
const ID = 'etopo-2022-nordic';
const WEST = -12;
const EAST = 32;
const SOUTH = 49;
const NORTH = 72;
// Source cells per output cell, along each axis.
const BLOCK = 2;
// Source rows per request, to keep each response small.
const ROWS_PER_REQUEST = 120;
const FILL = -99999;

// The source grid's cell centres lie at -180 + (i + 0.5) / 60 and -90 + (j + 0.5) / 60.
const firstLon = (WEST + 180) * 60;
const firstLat = (SOUTH + 90) * 60;
const cols = (EAST - WEST) * 60;
const rows = (NORTH - SOUTH) * 60;

async function fetchRows(from, count) {
  const lat = `${firstLat + from}:1:${firstLat + from + count - 1}`;
  const lon = `${firstLon}:1:${firstLon + cols - 1}`;
  const response = await fetch(`${SOURCE}?z%5B${lat}%5D%5B${lon}%5D`);
  if (!response.ok) throw new Error(`${response.status} ${response.statusText}`);
  const text = await response.text();
  const values = [];
  for (const line of text.split('\n')) {
    if (!line.startsWith('[')) continue;
    const row = line
      .slice(line.indexOf(',') + 1)
      .split(',')
      .map(v => {
        const value = Number(v);
        return value === FILL ? NaN : value;
      });
    if (row.length !== cols) throw new Error(`a row of ${row.length} values`);
    values.push(row);
  }
  if (values.length !== count) throw new Error(`${values.length} rows`);
  return values;
}

async function main() {
  // South to north, as the source runs.
  const source = [];
  for (let from = 0; from < rows; from += ROWS_PER_REQUEST) {
    const count = Math.min(ROWS_PER_REQUEST, rows - from);
    source.push(...(await fetchRows(from, count)));
    console.log(`rows ${from + count} of ${rows}`);
  }

  const nx = cols / BLOCK;
  const ny = rows / BLOCK;
  const values = new Float32Array(nx * ny);
  let min = Infinity;
  let max = -Infinity;
  for (let j = 0; j < ny; j++) {
    for (let i = 0; i < nx; i++) {
      let sum = 0;
      let n = 0;
      for (let b = 0; b < BLOCK; b++) {
        for (let a = 0; a < BLOCK; a++) {
          const value = source[j * BLOCK + b][i * BLOCK + a];
          if (Number.isNaN(value)) continue;
          sum += value;
          n++;
        }
      }
      const value = n > 0 ? sum / n : NaN;
      // The northern row first.
      values[(ny - 1 - j) * nx + i] = value;
      if (n > 0) {
        min = Math.min(min, value);
        max = Math.max(max, value);
      }
    }
  }

  const inc = BLOCK / 60;
  const xori = WEST + inc / 2;
  const yori = SOUTH + inc / 2;
  const meta = {
    id: ID,
    name: 'ETOPO 2022, Norway to the British Isles',
    description:
      'NOAA NCEI ETOPO 2022 Global Relief Model (ice surface), DOI 10.25921/fd45-gt74, averaged to 2 arc-minutes.',
    projection: '+proj=longlat +datum=WGS84 +no_defs',
    min,
    max,
    displayMin: min,
    displayMax: max,
    color: '#808080',
    visualization: 'relief',
    header: {
      nx,
      ny,
      xori,
      yori,
      xinc: inc,
      yinc: inc,
      xmax: xori + (nx - 1) * inc,
      ymax: yori + (ny - 1) * inc,
      rot: 0,
    },
  };

  fs.mkdirSync(OUTPUT, { recursive: true });
  fs.writeFileSync(`${OUTPUT}/${ID}.bin`, Buffer.from(values.buffer));
  fs.writeFileSync(
    `${OUTPUT}/relief-meta.json`,
    `${JSON.stringify({ [ID]: meta }, null, 2)}\n`,
  );
  console.log(
    `${OUTPUT}/${ID}.bin: ${nx} x ${ny}, ${min.toFixed(0)} to ${max.toFixed(0)} m`,
  );
}

main().catch(error => {
  console.error(error);
  process.exit(1);
});
