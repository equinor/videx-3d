import proj4 from 'proj4';
import { describe, expect, it } from 'vitest';
import {
  getProjectionDefFromUtmZone,
  wgs84Def,
} from '../src/sdk/projection/crs';
import {
  GeoFrame,
  geoFrameAt,
  geoFrameLonLat,
  geoFrameXZ,
} from '../src/sdk/projection/geo-frame';
import { EARTH_RADIUS } from '../src/sdk/projection/globe';
import {
  TargetAnchor,
  TargetAnchorField,
  TargetAnchorPicker,
  TargetAnchorView,
} from '../src/sdk/projection/target-anchor';
import type { Vec3 } from '../src/sdk/types/common';

// Three fields as the WorldFields story has them: Volve a circle 18 km across; Trench 123 km
// east, in the next zone, a box turned 30°; Overlap 10 km east and 4 km north of Volve.
const UTM31 = getProjectionDefFromUtmZone('31N');
const UTM32 = getProjectionDefFromUtmZone('32N');
const VOLVE_ORIGIN = proj4(wgs84Def, UTM31, [1.887, 58.441]) as [
  number,
  number,
];
const volvePoint = (east: number, north: number): [number, number] =>
  proj4(UTM31, wgs84Def, [VOLVE_ORIGIN[0] + east, VOLVE_ORIGIN[1] + north]) as [
    number,
    number,
  ];

const volve: TargetAnchorField = {
  id: 'volve',
  frame: { projection: UTM31, origin: VOLVE_ORIGIN },
  boundary: { centre: [0, 0], radius: 9000 },
};
const trench: TargetAnchorField = {
  id: 'trench',
  frame: {
    projection: UTM32,
    origin: proj4(wgs84Def, UTM32, volvePoint(123000, 7000)) as [
      number,
      number,
    ],
  },
  boundary: { box: [-13500, -6500, 13500, 6500], rotation: Math.PI / 6 },
};
const overlap: TargetAnchorField = {
  id: 'overlap',
  frame: geoFrameAt(...volvePoint(10000, 4000)),
  boundary: [
    [-8000, -8000],
    [8000, -8000],
    [8000, 0],
    [0, 0],
    [0, 8000],
    [-8000, 8000],
  ],
};
const FIELDS = [volve, trench, overlap];

const anchoredTo = (field: TargetAnchorField): TargetAnchor => ({
  frame: field.frame,
  boundary: field.boundary,
  field: field.id,
});
const pointAt = (longitude: number, latitude: number): TargetAnchor => ({
  frame: geoFrameAt(longitude, latitude),
  boundary: null,
  field: null,
});

// A 60° view 1000 pixels high.
const pixelSize = (distance: number) =>
  (2 * distance * Math.tan(Math.PI / 6)) / 1000;

// The view from `height` over a point given in Volve's map (`east`, `north`), in `frame`'s
// scene, the camera `back` metres south of the target.
function view(
  frame: GeoFrame,
  [east, north]: [number, number],
  height: number,
  back = 0,
): TargetAnchorView {
  const [x, z] = geoFrameXZ(frame)(...volvePoint(east, north));
  const target: Vec3 = [x, 0, z];
  return { target, camera: [x, height, z + back], pixelSize };
}

