import { Vec2 } from '../../sdk';
import storyArgs from '../story-args.json';

/**
 * A made-up subsea site, given the way real ones are: as UTM coordinates on a
 * map, with no idea what the sea bed does there.
 *
 * ⭐ That is the point of the exercise — where it ends up vertically, and how much
 * of a base it needs to sit level, comes from SAMPLING the drawn sea bed.
 */
export type SubseaSite = {
  name: string;
  /** UTM easting / northing (zone from `story-args.json`) */
  easting: number;
  northing: number;
  /** orientation of the structure, degrees clockwise from north */
  heading: number;
  /** number of wells in the template, purely cosmetic */
  slots: number;
};

const ORIGIN = storyArgs.origin as Vec2;

/**
 * Sites are written as metres east / north of the field origin and converted
 * here, so they read as a map does while still being UTM in the data. ⚠️ Northing
 * grows toward the top of a map, which is scene −Z.
 */
const site = (
  name: string,
  east: number,
  north: number,
  heading: number,
  slots: number,
): SubseaSite => ({
  name,
  easting: ORIGIN[0] + east,
  northing: ORIGIN[1] + north,
  heading,
  slots,
});

/**
 * Four sites spread across the basin of the generated field, chosen to be
 * awkward in different ways: two out in the deep, one on the flank where the bed
 * starts to climb toward the island, one close in where it is steepest.
 */
export const SUBSEA_SITES: SubseaSite[] = [
  site('Alpha', 1900, -1500, 20, 6),
  site('Bravo', 900, -2500, -35, 4),
  site('Charlie', 2650, -350, 65, 4),
  site('Delta', 2500, -2400, 0, 8),
];

/** A bend in a route, in the same metres-from-origin frame as the sites. */
const waypoint = (east: number, north: number): Vec2 => [
  ORIGIN[0] + east,
  ORIGIN[1] + north,
];

/**
 * A made-up flowline route, given the way one is planned: a list of UTM positions
 * across a map. A node is either a SITE (by name, so a tie-in cannot drift from
 * the structure it ties into) or a bend.
 */
export type PipelineRoute = {
  name: string;
  /** outer diameter as built, in metres */
  diameter: number;
  nodes: (string | Vec2)[];
  color?: string;
};

/**
 * Three flowlines gathering to Alpha and one export line leaving the field.
 * ⚠️ Diameters are the real thing — 12¾", 16" and 30" — which at 7 km across is
 * well under a pixel. The story exaggerates them for viewing.
 */
export const SUBSEA_ROUTES: PipelineRoute[] = [
  {
    name: 'Bravo-Alpha',
    diameter: 0.324,
    nodes: ['Bravo', waypoint(1300, -2050), 'Alpha'],
  },
  {
    name: 'Charlie-Alpha',
    diameter: 0.324,
    // Over the flank below the island, which is the steepest ground out here.
    nodes: ['Charlie', waypoint(2350, -800), 'Alpha'],
  },
  {
    name: 'Delta-Alpha',
    diameter: 0.406,
    nodes: ['Delta', waypoint(2250, -1900), 'Alpha'],
  },
  {
    name: 'Export',
    diameter: 0.762,
    color: '#4a4f57',
    nodes: [
      'Alpha',
      waypoint(1500, -2600),
      waypoint(900, -3300),
      waypoint(200, -3400),
    ],
  },
];

/** The site of that name, for a route that ties into it. */
export function siteByName(name: string): SubseaSite | undefined {
  return SUBSEA_SITES.find(s => s.name === name);
}
