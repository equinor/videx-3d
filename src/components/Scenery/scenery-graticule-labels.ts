import { Vector3 } from 'three';
import type { Label } from '../Labels/types';
import type { Globe } from '../../sdk/projection/globe';

/** How many lines either way from where the view is centred a graticule labels, by default. */
export const GRATICULE_LABEL_REACH = 10;

/**
 * How densely a graticule's lines are labelled, by default, 0.1 to 1: at 1 a line's name
 * comes every {@link GRATICULE_LABEL_PERIOD} cells along it, at 0.5 every twice that.
 */
export const GRATICULE_LABEL_DENSITY = 0.5;

/**
 * The fewest cells from a line's name to the next along it, at density 1. Fewer, and some
 * parallel's name would cross some meridian's where the two lines meet, however they are
 * staggered.
 */
export const GRATICULE_LABEL_PERIOD = 4;

/** A graticule label's font size, by default, as a fraction of its cell's narrower side. */
export const GRATICULE_LABEL_SIZE = 0.18;

/**
 * The finer step's weight its labels switch to it at, going finer, and back at, going
 * coarser: apart, so they do not flicker between the two at the switch.
 */
export const GRATICULE_LABEL_SWITCH: readonly [number, number] = [0.55, 0.45];

/** How much larger than its step's size a label drawn `'smooth'` grows at the most. */
export const GRATICULE_LABEL_SMOOTH_MAX = 1.6;

/**
 * The step a graticule's labels follow: the one its lines are seen at — the finer of the
 * two drawn (`graticuleStep`) once its weight passes {@link GRATICULE_LABEL_SWITCH}, the
 * coarser before — kept from `previous` across the switch.
 */
export function graticuleLabelStep(
  step: number,
  finer: number,
  weight: number,
  previous?: number,
) {
  if (!(finer > 0) || finer === step) return step;
  const [up, down] = GRATICULE_LABEL_SWITCH;
  return weight >= (previous === finer ? down : up) ? finer : step;
}

/**
 * The spacing a graticule's lines are seen at, between their two steps as the finer fades
 * in, on a log scale as it does: what labels drawn `'smooth'` follow. It meets the step on
 * either side of a change of step, so it never jumps.
 */
export function graticuleLabelSpacing(
  step: number,
  finer: number,
  weight: number,
) {
  if (!(finer > 0) || finer === step) return step;
  const w = Math.min(Math.max(weight, 0), 1);
  return step ** (1 - w) * finer ** w;
}

// Metres along a meridian per degree of latitude, on the Earth's mean sphere.
const METRES_PER_DEGREE = (Math.PI / 180) * 6371008.8;

/**
 * A graticule label's font size, in metres, for lines `step` degrees apart about
 * `latitude`: `fraction` of the narrower side of a cell there, east–west (a degree of
 * longitude shrinks by the cosine of the latitude). So a label fits between the labels
 * either side of it along its line, however far north.
 */
export function graticuleLabelSize(
  step: number,
  latitude: number,
  fraction = GRATICULE_LABEL_SIZE,
) {
  const across = Math.max(Math.cos((latitude * Math.PI) / 180), 0.05);
  return fraction * step * METRES_PER_DEGREE * across;
}

/**
 * A line of latitude (`'lat'`) or longitude (`'lon'`) as a label reads it: degrees, then
 * minutes and seconds only as finely as `step` (degrees) needs, and its hemisphere —
 * `60°N`, `60°30′N`, `2°07′30″E`; `0°`, and `180°` for the date line.
 */
export function graticuleLabelText(
  value: number,
  step: number,
  axis: 'lat' | 'lon',
): string {
  // To the second, so the steps (multiples of a minute or more) land exactly.
  const total = Math.round(Math.abs(value) * 3600);
  const degrees = Math.floor(total / 3600);
  const minutes = Math.floor((total % 3600) / 60);
  const seconds = total % 60;
  const fine = step * 3600;
  let text = `${degrees}°`;
  if (fine < 3600 || minutes || seconds)
    text += `${String(minutes).padStart(2, '0')}′`;
  if (fine < 60 || seconds) text += `${String(seconds).padStart(2, '0')}″`;
  if (total === 0 || (axis === 'lon' && total === 180 * 3600)) return text;
  const positive = value > 0;
  return (
    text + (axis === 'lat' ? (positive ? 'N' : 'S') : positive ? 'E' : 'W')
  );
}

// A longitude from −180° to 180°.
const wrap = (longitude: number) =>
  longitude - 360 * Math.floor((longitude + 180) / 360);

const at = new Vector3();
const toward = new Vector3();
const up = new Vector3();
const level = new Vector3();

/**
 * Where a view from `position` along `dir` is centred on the sea of `globe` (it needs a
 * frame), as latitude and longitude: where it meets the sea; past the horizon, the horizon
 * the way it looks, where the lines' step is judged then, so the labels nearest the camera
 * are not drawn at a step meant for far away; straight up, under the camera.
 */
