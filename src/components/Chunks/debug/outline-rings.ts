import {
  PlanarPolygonCoordinates,
  PlanarPolygonGeometry,
  Vec2,
} from '../../../sdk';

/** Every ring of an outline in absolute scene XZ. */
export function debugOutlineRings(
  outline: PlanarPolygonGeometry | null,
): Vec2[][] {
  if (!outline) return [];
  const [ox, oz] = outline.offset;
  const rings: Vec2[][] = [];
  for (const polygon of outline.coordinates as PlanarPolygonCoordinates) {
    for (const ring of polygon) {
      rings.push(ring.map(p => [p[0] + ox, p[1] + oz] as Vec2));
    }
  }
  return rings;
}
