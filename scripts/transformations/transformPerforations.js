function getPhase(value) {
  if (value) {
    const split = value.split(/\/|-/);
    if (split.length === 2) {
      return Math.min(+split[0], +split[1]);
    }
    return +split[0];
  }
  return 0;
}

function mapPerforationData(data) {
  return data.map(d => ({
    type: d.gun_type,
    comment: d.comment,
    status: d.status,
    density: d.shot_density,
    phase: getPhase(d.shot_phase),
    mdTopMsl: d.md_top,
    mdBottomMsl: d.md_bottom,
  }));
}

export function transformPerforations(input, output) {
  const perforationData = input['perforations'];

  if (!perforationData) {
    output['perforations'] = {};
    return;
  }

  const perforationDataDict = perforationData.reduce((map, s) => {
    let array = map[s.wellbore_uuid];
    if (!array) {
      array = [];
      map[s.wellbore_uuid] = array;
    }

    array.push(s);
    return map;
  }, {});

  output['perforations'] = Object.keys(perforationDataDict).reduce(
    (acc, id) => ({
      ...acc,
      [id]: mapPerforationData(perforationDataDict[id] || []),
    }),
    {},
  );
}
