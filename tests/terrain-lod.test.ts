import { describe, expect, it } from 'vitest';
import {
  createTerrainLod,
  selectTerrainNodes,
  terrainLodMorph,
} from '../src/sdk/geometries/terrain-lod';

type Node = { x: number; z: number; size: number; level: number };

function select(camera: [number, number, number], reach = 400000) {
  const lod = createTerrainLod(2000, 32, reach, -4000, 2500);
  const out = new Float32Array(4 * 4096);
  const count = selectTerrainNodes(camera, lod, out);
  const nodes: Node[] = [];
  for (let i = 0; i < count; i++) {
    nodes.push({
      x: out[4 * i],
      z: out[4 * i + 1],
      size: out[4 * i + 2],
      level: out[4 * i + 3],
    });
  }
  return { lod, nodes };
}

const holding = (nodes: Node[], x: number, z: number) =>
  nodes.filter(n => x >= n.x && x < n.x + n.size && z >= n.z && z < n.z + n.size);

describe('selectTerrainNodes', () => {
  for (const [name, camera] of [
    ['at sea level', [1234, 40, -5678]],
    ['45 km up', [-30000, 45000, 12000]],
  ] as const) {
    it(`covers the reach once, ${name}`, () => {
      const { nodes } = select([...camera]);
      for (let z = -380000; z <= 380000; z += 9973) {
        for (let x = -380000; x <= 380000; x += 9973) {
          const px = camera[0] + x;
          const pz = camera[2] + z;
          if (Math.hypot(x, z) > 380000) continue;
          expect(holding(nodes, px, pz)).toHaveLength(1);
        }
      }
    });

    it(`keeps neighbours within a level, ${name}`, () => {
      const { nodes } = select([...camera]);
      for (const node of nodes) {
        const step = node.size / 4;
        const probes: [number, number][] = [];
        for (let s = step / 2; s < node.size; s += step) {
          probes.push([node.x - 1, node.z + s], [node.x + node.size + 1, node.z + s]);
          probes.push([node.x + s, node.z - 1], [node.x + s, node.z + node.size + 1]);
        }
        for (const [x, z] of probes) {
          for (const other of holding(nodes, x, z)) {
            expect(Math.abs(other.level - node.level)).toBeLessThanOrEqual(1);
          }
        }
      }
    });
  }

  it('is finest about the camera and coarser away from it', () => {
    const { nodes } = select([0, 40, 0]);
    expect(holding(nodes, 10, 10)[0].size).toBe(64000);
    expect(holding(nodes, 390000, 0)[0].size).toBe(128000);
    expect(Math.max(...nodes.map(n => n.level))).toBe(2);
    expect(nodes.length).toBeLessThan(200);
  });

  it('ends each level\u2019s morph at its range', () => {
    const { lod } = select([0, 40, 0]);
    const morph = terrainLodMorph(lod);
    expect(morph[1]).toBeCloseTo(2.5 * 64000);
    expect(morph[3]).toBeCloseTo(2 * morph[1]);
    expect(morph[2]).toBeGreaterThan(morph[1]);
  });
});
