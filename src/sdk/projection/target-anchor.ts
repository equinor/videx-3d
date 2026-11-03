import {
  Boundary,
  BoundaryCircle,
  boundaryContains,
  boundaryDisc,
} from '../geometries/boundary';
import type { Vec2, Vec3 } from '../types/common';
import { GeoFrame, geoFrameAt, geoFrameLonLat, geoFrameXZ } from './geo-frame';
import { EARTH_RADIUS } from './globe';

/**
 * A field a {@link TargetAnchorPicker} anchors to while the camera's target is over it: its
 * map (`frame`) and its stage's area (`boundary`, in its own X/Z), as its `UtmArea` has them.
 *
 * @group Utils
 */
export type TargetAnchorField = {
  /** the host's name for it */
  id: string;
  frame: GeoFrame;
  boundary: Boundary;
};

/**
 * Where a `World` is anchored: its `frame` and `boundary`, and the field they are (its `id`),
 * or null for a point anchor, a map about a point with no area of its own.
 *
 * @group Utils
 */
export type TargetAnchor = {
  frame: GeoFrame;
  boundary: Boundary | null;
  field: string | null;
};

/**
 * Options for {@link TargetAnchorPicker}.
 *
 * @group Utils
 */
export type TargetAnchorOptions = {
  /** the map a point anchor is drawn in, about its point. Default `geoFrameAt` */
  frameAt?: (longitude: number, latitude: number) => GeoFrame;
  /**
   * Over no field, how far the target goes from a point anchor's origin, in scene units, before
   * it is anchored again: this, or as far as the camera is from the target if that is more.
   * Default 10 000
   */
  minDistance?: number;
  /**
   * How far the target goes from the anchor's origin before it is anchored again, even if the
   * switch shows (see `pixels`). Default 200 000
   */
  maxDistance?: number;
  /**
   * The most, in screen pixels, the sea and the relief over a field's disc may move as the
   * anchor goes to or from it: they are flat over the anchored field's disc and curved
   * elsewhere, so a switch moves them by up to `r² / 2R` there. Default 1
   */
  pixels?: number;
  /**
   * How far past a field's boundary the target goes before the anchor leaves it, as a share of
   * the radius of its disc. Default 0.05
   */
  margin?: number;
};

/**
 * The view a {@link TargetAnchorPicker} judges from, in the scene's coordinates as they are now.
 *
 * @group Utils
 */
export type TargetAnchorView = {
  /** the camera controls' target */
  target: Vec3;
  /** the camera's position */
  camera: Vec3;
  /** the size of a screen pixel, in scene units, at a distance from the camera */
  pixelSize: (distance: number) => number;
};

type Field = TargetAnchorField & {
  disc: BoundaryCircle;
  /** longitude and latitude of its disc's middle */
  centre: Vec2;
  toXZ: (longitude: number, latitude: number) => Vec2;
};

/**
 * Chooses where a `World` is anchored as an orbiting camera's target goes about the Earth
 * (`useTargetAnchor` asks it each time the camera comes to rest): to the field the target is
 * over, its frame and boundary, so the field meets the sea and the relief exactly there and its
 * stage is the anchored one; over none, to a map about the target with no area of its own. The
 * scene's origin then stays near what is looked at, wherever that is.
 *
 * A switch is invisible but for the sea and the relief over the discs of the fields anchored
 * before and after (flat over the anchored one, curved elsewhere): so it waits until that shift
 * is under `pixels` from where the camera is. From one point anchor to another nothing shifts.
 *
 * @group Utils
 */
export class TargetAnchorPicker {
  private readonly fields: Field[];
  private readonly frameAt: (longitude: number, latitude: number) => GeoFrame;
  private readonly minDistance: number;
  private readonly maxDistance: number;
  private readonly pixels: number;
  private readonly margin: number;
  // The converters of the anchor's frame, made once for each.
  private frame: GeoFrame | null = null;
  private toLonLat: ((x: number, z: number) => Vec2) | null = null;
  private toXZ: ((longitude: number, latitude: number) => Vec2) | null = null;

  constructor(
    fields: readonly TargetAnchorField[],
    {
      frameAt = geoFrameAt,
      minDistance = 10000,
      maxDistance = 200000,
      pixels = 1,
      margin = 0.05,
    }: TargetAnchorOptions = {},
  ) {
    this.fields = fields.map(field => {
      const disc = boundaryDisc(field.boundary);
      const centre = geoFrameLonLat(field.frame)(...disc.centre);
      return { ...field, disc, centre, toXZ: geoFrameXZ(field.frame) };
    });
    this.frameAt = frameAt;
    this.minDistance = minDistance;
    this.maxDistance = maxDistance;
    this.pixels = pixels;
    this.margin = margin;
  }

  /** The field named `id`, as given; or undefined. */
  field(id: string): TargetAnchorField | undefined {
    return this.fields.find(field => field.id === id);
  }

