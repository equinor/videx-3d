import { verify } from '../utils.js'

export function transformPositionLogs(input, output) {
  verify(output, 'wellbore-headers')

  const wellboreHeaders = output['wellbore-headers']
  const positionlogs = input['position-logs'].reduce((map, s) => {
    let array = map[s.wellbore_uuid]
    if (!array) {
      array = []
      map[s.wellbore_uuid] = array
    }

    array.push({
      easting: s.delta_easting,
      northing: s.delta_northing,
      md: s.md,
      tvd: s.tvd,
    })
    return map
  }, {})

  output['position-logs'] = Object.keys(positionlogs).reduce((dict, key) => {
    const log = positionlogs[key]
    const header = wellboreHeaders[key]

    if (header && log) {
      // sort on md msl
      log.sort((a, b) => a.md - b.md)

      // convert depths to msl
      const nrmLog = new Array(log.length * 4)
      for (let i = 0, j = 0; i < log.length; i++, j += 4) {
        nrmLog[j] = log[i].easting
        nrmLog[j + 1] = log[i].tvd - header.depthReferenceElevation
        nrmLog[j + 2] = log[i].northing
        nrmLog[j + 3] = log[i].md - header.depthReferenceElevation
      }
      dict[key] = nrmLog
    }
    return dict
  }, {})
}