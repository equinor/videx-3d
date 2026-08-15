import storyArgs from '../story-args.json';

/** One stratigraphic unit, as the demo dataset's own column describes it. */
export type StratUnit = {
  /** the unit's name, e.g. `Utsira Fm.` */
  unit: string;
  /** `group` | `formation` | `subzone` in the demo column */
  unitType: string;
  /** nesting depth: 1 = group, deeper numbers are finer subdivisions */
  level: number;
  /** the colour the column itself assigns the unit */
  color: string;
  /** the unit containing this one, e.g. a formation's group */
  parent: string | null;
};

/**
 * The units a surface bounds — **storybook only**.
 *
 * ⚠️ NOT a data dependency, and must not become one. Mapping a surface name to a
 * stratigraphic unit is the HOST APP's job (`documents/chunks.md` §9.3): the
 * library takes the caller's array order as the stratigraphic order and never
 * assigns a colour. The stories need real colours to demo with, and this is them.
 *
 * Generated, not written: `scripts/generate-story-args.js` matches each surface
 * name against the `top`/`base` horizons of the strat column named by the dataset
 * config. `below` is the unit the surface is the TOP of — the interval underneath
 * it — and `above` the unit it is the BASE of.
 */
export const STRAT_UNITS: Readonly<
  Record<string, { below: StratUnit | null; above: StratUnit | null }>
> = Object.freeze(
  storyArgs.stratUnits as Record<
    string,
    { below: StratUnit | null; above: StratUnit | null }
  >,
);

/** The unit directly BELOW a horizon — the one it is the top of. */
export function stratUnitBelow(name: string | undefined): StratUnit | null {
  return name ? (STRAT_UNITS[name]?.below ?? null) : null;
}

/** The unit directly ABOVE a horizon — the one it is the base of. */
export function stratUnitAbove(name: string | undefined): StratUnit | null {
  return name ? (STRAT_UNITS[name]?.above ?? null) : null;
}

/** Fallback for an interval the column has no unit for. */
export const UNKNOWN_UNIT_COLOR = '#8d8d8d';

/** Every unit's colour, by unit name. */
const UNIT_COLORS = storyArgs.stratUnitColors as Record<string, string>;

/**
 * Colours for a stack of surfaces, one per layer.
 *
 * ⭐ A colour belongs to the INTERVAL, not to the horizon: what you see looking
 * at layer `i` is the top of the unit between it and layer `i + 1`, and that unit
 * also fills the wall below it — which is why the same colour serves as both
 * `material` and `fill`.
 *
 * The unit is looked up as the one this surface is the TOP of; failing that, the
 * one the NEXT surface down is the BASE of (the same interval, named from its
 * other end); failing that, the PARENT of the unit this surface is the base of —
 * the rock under a formation's base still belongs to its group until the next
 * formation starts. Only then does it fall back to a neutral grey.
 *
 * @param names the surface names, shallowest first
 */
export function stratLayerColors(names: (string | undefined)[]): string[] {
  return names.map((name, i) => {
    const parent = stratUnitAbove(name)?.parent;
    return (
      stratUnitBelow(name)?.color ??
      stratUnitAbove(names[i + 1])?.color ??
      (parent ? UNIT_COLORS[parent] : undefined) ??
      UNKNOWN_UNIT_COLOR
    );
  });
}

/** The unit a layer shows, by the same rule as {@link stratLayerColors}. */
export function stratLayerUnit(
  names: (string | undefined)[],
  i: number,
): StratUnit | null {
  return stratUnitBelow(names[i]) ?? stratUnitAbove(names[i + 1]);
}

/** The name of the unit a layer shows, including the containing-group fallback. */
export function stratLayerUnitName(
  names: (string | undefined)[],
  i: number,
): string | null {
  return (
    stratLayerUnit(names, i)?.unit ?? stratUnitAbove(names[i])?.parent ?? null
  );
}
