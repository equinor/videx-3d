import { marchingSquares } from './marching-squares';

// ⚠️ Free of three.js.

/**
 * Where a contour line's label goes on a relief tile (see
 * {@link reliefContourLabelPoints}): in the tile's own nodes, `column` east from its west
 * edge and `row` south from its north edge (0 to `cells`), on the line where the height
 * bilinear between a cell's four nodes crosses it, as the relief shades its lines; the
 * line's height (`level`) and the ground's there as the tile is drawn, on its triangles
 * (`height`: the line lies off them by a little within a cell); the way its text reads, a
 * unit step in columns and rows, along the line with the text's top uphill (its top is the
 * way it reads turned a right angle toward north from east); how the drawn ground rises
 * there, metres a column and a row — the label lies on its triangle; and its `rank`: 0
 * among the labels `spacing` apart, `r` among those added halfway between the labels of
 * the ranks before it, `spacing / 2^r` apart.
 *
 * @group Geometries
 */
export type ReliefContourLabelPoint = {
  column: number;
  row: number;
  level: number;
  height: number;
  along: [number, number];
  rise: [number, number];
  rank: number;
};

/**
 * Options of {@link reliefContourLabelPoints}.
 *
 * @group Geometries
 */
export type ReliefContourLabelOptions = {
  /**
   * a cell's width (a column) over its height (a row) on the ground: lengths and turns
   * measured as they are there, in rows — on a geographic tile, the cosine of its latitude.
   * Default 1
   */
  aspect?: number;
  /** the finest rank found: each halves the spacing of the ones before. Default 0 */
  ranks?: number;
  /** the coarsest rank found: those coarser left out (found before, say). Default 0 */
  from?: number;
  /** a place it refuses, by its nearest node, is passed over */
  keep?: (column: number, row: number) => boolean;
};

// How far either side of a label its line is looked along for its way, in rows at rank 0
// (about a label's half length where its tile is drawn), halved each rank but never under
// half a row; and how far its way may turn over that before the place is too bent to read
// along.
const REACH = 1.5;
const LEAST_REACH = 0.5;
const BENT = Math.cos((40 * Math.PI) / 180);

/**
 * Where to label a relief tile's contour lines at `levels`: its heights (`(cells + 3)²`, a
 * border of one node round its own, row by row from the north, as `ReliefTile`'s)
 * contoured on its own nodes (`marchingSquares`), each line's labels evenly along it at
 * least `spacing` rows apart (rank 0) — one in the middle of a line shorter than that, none
 * on one shorter than half of it. Each finer rank, to `ranks`, halves that: its labels lie
 * halfway between those before, which keep their places, and a line too short for the
 * ranks before has its first label in its middle at the first rank it is long enough for.
 * A place where the line turns too much to read along, too near the tile's edge (its
 * neighbour labels the line there), or that `keep` refuses (by its nearest node) is passed
 * over: how far along the line looked at, and how near the edge, shrink with the rank, as
 * its labels are seen nearer.
 *
 * @group Geometries
 */
