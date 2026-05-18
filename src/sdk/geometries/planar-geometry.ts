import { Path, Shape, Vector2 } from 'three';
import { Vec2 } from '../types/common';
import { clamp } from '../utils/numbers';

export type PlanarGeometryType = 'point2d' | 'line2d' | 'polygon2d';

export type Coordinates2D = Vec2[];

export type PlanarPointCoordinates = Coordinates2D;
export type PlanarLineCoordinates = Coordinates2D[];
export type PlanarPolygonCoordinates = Coordinates2D[][];

export type PlanarGeometryCoordinates =
  | PlanarPointCoordinates
  | PlanarLineCoordinates
  | PlanarPolygonCoordinates;

export type CoordinatesTransformFunction = (coord: Vec2) => Vec2;

/**
 * A simple abstraction for defining 2D points, lines or polygons,
 * primarily for making it easier to work with GeoJson in videx-3d.
 */
export abstract class PlanarGeometry {
  type: PlanarGeometryType;
  coordinates: PlanarGeometryCoordinates;
  private _min: Vec2 | null = null;
  private _max: Vec2 | null = null;
  private _size: Vec2 | null = null;
  protected _offset: Vec2 = [0, 0];

  constructor(
    type: PlanarGeometryType,
    coordinates: PlanarGeometryCoordinates,
    offset?: Vec2,
  ) {
    this.type = type;
    this.coordinates = coordinates;
    if (offset) {
      this._offset[0] = offset[0];
      this._offset[1] = offset[1];
    }
  }

  static fromPointCoordinates(
    coordinates: PlanarPointCoordinates,
    transform?: CoordinatesTransformFunction,
  ) {
    const transformedCoordinates = transform
      ? coordinates.map(transform)
      : coordinates;
    return new PlanarPointGeometry(transformedCoordinates);
  }

  static fromLineCoordinates(
    coordinates: PlanarLineCoordinates,
    transform?: CoordinatesTransformFunction,
  ) {
    const transformedCoordinates = transform
      ? coordinates.map(l => l.map(transform))
      : coordinates;
    return new PlanarLineGeometry(transformedCoordinates);
  }

  static fromPolygonCoordinates(
    coordinates: PlanarPolygonCoordinates,
    transform?: CoordinatesTransformFunction,
  ) {
    const transformedCoordinates = transform
      ? coordinates.map(p => p.map(r => r.map(transform)))
      : coordinates;
    return new PlanarPolygonGeometry(transformedCoordinates);
  }

  abstract forEachCoordinate(callback: (pos: Vec2) => void): void;

  private _calculateBounds() {
    const min: Vec2 = [Infinity, Infinity];
    const max: Vec2 = [-Infinity, -Infinity];

    const compareBounds = (pos: Vec2) => {
      if (pos[0] < min[0]) {
        min[0] = pos[0];
      }
      if (pos[0] > max[0]) {
        max[0] = pos[0];
      }
      if (pos[1] < min[1]) {
        min[1] = pos[1];
      }
      if (pos[1] > max[1]) {
        max[1] = pos[1];
      }
    };

    this.forEachCoordinate(compareBounds);

    this._min = min;
    this._max = max;
    this._size = [max[0] - min[0], max[1] - min[1]];
  }

  get min(): Vec2 {
    if (!this._min) {
      this._calculateBounds();
    }
    return [...this._min!];
  }

  get max(): Vec2 {
    if (!this._max) {
      this._calculateBounds();
    }
    return [...this._max!];
  }

  get center() {
    if (!this._min || !this._max || !this._size) {
      this._calculateBounds();
    }

    const center: Vec2 = [
      this.min[0] + this.size[0] / 2,
      this.min[1] + this.size[1] / 2,
    ];

    return center;
  }

  get size(): Vec2 {
    if (!this._size) {
      this._calculateBounds();
    }
    return [...this._size!];
  }

  get offset(): Vec2 {
    return [...this._offset];
  }

  setOffset(offset: Vec2) {
    this.forEachCoordinate(pos => {
      pos[0] -= offset[0];
      pos[1] -= offset[1];
    });

    if (this._min) {
      this._min[0] -= offset[0];
      this._min[1] -= offset[1];
    }
    if (this._max) {
      this._max[0] -= offset[0];
      this._max[1] -= offset[1];
    }

    this._offset[0] += offset[0];
    this._offset[1] += offset[1];
  }

  removeOffset() {
    if (this._offset[0] !== 0 || this._offset[1] !== 0) {
      this.forEachCoordinate(pos => {
        pos[0] += this._offset[0];
        pos[1] += this._offset[1];
      });

      this._min = null;
      this._max = null;
      this._size = null;
      this._offset = [0, 0];
    }
  }