  /** The anchor to switch to from `current` for `view`, or null to stay. */
  pick(current: TargetAnchor, view: TargetAnchorView): TargetAnchor | null {
    this.use(current.frame);
    const [tx, , tz] = view.target;
    const [longitude, latitude] = this.toLonLat!(tx, tz);
    const [ox, oz] = current.frame.offset ?? [0, 0];
    const fromOrigin = Math.hypot(tx - ox, tz - oz);
    const forced = fromOrigin > this.maxDistance;

    // Still over the field anchored, give or take the margin.
    const anchored = current.field
      ? this.fields.find(field => field.id === current.field)
      : undefined;
    if (
      anchored &&
      this.over(
        anchored,
        longitude,
        latitude,
        this.margin * anchored.disc.radius,
      )
    )
      return null;

    const under = this.fields.filter(field =>
      this.over(field, longitude, latitude, 0),
    );
    let next: TargetAnchor;
    if (under.length > 0) {
      // Over more than one: the one whose middle is nearest, for its size.
      const nearest = under.reduce((best, field) =>
        this.fromMiddle(field, longitude, latitude) <
        this.fromMiddle(best, longitude, latitude)
          ? field
          : best,
      );
      if (nearest.id === current.field) return null;
      next = {
        frame: nearest.frame,
        boundary: nearest.boundary,
        field: nearest.id,
      };
    } else {
      if (!current.field) {
        const [cx, cy, cz] = view.camera;
        const away = Math.hypot(cx - tx, cy - view.target[1], cz - tz);
        if (fromOrigin <= Math.max(this.minDistance, away)) return null;
      }
      next = {
        frame: this.frameAt(longitude, latitude),
        boundary: null,
        field: null,
      };
    }
    return forced || this.shift(current, next, view) <= this.pixels
      ? next
      : null;
  }

  /**
   * The most, in screen pixels, the sea and the relief move from `view` as the anchor goes from
   * `current` to `next`: over each one's disc, by `ρ² / 2R` at `ρ` from its middle.
   */
  shift(current: TargetAnchor, next: TargetAnchor, view: TargetAnchorView) {
    this.use(current.frame);
    let most = 0;
    if (current.boundary)
      most = Math.max(
        most,
        this.discShift(boundaryDisc(current.boundary), view),
      );
    const field = next.field
      ? this.fields.find(f => f.id === next.field)
      : undefined;
    if (field) {
      const centre = this.toXZ!(...field.centre);
      most = Math.max(
        most,
        this.discShift({ centre, radius: field.disc.radius }, view),
      );
    } else if (next.boundary) {
      // A boundary of the host's, in its own frame about its origin: its disc as it lies there.
      const disc = boundaryDisc(next.boundary);
      const [lon, lat] = geoFrameLonLat(next.frame)(...disc.centre);
      most = Math.max(
        most,
        this.discShift(
          { centre: this.toXZ!(lon, lat), radius: disc.radius },
          view,
        ),
      );
    }
    return most;
  }

  private use(frame: GeoFrame) {
    if (frame === this.frame) return;
    this.frame = frame;
    this.toLonLat = geoFrameLonLat(frame);
    this.toXZ = geoFrameXZ(frame);
  }

  // Whether the point lies in the field's boundary, or within `margin` of it (along X or Z).
  private over(
    field: Field,
    longitude: number,
    latitude: number,
    margin: number,
  ) {
    const [x, z] = field.toXZ(longitude, latitude);
    if (boundaryContains(field.boundary, x, z)) return true;
    if (margin <= 0) return false;
    return (
      boundaryContains(field.boundary, x + margin, z) ||
      boundaryContains(field.boundary, x - margin, z) ||
      boundaryContains(field.boundary, x, z + margin) ||
      boundaryContains(field.boundary, x, z - margin)
    );
  }

  // How far the point is from the middle of the field's disc, for its radius.
  private fromMiddle(field: Field, longitude: number, latitude: number) {
    const [x, z] = field.toXZ(longitude, latitude);
    const [cx, cz] = field.disc.centre;
    return Math.hypot(x - cx, z - cz) / Math.max(field.disc.radius, 1);
  }

  // The most a disc's sea moves at a switch, in pixels from the camera: sampled over the disc,
  // and at its point nearest the camera, where a close camera sees it largest.
  private discShift(
    { centre, radius }: BoundaryCircle,
    view: TargetAnchorView,
  ) {
    const [cx, cy, cz] = view.camera;
    const [mx, mz] = centre;
    let most = 0;
    const at = (x: number, z: number) => {
      const rho = Math.hypot(x - mx, z - mz);
      const drop = (rho * rho) / (2 * EARTH_RADIUS);
      const distance = Math.max(Math.hypot(cx - x, cy, cz - z), 1e-6);
      most = Math.max(most, drop / view.pixelSize(distance));
    };
    for (let ring = 1; ring <= 3; ring++) {
      const rho = (radius * ring) / 3;
      for (let k = 0; k < 16; k++) {
        const a = (k / 16) * 2 * Math.PI;
        at(mx + rho * Math.cos(a), mz + rho * Math.sin(a));
      }
    }
    const off = Math.hypot(cx - mx, cz - mz);
    const reach = Math.min(off, radius) / Math.max(off, 1e-9);
    at(mx + (cx - mx) * reach, mz + (cz - mz) * reach);
    return most;
  }
}
