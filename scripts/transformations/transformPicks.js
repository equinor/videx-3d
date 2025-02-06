import { verify } from '../utils.js'

function mapPicksData(picksData, stratColumn) {
  const grouped = picksData.reduce((map, p) => {
    let picks = map[p.wellbore_uuid]
    if (!picks) {
      picks = []
      map[p.wellbore_uuid] = picks
    }

    const unit = stratColumn.units.find(
      (u) => u.top === p.pick_identifier || u.base === p.pick_identifier
    )
    if (unit) {
      picks.push({
        name: p.pick_identifier,
        color: unit.color,
        level: unit.level,
        mdMsl: p.md_msl,
        tvdMsl: p.tvd_msl,
      })
    }
    return map
  }, {})

  return grouped
}

export function transformPicks(input, output) {
  const picksData = input['picks']

  output['picks'] = {}

  if (!picksData) return

  verify(input, 'config')
  verify(output, 'strat-columns')

  const config = input['config']
  const stratColumn = output['strat-columns'][config.stratColumn]

  if (stratColumn) {
    output['picks'] = mapPicksData(picksData, stratColumn)
  }
}
