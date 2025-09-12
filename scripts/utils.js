export function verify(data, ...deps) {
  for (let i = 0; i < deps.length; i++) {
    const dep = deps[i]
    if (!data[dep]) {
      throw Error('Missing dependency: ' + dep + '!')
    }
  }
}

export function groupBy(array, groupBy) {
  return array.reduce((grouped, d) => {
    const key = groupBy(d)
    let group = grouped[key]
    if (!group) {
      group = []
      grouped[key] = group
    }
   
    group.push(d)
    
    return grouped
  }, {})
}