/**
 * This script generates a json file with config and lookup values from the data
 * currently put in the public folder. It assumes specific file names to be present,
 * and containing data of a specific shape.
 *
 * We do this as a workaround as Storybook does not support async args or argstypes.
 */

import fs from 'node:fs';

function readJson(path, fallback = null) {
  try {
    return JSON.parse(fs.readFileSync(path));
  } catch {
    return fallback;
  }
}

export function createStoryArgs() {
  const config = JSON.parse(fs.readFileSync('public/data/config.json'));
  const wellboreHeadersData = JSON.parse(
    fs.readFileSync('public/data/wellbore-headers.json'),
  );
  const surfaceMetaData = JSON.parse(
    fs.readFileSync('public/data/surface-meta.json'),
  );

  const stratColumns = readJson('public/data/strat-columns.json', {});
  const mapping = readJson('public/data/mapping.json', {});

  const wellboreOptions = Object.values(wellboreHeadersData)
    .filter(d => d.drilled)
    .sort((a, b) => a.name.localeCompare(b.name))
    .reduce(
      (prev, wellbore) => ({
        ...prev,
        [wellbore.id]: wellbore.name,
      }),
      {},
    );

  const surfaceOptions = Object.values(surfaceMetaData)
    .sort((a, b) => a.max - b.max)
    .reduce(
      (prev, surface) => ({
        ...prev,
        [surface.id]: surface.name,
      }),
      {},
    );

  // const stratUnitTypes = new Set()
  // const stratUnits = new Set()

  // Object.values(stratColumns).forEach(stratColumn => {
  //   stratColumn.units.forEach(unit => {
  //     stratUnitTypes.add(unit.unitType)
  //     stratUnits.add(unit.name)
  //   })
  // })

  // Horizon name -> age (Ma) for the field's own strat column. A unit contributes
  // both of its bounding horizons; the shallower unit's base and the deeper one's
  // top are the same horizon and agree on the age.
  const column = stratColumns[config.stratColumn];
  const horizonAges = new Map();
  // Horizon name -> the unit it is the TOP of. That unit is the interval BELOW the
  // horizon, which is what a chunk layer's cap and fill both show, so this is the
  // map a colour comes from. ⭐ Deepest level wins: a formation says more about
  // what you are looking at than the group containing it.
  const unitByTop = new Map();
  // ...and the unit each horizon is the BASE of, for the last layer of a stack,
  // which has no interval below it to take a colour from.
  const unitByBase = new Map();
  // Unit name -> its colour, so an interval BETWEEN two named units can fall back
  // to the one containing them (the rock under a formation's base is still its
  // group's until the next formation starts).
  const unitColors = {};
  if (column) {
    column.units.forEach(unit => {
      if (unit.top && Number.isFinite(unit.topAge))
        horizonAges.set(unit.top, unit.topAge);
      if (unit.base && Number.isFinite(unit.baseAge))
        horizonAges.set(unit.base, unit.baseAge);
      if (unit.color) unitColors[unit.name] = unit.color;
      const record = {
        unit: unit.name,
        unitType: unit.unitType,
        level: unit.level || 1,
        color: unit.color,
        parent: unit.parent || null,
      };
      const deeper = (map, key) => {
        if (!key || !unit.color) return;
        const known = map.get(key);
        if (!known || record.level > known.level) map.set(key, record);
      };
      deeper(unitByTop, unit.top);
      deeper(unitByBase, unit.base);
    });
  }

  // A surface's name is the horizon name unless the field aliases it.
  const aliases = mapping.surfaceAliases || {};
  const stratAges = {};
  const stratUnits = {};
  const unaged = [];
  Object.values(surfaceOptions).forEach(name => {
    const horizon = aliases[name] || name;
    const age = horizonAges.get(horizon);
    if (age === undefined) unaged.push(name);
    else stratAges[name] = age;
    const below = unitByTop.get(horizon);
    const above = unitByBase.get(horizon);
    if (below || above) {
      stratUnits[name] = { below: below || null, above: above || null };
    }
  });

  if (!column) {
    console.warn(
      `> no strat column '${config.stratColumn}' found - surfaces have no ages`,
    );
  } else if (unaged.length) {
    console.warn(
      `> ${unaged.length} of ${Object.keys(surfaceOptions).length} surfaces have no age in the strat column:`,
      unaged,
    );
  }

  const surfaceIdByName = name => {
    if (!name) return null;
    const match = Object.entries(surfaceOptions).find(([, n]) => n === name);
    if (!match) {
      console.warn(`> mapped surface '${name}' is not in surface-meta`);
      return null;
    }
    return match[0];
  };

  // The field's own sea bed depth, as the wellbores measured it. The median rather
  // than the mean so one odd header cannot move it.
  const waterDepths = Object.values(wellboreHeadersData)
    .map(w => w.waterDepth)
    .filter(d => Number.isFinite(d) && d > 0)
    .sort((a, b) => a - b);
  const waterDepth = waterDepths.length
    ? waterDepths[Math.floor(waterDepths.length / 2)]
    : null;

  if (waterDepth === null) {
    console.warn('> no wellbore water depths - stories fall back to a default');
  }

  // The surveys' own extent in UTM, so anything generated to stand in for the
  // field can be placed over the data rather than over the origin — the two are
  // nowhere near each other on a field whose surveys sit off to one side.
  // ⚠️ Corner by corner, because a grid may be ROTATED: xmax/ymax are the origin
  // plus the span in the grid's own frame, not a UTM-axis-aligned box.
  let extent = null;
  Object.values(surfaceMetaData).forEach(surface => {
    const h = surface.header;
    const rad = ((h.rot || 0) * Math.PI) / 180;
    const cos = Math.cos(rad);
    const sin = Math.sin(rad);
    const w = (h.nx - 1) * h.xinc;
    const t = (h.ny - 1) * h.yinc;
    [
      [0, 0],
      [w, 0],
      [w, t],
      [0, t],
    ].forEach(([lx, ly]) => {
      const easting = h.xori + lx * cos - ly * sin;
      const northing = h.yori + lx * sin + ly * cos;
      extent = extent
        ? [
            Math.min(extent[0], easting),
            Math.min(extent[1], northing),
            Math.max(extent[2], easting),
            Math.max(extent[3], northing),
          ]
        : [easting, northing, easting, northing];
    });
  });

  const output = {
    utmZone: config.utmZone || '31N',
    origin: config.origin,
    defaultWellbore: config.wellbore,
    defaultWell: config.well,
    defaultStratColumn: config.stratColumn,
    wellboreOptions,
    surfaceOptions,
    stratAges,
    stratUnits,
    stratUnitColors: unitColors,
    waterDepth,
    fieldExtent: extent,
    seabedSurface: surfaceIdByName(mapping.seabedSurface),
    basementSurface: surfaceIdByName(mapping.basementSurface),
  };

  fs.writeFile('src/storybook/story-args.json', JSON.stringify(output), err => {
    if (err) {
      console.error(err);
    }
  });
}

createStoryArgs();
