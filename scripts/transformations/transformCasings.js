import { verify } from '../utils.js'

const metersToInches = 39.3701

function getType(item) {
  const name = item.item_type || ''
  let group

  if (name.match(/(Shoe|Float Shoe)/i)) {
    group = 'Shoe'
  } else if (name.match(/Collar/i)) {
    group = 'Collar'
  } else if (name.match(/Hanger/i)) {
    group = 'Hanger'
  } else if (name.match(/Casing/i)) {
    group = 'Casing'
  } else {
    group = name || 'Unknown'
  }
  return group
}

function mapCasingData(data) {
  // DUCK-TAPE ALERT! Swapping inner/outer diameter if inner > outer + removing duplicates!
  data.forEach(d => {
    if (d.interval_numeric < d.diameter_numeric) {
      const tempNum = d.interval_numeric
      const tempStr = d.interval

      d.interval_numeric = d.diameter_numeric
      d.interval = d.diameter
      d.diameter_numeric = tempNum
      d.diameter = tempStr
    }
  })
  const unique = new Set()

  return data
    .filter((d) => Number.isFinite(d.depth_top_md) && (d.type === 'L' || d.type === 'C' || d.type === 'TIE'))
    .map((d) => ({
      type: getType(d),
      innerDiameter: d.diameter_numeric / metersToInches,
      outerDiameter: d.interval_numeric / metersToInches,
      mdTopMsl: d.depth_top_md,
      mdBottomMsl: d.depth_bottom_md,
      properties: {
        Type: d.item_type,
        Diameter: d.diameter,
        Interval: d.interval,
        'Depth Top': `${d.depth_top_md.toFixed(d.depth_top_md_decimals)} ${d.depth_top_md_unit}`,
        'Depth Bottom': `${d.depth_bottom_md.toFixed(d.depth_bottom_md_decimals)} ${d.depth_bottom_md_unit}`,
        'Air Gap': `${d.air_gap}`,
        'Max Inc.': `${d.max_inc} ${d.max_inc_unit}`,
        Coupling: d.coupling,
        Remarks: d.remark,
        //...d
      },
    }))
    .filter((d => {
      const str = JSON.stringify(d)
      if (!unique.has(str)) {
        unique.add(str)
        return true
      }
      //console.warn('Duplicate removed from casing data', d)
      return false
    }))
    .filter((d) => d.mdBottomMsl - d.mdTopMsl > 0 && d.outerDiameter > 0)
}

export function transformCasings(input, output) {
  const casingData = input['casings']
  
  if (!casingData) {
    output['casings'] = {}
    return  
  }

  verify(output, 'wellbore-headers')

  const wellboreHeaders = output['wellbore-headers']
  const headerByName = Object.values(wellboreHeaders).reduce((acc, h) => {
    return {
      ...acc,
      [h.name]: h,
    }
  }, {})


  const mappedCasings = Object.keys(casingData).reduce((acc, id) => {
    return {
      ...acc,
      [id]: mapCasingData(casingData[id] || []),
    }
  }, {})
  

  // Need to append casing data traversing the parent hierarchy to get complete casing data for each wellbore
  // This is because we have gathered casing data directly linked to each wellbores only.
  const wellboreCasings = {}
  Object.keys(wellboreHeaders).forEach((key) => {
    const header = wellboreHeaders[key]
    const items = []

    if (mappedCasings[key] && Array.isArray(mappedCasings[key])) {
      items.push(...mappedCasings[key])
    }

    let topMd = Infinity
    let maxDim = 0
    if (items && Array.isArray(items)) {
      for (let i = 0; i < items.length; i++) {
        if (items[i].type === 'L') {
          if (items[i].mdTopMsl < topMd) topMd = items[i].mdTopMsl
          if (items[i].innerDiameter > maxDim) maxDim = items[i].innerDiameter
        }
      }
    }
    let parentName = header.parent
    while (parentName) {
      const parentHeader = headerByName[parentName]
      if (!parentHeader) break

      const parentItems = mappedCasings[parentHeader.id]
      if (parentItems && Array.isArray(parentItems)) {
        const filtereditems = parentItems.filter(
          (d) => d.mdTopMsl < topMd && d.innerDiameter > maxDim
        )
        if (filtereditems.length) {
          items.push(...filtereditems)
          // update topMd and maxDim
          for (let i = 0; i < filtereditems.length; i++) {
            if (filtereditems[i].type === 'L') {
              if (filtereditems[i].mdTopMsl < topMd) topMd = filtereditems[i].mdTopMsl
              if (filtereditems[i].innerDiameter > maxDim) maxDim = filtereditems[i].innerDiameter
            }
          }
        }

      }

      parentName = parentHeader.parent
    }
    wellboreCasings[key] = items
  })

  output['casings'] = wellboreCasings
}