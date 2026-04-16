function getCategory(tool) {
  const name = tool.symbol_name;
  let category = 'unknown';

  if (name.match(/(tube|tubing)/i)) {
    category = 'tube';
  } else if (name.match(/(asv|dhsv|safety valve)/i)) {
    category = 'safety valve';
  } else if (name.match(/screen/i)) {
    if ((tool.comment || '').toLowerCase().indexOf('tracer') !== -1) {
      category = 'tracer';
    } else {
      category = 'screen';
    }
  } else {
    const match = name.match(
      /(blank pipe|pipe|gauge|plug|packer|injection mandrel|spm|pbr|perforation)/i,
    );
    if (match && match.length) {
      category = match[0].toLowerCase();
    }
  }
  return category;
}

function mapCompletionData(data) {
  return data
    .map(d => ({
      name: d.symbol_name,
      mdTopMsl: d.md_top,
      mdBottomMsl: d.md_bottom,
      length: d.length,
      diameterTop: d.threads_od_top_num || d.threads_od_bottom_num,
      diameterBottom: d.threads_od_bottom_num,
      diameterMax: d.od_max,
      diameterDrift: d.id_drift,
      category: getCategory(d),
    }))
    .filter(
      d => (d.diameterTop || d.diameterBottom || d.diameterMax) && d.length > 0,
    );
}
export function transformCompletion(input, output) {
  const completionData = input['completion'];

  if (!completionData) {
    output['completion'] = {};
    return;
  }

  output['completion'] = Object.keys(completionData).reduce(
    (acc, id) => ({
      ...acc,
      [id]: mapCompletionData(completionData[id] || []),
    }),
    {},
  );
}
