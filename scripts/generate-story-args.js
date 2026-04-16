/**
 * This script generates a json file with config and lookup values from the data
 * currently put in the public folder. It assumes specific file names to be present,
 * and containing data of a specific shape.
 *
 * We do this as a workaround as Storybook does not support async args or argstypes.
 */

import fs from 'node:fs';

export function createStoryArgs() {
  const config = JSON.parse(fs.readFileSync('public/data/config.json'));
  const wellboreHeadersData = JSON.parse(
    fs.readFileSync('public/data/wellbore-headers.json'),
  );
  const surfaceMetaData = JSON.parse(
    fs.readFileSync('public/data/surface-meta.json'),
  );

  // const stratColumns = JSON.parse(
  //   fs.readFileSync('public/data/strat-columns.json')
  // )

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

  const output = {
    utmZone: config.utmZone || '31N',
    origin: config.origin,
    defaultWellbore: config.wellbore,
    defaultWell: config.well,
    defaultStratColumn: config.stratColumn,
    wellboreOptions,
    surfaceOptions,
    //stratUnitOptions: Array.from(stratUnits),
    //stratUnitTypeOptions: Array.from(stratUnitTypes),
  };

  fs.writeFile('src/storybook/story-args.json', JSON.stringify(output), err => {
    if (err) {
      console.error(err);
    }
  });
}

createStoryArgs();