export function graticuleLabelCentre(
  globe: Globe,
  position: Vector3,
  dir: Vector3,
  target = { latitude: 0, longitude: 0 },
): { latitude: number; longitude: number } {
  const reached = globe.reach(position, dir, 0);
  if (reached.hit) {
    at.copy(position).addScaledVector(dir, reached.distance / dir.length());
    return globe.geographic(at, target);
  }
  globe.upAt(position, up);
  level.copy(dir).addScaledVector(up, -dir.dot(up));
  const height = globe.altitude(position);
  if (height <= 0 || level.lengthSq() < 1e-12 * dir.lengthSq())
    return globe.geographic(position, target);
  // The horizon: down from level by the dip, √(h (2R + h)) away.
  const R = globe.radius;
  const sinDip = Math.sqrt(height * (2 * R + height)) / (R + height);
  const cosDip = R / (R + height);
  const far = Math.sqrt(height * (2 * R + height));
  level.normalize();
  at.copy(position)
    .addScaledVector(level, far * cosDip)
    .addScaledVector(up, -far * sinDip);
  return globe.geographic(at, target);
}

/**
 * How many cells from a line's name to the next along it, at `density` (0.1 to 1):
 * {@link GRATICULE_LABEL_PERIOD} at 1, more as it falls.
 */
export function graticuleLabelPeriod(density = GRATICULE_LABEL_DENSITY) {
  const d = Math.min(Math.max(density, 0.1), 1);
  return Math.max(
    GRATICULE_LABEL_PERIOD,
    Math.round(GRATICULE_LABEL_PERIOD / d),
  );
}

const DEG = Math.PI / 180;

/**
 * How many of the lines' steps from one labelled meridian to the next at `latitude`, a
 * power of two: 1 until the meridians close in to 4/5 of their spacing at `reference`, the
 * latitude the labels' size is judged at ({@link graticuleLabelSize}) — as close as the
 * labels' stagger allows — then as many as keep them no closer. Powers of two, so those
 * labelled farther poleward are among those labelled nearer. Four columns round the Earth
 * at the least.
 */
export function graticuleLabelThinning(
  step: number,
  latitude: number,
  reference: number,
) {
  const ratio =
    Math.max(Math.cos(reference * DEG), 0.05) /
    Math.max(Math.cos(latitude * DEG), 1e-9) /
    GRATICULE_LABEL_SQUEEZE;
  if (!(ratio > 1 + 1e-9)) return 1;
  const most = 2 ** Math.max(Math.floor(Math.log2(90 / step)), 0);
  return Math.min(2 ** Math.ceil(Math.log2(ratio)), most);
}

// How much closer than at the reference latitude labelled meridians may be: the stagger
// keeps a parallel's name 1.5 columns from the meridians' names it could meet, 1.07 needed.
const GRATICULE_LABEL_SQUEEZE = 1.25;

const mod = (a: number, n: number) => ((a % n) + n) % n;

/**
 * How a graticule's names are spread, period `k` ({@link graticuleLabelPeriod}): parallel
 * `i` named in the columns `≡ s·i`, meridian `j` in the rows `≡ t·j + h`, mod `k`. Of the
 * patterns where no parallel's name meets a meridian's where the lines cross (a parallel's
 * name, in the middle of its column, reaches the meridians either side of it; a meridian's,
 * in the middle of its row, the parallels above and below), the one keeping every name
 * farthest from every other: a lattice spread over the cells rather than diagonal bands
 * (only those for `k` 4). Memoised.
 */
export function graticuleLabelPattern(k: number): {
  s: number;
  t: number;
  h: number;
} {
  const known = patterns.get(k);
  if (known) return known;
  const torus = (dy: number, dx: number) => {
    const y = Math.abs(mod(dy + k / 2, k) - k / 2);
    const x = Math.abs(mod(dx + k / 2, k) - k / 2);
    return y * y + x * x;
  };
  // With t = s⁻¹ both are the lattice (a, s·a), parallels' names offset by (0, ½) and
  // meridians' by (h + ½, 0) (rows, columns): one sweep of it finds each distance.
  let best = { s: 1, t: 1, h: 1 };
  let score = [-1, -1];
  for (let s = 1; s < k; s++) {
    let t = 0;
    for (let c = 1; c < k && !t; c++) if (mod(s * c, k) === 1) t = c;
    if (!t) continue;
    let same = Infinity;
    for (let a = 1; a < k; a++) same = Math.min(same, torus(a, s * a));
    for (let h = 0; h < k; h++) {
      let valid = true;
      for (let i = 0; i < k && valid; i++)
        for (const j of [s * i, s * i + 1]) {
          const row = mod(t * j + h, k);
          if (row === i || row === mod(i - 1, k)) valid = false;
        }
      if (!valid) continue;
      let across = Infinity;
      for (let a = 0; a < k; a++)
        across = Math.min(across, torus(h + 0.5 + a, s * a - 0.5));
      const now = [Math.min(same, across), same];
      if (now[0] > score[0] || (now[0] === score[0] && now[1] > score[1])) {
        score = now;
        best = { s, t, h };
      }
    }
  }
  patterns.set(k, best);
  return best;
}