  centralize() {
    this.setOffset(this.center);
  }

  normalize(scale: Vec2 = [1, 1], offset: Vec2 = [0, 0]) {
    this.centralize();
    const bounds = this.getBounds();

    this.forEachCoordinate(pos => {
      pos[0] =
        clamp((pos[0] - bounds.min[0]) / bounds.size[0]) * scale[0] + offset[0];
      pos[1] =
        clamp((pos[1] - bounds.min[1]) / bounds.size[1]) * scale[1] + offset[1];
    });
  }

  transform(transformFunc: CoordinatesTransformFunction) {
    if (this._offset[0] !== 0 || this._offset[1] !== 0) {
      this.removeOffset();
    }

    this.forEachCoordinate(pos => {
      const transformed = transformFunc(pos);
      pos[0] = transformed[0];
      pos[1] = transformed[1];
    });

    this._min = null;
    this._max = null;
    this._size = null;
  }

  abstract clone(): PlanarGeometry;

  toObject() {
    return {
      type: this.type.toString(),
      coordinates: structuredClone(this.coordinates),
      offset: this.offset,
    };
  }

  abstract getPoints(): Vector2[][];

  getPointsFlattened() {
    const points: Vector2[] = [];
    this.forEachCoordinate(p => {
      points.push(new Vector2(p[0], p[1]));
    });
    return points;
  }

  getBounds() {
    return {
      min: this.min,
      max: this.max,
      size: this.size,
    };
  }
}

export class PlanarPointGeometry extends PlanarGeometry {
  constructor(coordinates: PlanarPointCoordinates, offset?: Vec2) {
    super('point2d', coordinates, offset);
  }

  forEachCoordinate(callback: (pos: Vec2) => void): void {
    const pointCoords = this.coordinates as PlanarPointCoordinates;
    pointCoords.forEach(i => callback(i));
  }

  getPoints() {
    const pointCoordinates = this.coordinates as PlanarPointCoordinates;
    return pointCoordinates.map(d => [new Vector2(d[0], d[1])]);
  }

  clone() {
    const clone = new PlanarPointGeometry(
      structuredClone(this.coordinates) as PlanarPointCoordinates,
      this.offset,
    );

    return clone;
  }
}

export class PlanarLineGeometry extends PlanarGeometry {
  constructor(coordinates: PlanarLineCoordinates, offset?: Vec2) {
    super('line2d', coordinates, offset);
  }

  forEachCoordinate(callback: (pos: Vec2) => void): void {
    const lineCoords = this.coordinates as PlanarLineCoordinates;
    lineCoords.forEach(i => i.forEach(j => callback(j)));
  }

  getPoints() {
    const lineCoordinates = this.coordinates as PlanarLineCoordinates;
    return lineCoordinates.map(line => line.map(d => new Vector2(d[0], d[1])));
  }

  clone() {
    const clone = new PlanarLineGeometry(
      structuredClone(this.coordinates) as PlanarLineCoordinates,
      this.offset,
    );
    return clone;
  }
}

export class PlanarPolygonGeometry extends PlanarGeometry {
  constructor(coordinates: PlanarPolygonCoordinates, offset?: Vec2) {
    super('polygon2d', coordinates, offset);
  }

  forEachCoordinate(callback: (pos: Vec2) => void): void {
    const polygonCoords = this.coordinates as PlanarPolygonCoordinates;
    polygonCoords.forEach(i => i.forEach(j => j.forEach(k => callback(k))));
  }

  getPoints() {
    const polygonCoordinates = this.coordinates as PlanarPolygonCoordinates;
    return polygonCoordinates.map(polygon =>
      polygon.reduce<Vector2[]>(
        (acc, ring) => acc.concat(ring.map(d => new Vector2(d[0], d[1]))),
        [],
      ),
    );
  }

  clone() {
    const clone = new PlanarPolygonGeometry(
      structuredClone(this.coordinates) as PlanarPolygonCoordinates,
      this._offset,
    );
    return clone;
  }

  toShapes(): Shape[] {
    const shapes: Shape[] = [];

    const addToPath = (path: Path, coords: Coordinates2D) => {
      path.moveTo(coords[0][0], coords[0][1]);
      for (let i = 1; i < coords.length; i++) {
        path.lineTo(coords[i][0], coords[i][1]);
      }
      path.closePath();
    };

    const polygonCoordinates = this.coordinates as PlanarPolygonCoordinates;

    polygonCoordinates.forEach(p => {
      const shape = new Shape();
      const polygon = p[0];
      addToPath(shape, polygon);

      // holes
      for (let i = 1; i < p.length; i++) {
        const path = new Path();
        addToPath(path, p[i]);
        shape.holes.push(path);
      }

      shapes.push(shape);
    });

    return shapes;
  }
}
