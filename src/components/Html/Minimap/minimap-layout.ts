import type { Corner } from '../../../common/corner-style';

/**
 * Where on a minimap an item can sit: a corner, or the middle of an edge.
 *
 * @group Components
 */
export type MinimapAnchor =
  | Corner
  | 'top-center'
  | 'bottom-center'
  | 'left-center'
  | 'right-center';

/** The parts of a {@link Minimap} that can be placed. */
export type MinimapItem =
  | 'compass'
  | 'altitude'
  | 'altitudeControl'
  | 'controls'
  | 'extent'
  | 'distance';

/**
 * Where one of a minimap's items goes and how it flows.
 *
 * @group Components
 */
export type MinimapItemLayout = {
  /** where it sits. Items at one anchor stack, the first by `order` nearest the edge */
  anchor?: MinimapAnchor;
  /** how the buttons lay themselves out: in a row or a column. Default `'column'` */
  direction?: 'row' | 'column';
  /** among the items of its anchor: lower is nearer the edge. Default as the defaults go */
  order?: number;
};

/**
 * Where a {@link Minimap}'s items go: each of `compass`, `altitude` (the readout),
 * `altitudeControl`, `controls`, `extent` (the ground across the map) and `distance` (the
 * bar), overriding the defaults — the compass top left, the altitude readout top centre, the
 * altitude control on the left edge, the buttons top right, the extent bottom left, the
 * distance bottom right.
 *
 * @group Components
 */
export type MinimapLayout = Partial<Record<MinimapItem, MinimapItemLayout>>;

/** Where each item goes unless the layout says. */
export const MINIMAP_DEFAULT_LAYOUT: Record<
  MinimapItem,
  Required<MinimapItemLayout>
> = {
  compass: { anchor: 'top-left', direction: 'column', order: 0 },
  altitude: { anchor: 'top-center', direction: 'column', order: 0 },
  altitudeControl: { anchor: 'left-center', direction: 'column', order: 0 },
  controls: { anchor: 'top-right', direction: 'column', order: 0 },
  extent: { anchor: 'bottom-left', direction: 'column', order: 0 },
  distance: { anchor: 'bottom-right', direction: 'column', order: 0 },
};

/**
 * How a minimap's altitude control works: a slim vertical control fixed on the map, whose
 * knob is pulled up or down and springs back to the middle when let go. The knob sets the
 * climb speed directly, in metres a second, the same at any height: nothing within a small
 * dead zone, then growing with the square of how far it is from the middle, to `maxSpeed` at
 * the end of its travel. Held at the end it then accelerates.
 */
export type MinimapAltitudeControlOptions = {
  /** the lowest height it moves to, in metres from the sea (negative below it). Default -5000 */
  min?: number;
  /** the highest. Default 50000 */
  max?: number;
  /** metres a second with the knob at the end of its travel, before it accelerates. Default 100 */
  maxSpeed?: number;
  /**
   * how many times `maxSpeed` it can accelerate to, held at the end of the travel: it doubles
   * every `boostTime` seconds up to this. Pulling the knob back from the end goes back to the
   * direct speed at once. `1` for no acceleration. Default 200
   */
  boost?: number;
  /** seconds the speed takes to double, held at the end of the travel. Default 1 */
  boostTime?: number;
  /** pixels the knob travels each way from the middle, at most. A short map shortens it. Default 100 */
  dragRange?: number;
  /** the control's colour. Default white */
  color?: string;
};

/** {@link MinimapAltitudeControlOptions} with the defaults in. */
export type ResolvedMinimapAltitudeControl =
  Required<MinimapAltitudeControlOptions>;

/** The altitude control's options over their defaults. */
export function resolveMinimapAltitudeControl(
  options: MinimapAltitudeControlOptions = {},
): ResolvedMinimapAltitudeControl {
  const min = options.min ?? -5000;
  return {
    min,
    max: Math.max(options.max ?? 50000, min + 1),
    maxSpeed: Math.max(options.maxSpeed ?? 100, 0),
    boost: Math.max(options.boost ?? 200, 1),
    boostTime: Math.max(options.boostTime ?? 1, 0.05),
    dragRange: Math.max(options.dragRange ?? 100, 10),
    color: options.color ?? '#ffffff',
  };
}

// The pixels of a map's height an altitude control leaves free: for its knob, and room at the ends.
const ALTITUDE_CONTROL_MARGIN = 70;

/**
 * How far an altitude control's knob can travel each way on a map `mapHeight` pixels tall: its
 * `dragRange`, or less where the map is too short to hold it with room for the knob and the
 * map's other items at its ends.
 *
 * @group Components
 */
export function altitudeControlTravel(
  dragRange: number,
  mapHeight: number,
): number {
  return Math.max(
    Math.min(dragRange, (mapHeight - ALTITUDE_CONTROL_MARGIN) / 2),
    12,
  );
}

/**
 * The items of `shown` grouped by the anchor they sit at, each anchor's in the order they
 * stack (nearest the edge first): `layout` over {@link MINIMAP_DEFAULT_LAYOUT}. Items of one
 * order keep the default order of the items.
 *
 * @group Components
 */
export function resolveMinimapLayout(
  shown: readonly MinimapItem[],
  layout: MinimapLayout = {},
): Map<MinimapAnchor, { item: MinimapItem; direction: 'row' | 'column' }[]> {
  const groups = new Map<
    MinimapAnchor,
    { item: MinimapItem; direction: 'row' | 'column'; order: number }[]
  >();
  for (const item of shown) {
    const place = { ...MINIMAP_DEFAULT_LAYOUT[item], ...layout[item] };
    const group = groups.get(place.anchor) ?? [];
    group.push({ item, direction: place.direction, order: place.order });
    groups.set(place.anchor, group);
  }
  // Array.prototype.sort is stable: equal orders stay in the order the items were given.
  return new Map(
    [...groups].map(([anchor, group]) => [
      anchor,
      group
        .sort((a, b) => a.order - b.order)
        .map(({ item, direction }) => ({ item, direction })),
    ]),
  );
}