describe('TargetAnchorPicker', () => {
  const picker = new TargetAnchorPicker(FIELDS);

  it('stays with the field the target is over', () => {
    expect(
      picker.pick(anchoredTo(volve), view(volve.frame, [3000, 2000], 5000)),
    ).toBeNull();
  });

  it('goes to a point about the target over no field, once the field cannot be seen to move', () => {
    const next = picker.pick(
      anchoredTo(volve),
      view(volve.frame, [60000, -20000], 3000),
    );
    expect(next).not.toBeNull();
    expect(next!.field).toBeNull();
    expect(next!.boundary).toBeNull();
    // Its origin is the target.
    const [lon, lat] = geoFrameLonLat(next!.frame)(0, 0);
    const [lon0, lat0] = volvePoint(60000, -20000);
    expect(lon).toBeCloseTo(lon0, 6);
    expect(lat).toBeCloseTo(lat0, 6);
  });

  it('keeps the field a little past its edge, then lets it go', () => {
    // 300 m past Volve's west edge (within 5% of its 9 km): kept.
    expect(
      picker.pick(anchoredTo(volve), view(volve.frame, [-9300, 0], 40000)),
    ).toBeNull();
    // 600 m past it, seen from high up: let go.
    expect(
      picker.pick(anchoredTo(volve), view(volve.frame, [-9600, 0], 40000))
        ?.field,
    ).toBeNull();
  });

  it('waits while a camera close to the field’s edge would see its sea move', () => {
    // Low over the sea just past the edge: the sea there would drop by 6 m, a few hundred metres
    // off: several pixels.
    const low = view(volve.frame, [-9600, 0], 150, 300);
    expect(picker.shift(anchoredTo(volve), pointAt(0, 0), low)).toBeGreaterThan(
      1,
    );
    expect(picker.pick(anchoredTo(volve), low)).toBeNull();
    // The same target from 30 km up: under a pixel, so it goes.
    const high = view(volve.frame, [-9600, 0], 30000);
    expect(picker.shift(anchoredTo(volve), pointAt(0, 0), high)).toBeLessThan(
      1,
    );
    expect(picker.pick(anchoredTo(volve), high)).not.toBeNull();
  });

  it('anchors to the field the target comes over, as soon as it would not show', () => {
    const near = volvePoint(110000, 9000);
    const point = pointAt(...near);
    // Over Trench's middle (123 km east, 7 km north of Volve) from high up: anchored to it.
    expect(
      picker.pick(point, view(point.frame, [123000, 7000], 60000))?.field,
    ).toBe('trench');
    // Close over its edge: waits.
    const edge = view(point.frame, [123000 + 12000, 7000 + 6000], 200, 200);
    expect(picker.pick(point, edge)).toBeNull();
    // Unless the target is past `maxDistance` from the anchor's origin.
    const far = new TargetAnchorPicker(FIELDS, { maxDistance: 5000 });
    expect(far.pick(point, edge)?.field).toBe('trench');
  });

  it('over two fields, keeps the one anchored, else takes the one whose middle is nearer', () => {
    // 6 km east and 2 km north of Volve: inside its circle and inside Overlap's L.
    expect(
      picker.pick(anchoredTo(volve), view(volve.frame, [6000, 2000], 40000)),
    ).toBeNull();
    const point = pointAt(...volvePoint(30000, 0));
    expect(
      picker.pick(point, view(point.frame, [6000, 2000], 40000))?.field,
    ).toBe('overlap');
    expect(
      picker.pick(point, view(point.frame, [500, -500], 40000))?.field,
    ).toBe('volve');
  });

  it('moves a point anchor along once the target is farther than the camera, and 10 km', () => {
    const at = volvePoint(40000, -30000);
    const point = pointAt(...at);
    // 5 km off, the camera 3 km off: stays.
    expect(
      picker.pick(point, view(point.frame, [45000, -30000], 3000)),
    ).toBeNull();
    // 15 km off: anchored there.
    expect(
      picker.pick(point, view(point.frame, [55000, -30000], 3000))?.field,
    ).toBeNull();
    expect(
      picker.pick(point, view(point.frame, [55000, -30000], 3000)),
    ).not.toBeNull();
    // 15 km off, the camera 40 km off: stays, as near as it is.
    expect(
      picker.pick(point, view(point.frame, [55000, -30000], 40000)),
    ).toBeNull();
  });

  it('measures the shift as the drop over the disc from the camera, in pixels', () => {
    // Straight over Volve's middle at 1 km: the edge drops r² / 2R, √(r² + h²) away.
    const above = view(volve.frame, [0, 0], 1000);
    const r = 9000;
    const expected =
      (r * r) / (2 * EARTH_RADIUS) / pixelSize(Math.hypot(r, 1000));
    expect(picker.shift(anchoredTo(volve), pointAt(0, 0), above)).toBeCloseTo(
      expected,
      6,
    );
  });
});