export function reliefContourLabelPoints(
  tile: { cells: number; heights: ArrayLike<number> },
  levels: readonly number[],
  spacing: number,
  options: ReliefContourLabelOptions = {},
): ReliefContourLabelPoint[] {
  const { aspect = 1, ranks = 0, from = 0, keep } = options;
  const { cells, heights } = tile;
  const nodes = cells + 3;
  const own = cells + 1;
  const field = new Float32Array(own * own);
  for (let row = 0; row < own; row++)
    for (let column = 0; column < own; column++)
      field[row * own + column] = heights[(1 + row) * nodes + 1 + column];
  const points: ReliefContourLabelPoint[] = [];
  const step = Math.max(spacing, 1e-6);
  for (const level of levels) {
    for (const ring of marchingSquares(field, own, own, level)) {
      const n = ring.length;
      // Closed where its ends meet: round the tile's edge it runs out.
      const [fx, fy] = ring[0];
      const [lx, ly] = ring[n - 1];
      const closed = Math.hypot((fx - lx) * aspect, fy - ly) <= 1.5;
      const segments = closed ? n : n - 1;
      // Lengths along it in rows, as on the ground.
      const lengths = new Float64Array(segments + 1);
      for (let k = 0; k < segments; k++) {
        const [ax, ay] = ring[k];
        const [bx, by] = ring[(k + 1) % n];
        lengths[k + 1] = lengths[k] + Math.hypot((bx - ax) * aspect, by - ay);
      }
      const length = lengths[segments];
      if (length <= 0) continue;
      // Its first rank: the first it is half that rank's spacing long for.
      const first =
        length >= step / 2
          ? 0
          : Math.ceil(Math.log2(step / (2 * length)) - 1e-9);
      if (first > ranks) continue;
      // The point `s` along it: round a closed line, held to an open one's ends.
      const at = (s: number): [number, number] => {
        let d = closed ? ((s % length) + length) % length : s;
        d = Math.min(Math.max(d, 0), length);
        let low = 0;
        let high = segments;
        while (high - low > 1) {
          const middle = (low + high) >> 1;
          if (lengths[middle] <= d) low = middle;
          else high = middle;
        }
        const span = lengths[low + 1] - lengths[low];
        const t = span > 0 ? (d - lengths[low]) / span : 0;
        const [ax, ay] = ring[low];
        const [bx, by] = ring[(low + 1) % n];
        return [ax + (bx - ax) * t, ay + (by - ay) * t];
      };
      // Its first rank's labels `gap` apart, the first half of it from the start; each
      // rank after halves the gaps.
      const count = Math.max(1, Math.floor(length / (step / 2 ** first)));
      const gap = length / count;
      const offset = gap / 2;
      for (let rank = Math.max(first, from); rank <= ranks; rank++) {
        const halves = rank - first;
        const each = gap / 2 ** halves;
        // Those new at this rank: an odd number of `each` off the first rank's places (at
        // the first rank, those places).
        let low: number;
        let high: number;
        if (halves === 0) {
          low = 0;
          high = count - 1;
        } else if (closed) {
          low = 0;
          high = count * 2 ** halves - 1;
        } else {
          low = Math.ceil(-offset / each + 1e-9);
          high = Math.floor((length - offset) / each - 1e-9);
        }
        const reach = Math.max(REACH / 2 ** rank, LEAST_REACH);
        const edgeColumn = reach / aspect;
        for (let m = low; m <= high; m++) {
          if (halves > 0 && m % 2 === 0) continue;
          const s = offset + m * each;
          const [column, row] = at(s);
          if (
            column < edgeColumn ||
            row < reach ||
            column > cells - edgeColumn ||
            row > cells - reach
          )
            continue;
          const [bx, by] = at(s - reach);
          const [ax, ay] = at(s + reach);
          const inX = (column - bx) * aspect;
          const inY = row - by;
          const outX = (ax - column) * aspect;
          const outY = ay - row;
          const inLength = Math.hypot(inX, inY);
          const outLength = Math.hypot(outX, outY);
          if (
            inLength < 1e-6 ||
            outLength < 1e-6 ||
            (inX * outX + inY * outY) / (inLength * outLength) < BENT
          )
            continue;
          if (keep && !keep(Math.round(column), Math.round(row))) continue;
          let alongX = ax - bx;
          let alongY = ay - by;
          const alongLength = Math.hypot(alongX, alongY);
          alongX /= alongLength;
          alongY /= alongLength;
          // On the line as drawn: the relief shades its lines by the height bilinear between
          // a cell's four nodes, which curves inside a cell where marching squares' chords
          // run straight.
          const [onColumn, onRow] = onBilinearLine(
            field,
            own,
            column,
            row,
            level,
          );
          const ground = groundAt(field, own, onColumn, onRow);
          const rise = ground.rise;
          // Its top uphill: the way it reads turned toward north from east (row up, column
          // along) points up the slope. On the ground, a column `aspect` rows wide, that is
          // row × rise-east − aspect² × column × rise-south being positive.
          if (alongY * rise[0] - aspect * aspect * alongX * rise[1] < 0) {
            alongX = -alongX;
            alongY = -alongY;
          }
          points.push({
            column: onColumn,
            row: onRow,
            level,
            height: ground.height,
            along: [alongX, alongY],
            rise,
            rank,
          });
        }
      }
    }
  }
  return points;
}

// The point of the line at `level` nearest (`column`, `row`), on the height bilinear between
// each cell's four nodes, as the relief shades its lines: a few Newton steps down the
// height's gradient, each at most half a cell. Where they do not settle, (`column`, `row`).
function onBilinearLine(
  field: Float32Array,
  own: number,
  column: number,
  row: number,
  level: number,
): [number, number] {
  const most = own - 1;
  let c = column;
  let r = row;
  for (let step = 0; step < 6; step++) {
    const i = Math.min(Math.max(Math.floor(c), 0), own - 2);
    const j = Math.min(Math.max(Math.floor(r), 0), own - 2);
    const u = c - i;
    const v = r - j;
    const h00 = field[j * own + i];
    const h10 = field[j * own + i + 1];
    const h01 = field[(j + 1) * own + i];
    const h11 = field[(j + 1) * own + i + 1];
    const off =
      h00 +
      u * (h10 - h00) +
      v * (h01 - h00) +
      u * v * (h00 - h10 - h01 + h11) -
      level;
    const gx = h10 - h00 + v * (h00 - h10 - h01 + h11);
    const gy = h01 - h00 + u * (h00 - h10 - h01 + h11);
    const g2 = gx * gx + gy * gy;
    if (g2 < 1e-12) break;
    if (Math.abs(off) < 1e-4 * Math.sqrt(g2)) return [c, r];
    let dc = (-off * gx) / g2;
    let dr = (-off * gy) / g2;
    const length = Math.hypot(dc, dr);
    if (length > 0.5) {
      dc *= 0.5 / length;
      dr *= 0.5 / length;
    }
    c = Math.min(Math.max(c + dc, 0), most);
    r = Math.min(Math.max(r + dr, 0), most);
  }
  return [column, row];
}

// The ground at (`column`, `row`) as a relief tile is drawn: on the triangle it lies in, its
// cells split from (i + 1, j) to (i, j + 1) (`geoReliefTileHeightAt`'s `drawn`): its height,
// and how it rises, metres a column (east) and a row (south).
function groundAt(
  field: Float32Array,
  own: number,
  column: number,
  row: number,
): { height: number; rise: [number, number] } {
  const i = Math.min(Math.floor(column), own - 2);
  const j = Math.min(Math.floor(row), own - 2);
  const u = column - i;
  const v = row - j;
  const h00 = field[j * own + i];
  const h10 = field[j * own + i + 1];
  const h01 = field[(j + 1) * own + i];
  const h11 = field[(j + 1) * own + i + 1];
  if (u + v <= 1)
    return {
      height: h00 + u * (h10 - h00) + v * (h01 - h00),
      rise: [h10 - h00, h01 - h00],
    };
  return {
    height: h11 + (1 - u) * (h01 - h11) + (1 - v) * (h10 - h11),
    rise: [h11 - h01, h11 - h10],
  };
}
