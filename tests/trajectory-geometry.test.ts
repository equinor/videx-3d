import { InstancedBufferGeometry, InterleavedBufferAttribute } from 'three';
import {
  createTrajectoryCapsGeometry,
  createTrajectoryGeometry,
} from '../src/components/Wellbores/Trajectory/trajectory-geometry';
import { TrajectorySegmentsType } from '../src/components/Wellbores/Trajectory/trajectory-defs';

// The interleaved stride the generator/geometry agree on:
// position(3) + tangent(3) + normal(3) + curvePosition(1).
const STRIDE = 10;

/**
 * Builds a synthetic section with `count` curve positions. Values are arbitrary — the
 * geometry only cares about the layout (stride, offsets, instance count).
 */
function makeSection(count: number): TrajectorySegmentsType {
  const attributesBuffer = new Float32Array(count * STRIDE);
  for (let i = 0; i < count; i++) {
    const o = i * STRIDE;
    attributesBuffer[o] = i; // position.x
    attributesBuffer[o + 3] = 1; // tangent.x
    attributesBuffer[o + 6] = 0; // normal.x
    attributesBuffer[o + 7] = 1; // normal.y
    attributesBuffer[o + 9] = i / (count - 1); // curvePosition (global 0..1)
  }
  return {
    attributesBuffer,
    segments: count,
    measuredLength: 1000,
    measuredTop: 100,
    boundingSphere: { center: [1, 2, 3], radius: 42 },
  };
}

function interleaved(
  geometry: InstancedBufferGeometry,
  name: string,
): InterleavedBufferAttribute {
  return geometry.getAttribute(name) as InterleavedBufferAttribute;
}

describe('trajectory-geometry', () => {
  describe('createTrajectoryGeometry (tube wall)', () => {
    const section = makeSection(3);
    const radialSegments = 8;
    const geometry = createTrajectoryGeometry(section, radialSegments);

    test('one instance per segment (positions - 1)', () => {
      expect(geometry.instanceCount).toBe(section.segments - 1);
    });

    test('per-ring vertex / index counts', () => {
      const radialPositions = radialSegments + 1;
      // two rings (endpoint A + B) of radialPositions vertices
      expect(geometry.getAttribute('vertex').count).toBe(radialPositions * 2);
      expect(geometry.getAttribute('vertex').itemSize).toBe(3);
      expect(geometry.getAttribute('capSign').count).toBe(radialPositions * 2);
      // two triangles per radial segment
      expect(geometry.getIndex()!.count).toBe(radialSegments * 6);
    });

    test('interleaved endpoint attributes read A at offset 0 and B one stride ahead', () => {
      const positionA = interleaved(geometry, 'positionA');
      const positionB = interleaved(geometry, 'positionB');
      const curvePositionA = interleaved(geometry, 'curvePositionA');
      const curvePositionB = interleaved(geometry, 'curvePositionB');

      expect(positionA.data.stride).toBe(STRIDE);
      expect(positionA.offset).toBe(0);
      expect(positionB.offset).toBe(STRIDE + 0);

      // curvePosition is a single float at offset 9 (was a redundant vec2)
      expect(curvePositionA.itemSize).toBe(1);
      expect(curvePositionA.offset).toBe(9);
      expect(curvePositionB.itemSize).toBe(1);
      expect(curvePositionB.offset).toBe(STRIDE + 9);
    });

    test('copies the section bounding sphere', () => {
      expect(geometry.boundingSphere!.center.toArray()).toEqual([1, 2, 3]);
      expect(geometry.boundingSphere!.radius).toBe(42);
    });
  });

  describe('createTrajectoryCapsGeometry (end caps)', () => {
    const section = makeSection(3);
    const radialSegments = 8;
    const geometry = createTrajectoryCapsGeometry(section, radialSegments);

    test('a single instance spans the whole tube', () => {
      expect(geometry.instanceCount).toBe(1);
    });

    test('per-cap vertex / index counts', () => {
      const radialPositions = radialSegments + 1;
      const perCap = radialPositions + 1; // 1 centre + rim ring
      expect(geometry.getAttribute('vertex').count).toBe(perCap * 2);
      // one triangle per radial segment, two caps
      expect(geometry.getIndex()!.count).toBe(radialSegments * 2 * 3);
    });

    test('endpoint B reads the LAST curve position (bOffset)', () => {
      const bOffset = (section.segments - 1) * STRIDE;
      const positionB = interleaved(geometry, 'positionB');
      const curvePositionB = interleaved(geometry, 'curvePositionB');
      expect(positionB.offset).toBe(bOffset + 0);
      expect(curvePositionB.itemSize).toBe(1);
      expect(curvePositionB.offset).toBe(bOffset + 9);
    });

    test('cap centres carry the flat-normal capSign (-1 start, +1 end)', () => {
      const capSign = geometry.getAttribute('capSign');
      const perCap = radialSegments + 1 + 1;
      const startCentre = 0;
      const endCentre = perCap;
      expect(capSign.getX(startCentre)).toBe(-1);
      expect(capSign.getX(endCentre)).toBe(1);
    });
  });
});
