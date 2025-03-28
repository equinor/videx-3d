
function mapPicksData(picksData) {
  const grouped = picksData.reduce((map, p) => {
    let picks = map[p.wellbore_uuid]
    if (!picks) {
      picks = []
      map[p.wellbore_uuid] = picks
    }
   
    picks.push({
      id: p.uuid,
      wellboreId: p.wellbore_uuid,
      pickIdentifier: p.pick_identifier,
      mdMsl: p.md_msl,
      tvdMsl: p.tvd_msl,
      properties: {
        confidence: p.confidence,
        qualifier: p.qualifier,
      }
    })
    
    return map
  }, {})

  return grouped
}

export function transformPicks(input, output) {
  const picksData = input['picks']

  output['picks'] = {}

  if (!picksData) return

  output['picks'] = mapPicksData(picksData)
}
