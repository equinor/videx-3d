import { Vector3 } from 'three';
import type { Label } from '../Labels/types';
import type { Globe } from '../../sdk/projection/globe';

/** How many lines either way from where the view is centred a graticule labels, by default. */
export const GRATICULE_LABEL_REACH = 10;

/** Which of a graticule's lines are labelled, by default: every second. */
export const GRATICULE_LABEL_EVERY = 2;

/** A graticule label's font size, by default, as a fraction of its cell's narrower side. */
export const GRATICULE_LABEL_SIZE = 0.1;

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

/**
 * Labels for latitude and longitude's lines every `step` degrees, on the sea's level of
 * `globe` (it needs a frame): those `reach` lines either way from the line nearest
 * `centre` that are labelled — every `every`th, counted from 0° — each parallel at every
 * labelled meridian, half a step east of it, reading east, each meridian at every labelled
 * parallel, half a step north, reading north, lying flat on the Earth. Where they lie
 * depends on the step alone, so they never slide as the view moves: they come and go.
 */
export function graticuleLabels(
  globe: Globe,
  step: number,
  centre: { latitude: number; longitude: number },
  reach = GRATICULE_LABEL_REACH,
  every = GRATICULE_LABEL_EVERY,
): Label[] {
  const labels: Label[] = [];
  if (!(step > 0)) return labels;
  const n = Math.max(Math.round(every), 1);
  const i0 = Math.round(centre.latitude / step);
  const j0 = Math.round(centre.longitude / step);
  // A line's index among all lines: labelled where it is a multiple of `n`.
  const labelled = (index: number) => ((index % n) + n) % n === 0;
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
  // Not past the poles; and once round the Earth at most.
  const lonSteps = Math.min(reach, Math.floor(180 / step - 1e-9));
  for (let i = i0 - reach; i <= i0 + reach; i++) {
    if (!labelled(i)) continue;
    const latitude = i * step;
    if (Math.abs(latitude) >= 90) continue;
    for (let j = j0 - lonSteps; j <= j0 + lonSteps; j++) {
      if (!labelled(j)) continue;
      const longitude = wrap(j * step);
      // Half a step past the crossing along each line: clear of the lines across it, the
      // labelled ones and those between.
      labels.push(
        label(
          graticuleLabelText(latitude, step, 'lat'),
          latitude,
          longitude + step / 2,
          false,
        ),
      );
      const middle = latitude + step / 2;
      if (Math.abs(middle) < 90)
        labels.push(
          label(
            graticuleLabelText(longitude, step, 'lon'),
            middle,
            longitude,
            true,
          ),
        );
    }
  }
  return labels;
}