const patterns = new Map<number, { s: number; t: number; h: number }>();

/** What {@link graticuleLabels} draws, and about where. */
export type GraticuleLabelOptions = {
  /** how many cells either way from the view's centre, at least. Default {@link GRATICULE_LABEL_REACH} */
  reach?: number;
  /** 0.1 to 1 ({@link graticuleLabelPeriod}). Default {@link GRATICULE_LABEL_DENSITY} */
  density?: number;
  /** the latitude the labels' size is judged at (see {@link graticuleLabelThinning}). Default 0 */
  reference?: number;
};

/**
 * Labels for latitude and longitude's lines every `step` degrees, on the sea's level of
 * `globe` (it needs a frame), around `centre`, lying flat on the Earth: every line named,
 * a parallel in the middle of a cell along it, reading east, a meridian in the middle of a
 * cell along it, reading north; each name once every `k` cells along its line
 * ({@link graticuleLabelPeriod}), spread over the cells by {@link graticuleLabelPattern} so
 * that no parallel's name meets a meridian's where the two lines cross, no two names line
 * up in bands, and every line is named wherever the view is. Toward the poles the
 * columns are `m` meridians wide ({@link graticuleLabelThinning}): the pattern stretched,
 * never squeezed, where the meridians close in; a row whose two parallels differ in `m`
 * names no meridians. Where they lie depends on the step, the density and the reference
 * alone, so they never slide as the view moves: they come and go.
 */
export function graticuleLabels(
  globe: Globe,
  step: number,
  centre: { latitude: number; longitude: number },
  {
    reach = GRATICULE_LABEL_REACH,
    density = GRATICULE_LABEL_DENSITY,
    reference = 0,
  }: GraticuleLabelOptions = {},
): Label[] {
  const labels: Label[] = [];
  if (!(step > 0)) return labels;
  const k = graticuleLabelPeriod(density);
  const { s, t, h } = graticuleLabelPattern(k);
  // At least a whole period either way, so every line in view is named.
  const span = Math.max(Math.round(reach), k);
  const around = Math.round(360 / step);
  // Meridian indices from −180° (inclusive) to 180°, so the pattern meets itself at the
  // date line wherever the view is.
  const wrapIndex = (j: number) =>
    j - around * Math.floor((j + around / 2) / around);
  // Once round the Earth at most.
  const most = Math.floor((around - 1) / 2);
  const i0 = Math.round(centre.latitude / step);
  const j0 = Math.round(centre.longitude / step);
  const thinning = (i: number) =>
    graticuleLabelThinning(step, Math.min(Math.abs(i * step), 90), reference);
  // Each labelled meridian about the view at `m`, by its index from −180° and its column.
  const columns = (m: number, visit: (j: number, column: number) => void) => {
    const cols = Math.min(span * m, most);
    for (
      let t = Math.ceil((j0 - cols) / m);
      t <= Math.floor((j0 + cols) / m);
      t++
    ) {
      const j = wrapIndex(t * m);
      if (mod(j, m) === 0) visit(j, j / m);
    }
  };
  // A step along a line, small enough to stay on it.
  const along = Math.min(step, 1) * 1e-3;
  const label = (
    text: string,
    latitude: number,
    longitude: number,
    north: boolean,
  ): Label => {
    const position = globe.geodetic(latitude, longitude, 0, at).toArray();
    const normal = globe.upAt(at, up).toArray();
    if (north) globe.geodetic(latitude + along, longitude, 0, toward);
    else globe.geodetic(latitude, longitude + along, 0, toward);
    const direction = toward.sub(at).toArray();
    return { text, position, normal, direction };
  };
  for (let i = i0 - span; i <= i0 + span; i++) {
    const latitude = i * step;
    // The parallel, named in the middle of its columns `≡ s·i`.
    if (Math.abs(latitude) < 90) {
      const m = thinning(i);
      const text = graticuleLabelText(latitude, step, 'lat');
      columns(m, (j, column) => {
        if (mod(column - s * i, k) === 0)
          labels.push(label(text, latitude, (j + m / 2) * step, false));
      });
    }
    // The meridians in the row above it, named in its middle where it is `≡ t·j + h`.
    const middle = latitude + step / 2;
    const m = thinning(i);
    if (Math.abs(middle) >= 90 || thinning(i + 1) !== m) continue;
    columns(m, (j, column) => {
      if (mod(i - t * column - h, k) === 0) {
        const longitude = wrap(j * step);
        labels.push(
          label(
            graticuleLabelText(longitude, step, 'lon'),
            middle,
            longitude,
            true,
          ),
        );
      }
    });
  }
  return labels;
}
