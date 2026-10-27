import { DataTexture, FloatType, RGBAFormat, RGFormat } from 'three';
import { brightStars } from '../../sdk/utils/bright-stars';

/** Cells along each edge of a cube face in the catalogue's grid over the sky. */
export const SKY_STAR_CELLS = 32;
/** How far from a star (radians) it is still drawn: it is listed in every cell this near it. */
export const SKY_STAR_MARGIN = (0.5 * Math.PI) / 180;
// The sampled circle a star's margin is listed by.
const MARGIN_SAMPLES = 16;
// Entries per row of the star list.
const LIST_WIDTH = 64;

/**
 * The cell of a cube-face grid over the sky a direction falls in: its face (+x, -x, +y,
 * -y, +z, -z) and its column and row. ⚠️ sky.glsl's `skyCatalogue` repeats it.
 */
export function skyStarCell(
  x: number,
  y: number,
  z: number,
  cells = SKY_STAR_CELLS,
): [number, number, number] {
  const ax = Math.abs(x);
  const ay = Math.abs(y);
  const az = Math.abs(z);
  let face: number;
  let u: number;
  let v: number;
  if (ax >= ay && ax >= az) {
    face = x > 0 ? 0 : 1;
    u = y / ax;
    v = z / ax;
  } else if (ay >= az) {
    face = y > 0 ? 2 : 3;
    u = x / ay;
    v = z / ay;
  } else {
    face = z > 0 ? 4 : 5;
    u = x / az;
    v = y / az;
  }
  const cell = (t: number) =>
    Math.min(Math.max(Math.floor((t * 0.5 + 0.5) * cells), 0), cells - 1);
  return [face, cell(u), cell(v)];
}

/**
 * The {@link brightStars} as the sky shader reads them, by cell of a {@link skyStarCell}
 * grid: `cells` holds each cell's first entry and count (`cells` columns, a face's rows
 * after another's), and `list` each entry's J2000 direction — scaled by 2 + its B-V, so
 * it carries its colour — and its magnitude.
 */
export function skyStarCatalogue(
  cells = SKY_STAR_CELLS,
  margin = SKY_STAR_MARGIN,
) {
  const stars = brightStars();
  const byCell: number[][] = Array.from(
    { length: 6 * cells * cells },
    () => [],
  );
  const at = (x: number, y: number, z: number) => {
    const [face, column, row] = skyStarCell(x, y, z, cells);
    return (face * cells + row) * cells + column;
  };
  for (let i = 0; i < stars.count; i++) {
    const ra = (stars.rightAscension[i] * Math.PI) / 180;
    const dec = (stars.declination[i] * Math.PI) / 180;
    const s = [
      Math.cos(dec) * Math.cos(ra),
      Math.cos(dec) * Math.sin(ra),
      Math.sin(dec),
    ];
    // Two directions across it: east and north on the sky.
    const t1 = [-Math.sin(ra), Math.cos(ra), 0];
    const t2 = [
      -Math.sin(dec) * Math.cos(ra),
      -Math.sin(dec) * Math.sin(ra),
      Math.cos(dec),
    ];
    const listed = new Set([at(s[0], s[1], s[2])]);
    for (let k = 0; k < MARGIN_SAMPLES; k++) {
      const theta = (k / MARGIN_SAMPLES) * Math.PI * 2;
      const a = Math.sin(margin) * Math.cos(theta);
      const b = Math.sin(margin) * Math.sin(theta);
      const c = Math.cos(margin);
      listed.add(
        at(
          c * s[0] + a * t1[0] + b * t2[0],
          c * s[1] + a * t1[1] + b * t2[1],
          c * s[2] + a * t1[2] + b * t2[2],
        ),
      );
    }
    for (const cell of listed) byCell[cell].push(i);
  }

  const entries = byCell.reduce((sum, list) => sum + list.length, 0);
  const rows = Math.ceil(entries / LIST_WIDTH);
  const cellData = new Float32Array(byCell.length * 2);
  const list = new Float32Array(rows * LIST_WIDTH * 4);
  let next = 0;
  let mostInCell = 0;
  byCell.forEach((members, cell) => {
    cellData[cell * 2] = next;
    cellData[cell * 2 + 1] = members.length;
    mostInCell = Math.max(mostInCell, members.length);
    for (const i of members) {
      const ra = (stars.rightAscension[i] * Math.PI) / 180;
      const dec = (stars.declination[i] * Math.PI) / 180;
      const length = 2 + stars.colorIndex[i];
      list[next * 4] = Math.cos(dec) * Math.cos(ra) * length;
      list[next * 4 + 1] = Math.cos(dec) * Math.sin(ra) * length;
      list[next * 4 + 2] = Math.sin(dec) * length;
      list[next * 4 + 3] = stars.magnitude[i];
      next++;
    }
  });
  return {
    cells: cellData,
    cellsPerEdge: cells,
    list,
    listWidth: LIST_WIDTH,
    entries,
    mostInCell,
  };
}

/** {@link skyStarCatalogue} as the sky shader's two textures. Dispose of them when done. */
export function createSkyStarTextures() {
  const catalogue = skyStarCatalogue();
  const n = catalogue.cellsPerEdge;
  const cells = new DataTexture(catalogue.cells, n, 6 * n, RGFormat, FloatType);
  const list = new DataTexture(
    catalogue.list,
    catalogue.listWidth,
    catalogue.list.length / 4 / catalogue.listWidth,
    RGBAFormat,
    FloatType,
  );
  cells.needsUpdate = true;
  list.needsUpdate = true;
  return { cells, list };
}
