import { Shape } from 'three';
import {
  PlanarGeometry,
  PlanarLineGeometry,
  PlanarPointGeometry,
  PlanarPolygonGeometry,
} from '../src/sdk/geometries/planar-geometry';

describe('planar-geometry', () => {
  test('should be able create planar point geometry', () => {
    const geometry = new PlanarPointGeometry([
      [1, 4],
      [2, 2],
    ]);

    expect(geometry.coordinates).toBeDefined();
    expect(geometry.type).toBe('point2d');
    expect(geometry.min).toEqual([1, 2]);
    expect(geometry.max).toEqual([2, 4]);
    expect(geometry.size).toEqual([1, 2]);
    expect(geometry.offset).toEqual([0, 0]);

    geometry.centralize();

    expect(geometry.offset).toEqual([1.5, 3]);
    expect(geometry.coordinates).toEqual([
      [-0.5, 1],
      [0.5, -1],
    ]);

    geometry.transform(p => [p[0] * 2, p[1] * 2]);

    expect(geometry.offset).toEqual([0, 0]);
    expect(geometry.coordinates).toEqual([
      [2, 8],
      [4, 4],
    ]);
    expect(geometry.min).toEqual([2, 4]);
    expect(geometry.max).toEqual([4, 8]);
    expect(geometry.size).toEqual([2, 4]);
  });

  test('should be able create planar line geometry', () => {
    const geometry = new PlanarLineGeometry([
      [
        [0, 0],
        [1, 4],
        [2, 2],
      ],
    ]);

    expect(geometry.coordinates).toBeDefined();
    expect(geometry.type).toBe('line2d');
    expect(geometry.min).toEqual([0, 0]);
    expect(geometry.max).toEqual([2, 4]);
    expect(geometry.size).toEqual([2, 4]);
    expect(geometry.offset).toEqual([0, 0]);

    geometry.centralize();

    expect(geometry.offset).toEqual([1, 2]);
    expect(geometry.coordinates).toEqual([
      [
        [-1, -2],
        [0, 2],
        [1, 0],
      ],
    ]);
  });

  test('should be able create planar polygon geometry', () => {
    const geometry = new PlanarPolygonGeometry([
      [
        [
          [0, 0],
          [1, 4],
          [2, 2],
        ],
      ],
    ]);

    expect(geometry.coordinates).toBeDefined();
    expect(geometry.type).toBe('polygon2d');
    expect(geometry.offset).toEqual([0, 0]);
    expect(geometry.min).toEqual([0, 0]);
    expect(geometry.max).toEqual([2, 4]);
    expect(geometry.size).toEqual([2, 4]);
    expect(geometry.getBounds()).toEqual({
      min: [0, 0],
      max: [2, 4],
      size: [2, 4],
    });
    geometry.centralize();

    expect(geometry.offset).toEqual([1, 2]);
    expect(geometry.coordinates).toEqual([
      [
        [
          [-1, -2],
          [0, 2],
          [1, 0],
        ],
      ],
    ]);

    const asObject = geometry.toObject();
    expect(geometry.type).toBe(asObject.type);
    expect(geometry.coordinates).not.toBe(asObject.coordinates);
    expect(geometry.coordinates).toEqual(asObject.coordinates);

    const clone = geometry.clone();
    expect(clone).toBeInstanceOf(PlanarPolygonGeometry);
    expect(clone).toBeInstanceOf(PlanarGeometry);
    expect(clone.coordinates).not.toBe(geometry.coordinates);

    const shapes = geometry.toShapes();
    expect(shapes.length).toBe(1);
    expect(shapes[0]).toBeInstanceOf(Shape);
    expect(shapes[0].holes.length).toBe(0);

    const geometryWithHole = new PlanarPolygonGeometry([
      [
        [
          [-2, 2],
          [2, 2],
          [2, -2],
          [-2, -2],
          [-2, 2],
        ],
        [
          [-1, -1],
          [0, 1],
          [1, -1],
          [-1, -1],
        ],
      ],
    ]);

    expect(geometryWithHole.coordinates.length).toBe(1);
    expect(geometryWithHole.coordinates[0].length).toBe(2);

    const shapesWithHole = geometryWithHole.toShapes();
    expect(shapesWithHole.length).toBe(1);
    expect(shapesWithHole[0].holes.length).toBe(1);
  });
});
