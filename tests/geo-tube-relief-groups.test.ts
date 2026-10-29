import { describe, expect, it } from 'vitest';
import {
  GEO_TUBE_RELIEF_STRIDE as R,
  GeoTubeNodes,
} from '../src/components/Layers/geo-tubes';
import type { SceneryReliefDrawn } from '../src/components/Scenery/scenery-relief-hub';
import { geoTileKeyAt, geoTileRegion } from '../src/sdk/tiles/geo-tile-keys';
import { tileAncestors } from '../src/sdk/tiles/tile-cover';
import { tileChildren } from '../src/sdk/tiles/tile-keys';

// A relief drawing `keys`, each in the slot of its place plus 10, blending at 0.5.
let version = 0;
const relief = (keys: number[]): SceneryReliefDrawn => {
  const index = new Map(keys.map((key, i) => [key, i]));
  const tiles = new Float32Array(keys.length * 4);
  const froms = new Float32Array(keys.length * 4);
  keys.forEach((_, i) => {
    tiles[4 * i + 3] = 10 + i;
    froms.set([0.25, 0.5, 0.5, 3], 4 * i);
  });
  return {
    heights: null as never,
    cells: 32,
    index,
    ancestors: tileAncestors(keys),
    tiles,
    froms,
    blends: new Float32Array(keys.length).fill(0.5),
    lowest: 0,
    highest: 0,
    rangeAt: () => null,
    heightAt: () => null,
    resident: 0,
    keysVersion: ++version,
  };
};

// Nodes at these points.
const nodesAt = (points: [number, number][]) => {
  const nodes = new GeoTubeNodes(points.length);
  points.forEach(([lon, lat], i) => nodes.lonLat.set([lon, lat], 2 * i));
  nodes.count = points.length;
  return nodes;
};
const groupOf = (nodes: GeoTubeNodes, i: number) =>
  (nodes.relief.array as Float32Array)[i * R + 2];
const texel = (nodes: GeoTubeNodes, group: number) =>
  Array.from(nodes.groups.texture.image.data!.slice(8 * group, 8 * group + 8));

describe('GeoTubeReliefGroups', () => {
  const inside: [number, number] = [1.91, 58.43];
  const elsewhere: [number, number] = [5.3, 60.1];
  const tile = geoTileKeyAt(9, inside[0], inside[1]);

  it('places each node on the tile drawn under it, where it lies across it', () => {
    const nodes = nodesAt([inside, elsewhere]);
    nodes.groups.place(nodes, relief([tile]));
    const group = groupOf(nodes, 0);
    expect(group).toBe(0);
    expect(groupOf(nodes, 1)).toBe(-1);
    const [west, north, extent] = geoTileRegion(tile);
    const array = nodes.relief.array as Float32Array;
    expect(array[0]).toBeCloseTo((inside[0] - west) / extent, 5);
    expect(array[1]).toBeCloseTo((north - inside[1]) / extent, 5);
    // The group's tile as drawn: its slot and blend, the tile it blends from.
    expect(texel(nodes, group)).toEqual([10, 0.5, 0, 0, 0.25, 0.5, 0.5, 3]);
  });

  it('places them again once their tile splits, and finds the homeless once a tile is drawn over them', () => {
    const nodes = nodesAt([inside, elsewhere]);
    nodes.groups.place(nodes, relief([tile]));
    const there = geoTileKeyAt(7, elsewhere[0], elsewhere[1]);
    const children = tileChildren(tile);
    nodes.groups.update(nodes, relief([...children, there]));
    const child = geoTileKeyAt(10, inside[0], inside[1]);
    const g0 = groupOf(nodes, 0);
    const g1 = groupOf(nodes, 1);
    expect(g0).toBeGreaterThanOrEqual(0);
    expect(g1).toBeGreaterThanOrEqual(0);
    expect(g0).not.toBe(g1);
    // Each group's slot is its tile's (10 + its place among those drawn).
    expect(texel(nodes, g0)[0]).toBe(10 + children.indexOf(child));
    expect(texel(nodes, g1)[0]).toBe(10 + children.length);
    const [west] = geoTileRegion(child);
    const [, , extent] = geoTileRegion(child);
    expect((nodes.relief.array as Float32Array)[0]).toBeCloseTo(
      (inside[0] - west) / extent,
      5,
    );
  });

  it('keeps the groups while the same tiles are drawn, and lets go of the relief when it goes', () => {
    const nodes = nodesAt([inside]);
    const drawn = relief([tile]);
    nodes.groups.place(nodes, drawn);
    // Same tiles, a swap's blend moving on: the group follows.
    const next = { ...drawn, blends: new Float32Array([0.75]) };
    nodes.groups.update(nodes, next);
    expect(groupOf(nodes, 0)).toBe(0);
    expect(texel(nodes, 0)[1]).toBe(0.75);
    nodes.groups.update(nodes, null);
    expect(texel(nodes, 0)[0]).toBe(-1);
    expect(texel(nodes, 0)[7]).toBe(-1);
    // Back: on its tile again.
    nodes.groups.update(nodes, relief([tile]));
    expect(groupOf(nodes, 0)).toBe(0);
    expect(texel(nodes, 0)[0]).toBe(10);
  });
});
