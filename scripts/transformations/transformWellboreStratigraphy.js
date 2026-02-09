import { groupBy } from '../utils.js';

function mapWellboreStratigraphyData(stratData) {
  return stratData.map(d => ({
    wellboreId: d.wellbore_uuid,
    stratColumnId: d.strat_column_uuid,
    name: d.strat_unit_identifier,
    type: d.strat_unit_type,
    level: d.strat_unit_level,
    color: d.color_html,
    entry: {
      mdMsl: d.entry_md_msl,
      tvdMsl: d.entry_tvd_msl,
    },
    exit: {
      mdMsl: d.exit_md_msl,
      tvdMsl: d.exit_tvd_msl,
    },
    properties: {
      updated: d.update_date ? d.update_date : null,
    },
  }));
}

function getWellboreFormations(wellbore, headers, formationData) {
  const formationIntervals = [];

  // keep track of visited wellbores to avoid loops
  const visitedWellbores = new Set();

  // start bottom-up and keep track of the md (mdProgress) and the kick off depth (max depth for formations to be used from parent wellbores)
  // of the previous wellbore (maxExitMd)
  let mdProgress = Infinity;
  let maxExitMd = Infinity;

  const getFormationsForWellbore = wellboreId => {
    const formations = formationData[wellboreId] || [];
    return formations
      .filter(d => d.entry.mdMsl < mdProgress)
      .sort((a, b) => b.entry.mdMsl - a.entry.mdMsl || b.level - a.level);
  };

  // select the relevant formations from a wellbore according to mdProgress and maxExitMd
  const addIntervals = header => {
    visitedWellbores.add(header.id);

    if (
      header.kickoffDepthMsl === null ||
      header.kickoffDepthMsl < mdProgress
    ) {
      const intervals = getFormationsForWellbore(header.id);

      for (let i = 0; i < intervals.length; i++) {
        const interval = intervals[i];
        if (interval.entry.mdMsl <= mdProgress) {
          mdProgress = interval.entry.mdMsl;
          interval.exit.mdMsl = Math.min(interval.exit.mdMsl, maxExitMd);
          formationIntervals.push(interval);
        }
      }
    }

    if (header.parent) {
      if (
        header.kickoffDepthMsl !== null &&
        Number.isFinite(header.kickoffDepthMsl)
      ) {
        // we should not consider intervals from parent wellbore below current wellbore kickoff point
        mdProgress = Math.min(mdProgress, header.kickoffDepthMsl);
        maxExitMd = header.kickoffDepthMsl;
      }
      if (!visitedWellbores[header.parent]) {
        const parent = headers[header.parent];
        if (parent) addIntervals(parent);
      }
    }
  };

  // select formations relevant for the requested wellbore all the way to the top,
  // by traversing up the parent-chain
  addIntervals(wellbore);

  // if no intervals was selected, return an empty array
  if (formationIntervals.length === 0) {
    return [];
  }

  // sort and traverse list in order to detect and merge intervals where the entry is in the parent and the exit is in the child
  formationIntervals.sort(
    (a, b) => b.level - a.level || a.entry.mdMsl - b.entry.mdMsl,
  );

  // build formations data by merging selected intervals
  let current = formationIntervals.pop();

  // keep a list of the merged formation intervals
  const combinedIntervals = [];

  while (formationIntervals.length) {
    const interval = formationIntervals.pop();
    if (
      interval.name === current.name &&
      interval.entry.mdMsl < current.entry.mdMsl &&
      current.entry.mdMsl <= interval.exit.mdMsl
    ) {
      current.entry = { ...interval.entry };
    } else {
      combinedIntervals.push(current);
      current = interval;
    }
  }
  combinedIntervals.push(current);

  return combinedIntervals;
}

export function transformWellboreStratigraphy(input, output) {
  const wellboreStratData = input['wellbore-stratigraphy'];
  const headersById = output['wellbore-headers'];

  // generate wellbore header dictionary
  const headersByName = Object.values(headersById).reduce((dict, header) => {
    dict[header.name] = header;
    return dict;
  }, new Object(null));

  // map to videx-3d formation type
  const mappedFormations = mapWellboreStratigraphyData(wellboreStratData);

  output['formations'] = {};

  if (!mappedFormations) return;

  const groupedFormations = groupBy(mappedFormations, d => d.stratColumnId);

  // concat formations through the parent chain for each strat column and join
  // the result per wellbore
  Object.keys(groupedFormations).forEach(stratColumnId => {
    const formationData = groupedFormations[stratColumnId];
    if (formationData) {
      const formationsByWellbore = groupBy(formationData, d => d.wellboreId);
      Object.keys(formationsByWellbore).forEach(wellboreId => {
        const wellbore = headersById[wellboreId];
        if (wellbore) {
          const combinedFormations = getWellboreFormations(
            wellbore,
            headersByName,
            formationsByWellbore,
          );

          if (!output['formations'][wellboreId]) {
            output['formations'][wellboreId] = combinedFormations;
          } else {
            output['formations'][wellboreId].push(...combinedFormations);
          }
        }
      });
    }
  });
}
