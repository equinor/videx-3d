function mapStratColumnsData(stratColumnData) {
  const grouped = stratColumnData
    .sort((a, b) => a.top_age - b.top_age)
    .reduce((map, s) => {
      let stratCol = map[s.strat_column_uuid]
      if (!stratCol) {
        stratCol = {
          id: s.strat_column_uuid,
          name: s.strat_column_identifier,
          type: s.strat_column_type,
          units: [],
        }
        map[s.strat_column_uuid] = stratCol
      }

      stratCol.units.push({
        id: s.uuid,
        name: s.identifier,
        unitType: s.strat_unit_type || 'unknown',
        top: s.top,
        topAge: s.top_age,
        base: s.base,
        baseAge: s.base_age,
        color: s.color_html || 'gray',
        level: s.strat_unit_level,
        parent: s.strat_unit_parent,
      })
      return map
    }, {})
  return grouped
}


export function transformStratColumns(input, output) {
  const stratColumnData = input['strat-columns']
  
  if (!stratColumnData) {
    output['strat-columns'] = {}
    return  
  }

  output['strat-columns'] = mapStratColumnsData(stratColumnData)
}