import { ReadonlyStore } from '../Store'
import { Formation, FormationMarker, MergedFormationInterval } from '../types'

/**
* Get the formations for a wellbore filtered by strat column and optionally truncated by fromMsl
*/ 
export async function getWellboreFormations(
  wellboreId: string,
  stratColumnId: string,
  store: ReadonlyStore,
  fromMsl?: number
) {
  const formationIntervals = await store.get<Formation[]>('formations', wellboreId) || []
  
  fromMsl = fromMsl === undefined ? -Infinity : fromMsl

  const filteredIntervals = formationIntervals.filter(d => d.stratColumnId === stratColumnId && d.exit.mdMsl > fromMsl)

  filteredIntervals.sort((a, b) => a.entry.mdMsl - b.entry.mdMsl || a.level - b.level)

  if (filteredIntervals.length && filteredIntervals[0].entry.mdMsl < fromMsl) {
    filteredIntervals[0].entry.mdMsl = fromMsl
  } 

  return filteredIntervals
}

function toMergedFormationInterval(item: Formation, from: number, to: number) {
  const interval: MergedFormationInterval = {
    mdMslFrom: from,
    mdMslTo: to,
    name: item.name,
    level: item.level,
    color: item.color,
    properties: { ...(item.properties) || {} }
  }
  return interval
}


/**
 * Merges stratigraphy formations from multiple stratigraphy unit levels into a single column,
 * where the highest level takes presidence over lower levels.
 * 
 * The intervals will be processed in-order; in other words, how the intervals are sorted. 
 * We sort first by descending level (higher levels take presidence over lower levels), then by
 * entry depth (processing top-down) and finally by descending update date. 
 * 
 * The last sorting criteria is used to ensure consistant behaviour for the edge-cases where formation intervals
 * overlaps within the same strat unit level.   
 */
export function mergeFormationIntervals(formationIntervals: Formation[]) {
  if (!formationIntervals.length) return [];
  let merged: MergedFormationInterval[] = [];

  const sortedIntervals = [...formationIntervals].sort(
    (a, b) => {
      const order = b.level - a.level || a.entry.mdMsl - b.entry.mdMsl;
      // handle special case where two formation intervals of the same level have the same entry depth
      if (order === 0 && (a.properties?.updated || b.properties?.updated)) {
        const aUpdated = a.properties?.updated ? new Date(a.properties?.updated) : null
        const bUpdated = b.properties?.updated ? new Date(b.properties?.updated) : null 
        // order by update date
        if (aUpdated === null) return 1;
        if (bUpdated === null) return -1;
        return bUpdated.getTime() - aUpdated.getTime();
      }
      return order;
    },
  );

  for (let i = 0; i < sortedIntervals.length; i++) {
    const item = sortedIntervals[i]
    let depth = item.entry.mdMsl

    const mergedModified = [...merged]
    for (let j = 0; j < merged.length && depth < item.exit.mdMsl; j++) {
      const existing = merged[j]
      
      if (depth < existing.mdMslFrom) {
        const bottom = Math.min(item.exit.mdMsl, existing.mdMslFrom)
        mergedModified.push(toMergedFormationInterval(item, depth, bottom))
      }
      depth = Math.max(depth, existing.mdMslTo)
    }

    if (depth < item.exit.mdMsl) {
      mergedModified.push(toMergedFormationInterval(item, depth, item.exit.mdMsl))
    }  
    merged = mergedModified.sort((a, b) => a.mdMslFrom - b.mdMslFrom)
  }
  return merged
}

/**
 * Identify surface entry points, where the highest level strat unit has precedence:
 * - Sort intervals by ascending entry depth and descending stratigraphy unit level
 * - Pick only the first formation of a depth, ignoring any following formations with the same depth as the previous formation
 */
export function getFormationMarkers(
  intervals: Formation[]
): FormationMarker[] {
  const markers: FormationMarker[] = []

  const items = [...intervals].sort(
    (a, b) => a.entry.mdMsl - b.entry.mdMsl || b.level - a.level
  )
  let prev = null
  let depth = -Infinity
  for (let i = 0; i < items.length; i++) {
    const item = items[i]
    if (item.entry.mdMsl > depth) {
      depth = item.entry.mdMsl

      // check if we should include the exit where there is a gap between the formations
      if (prev && prev.exit.mdMsl < depth) {
        markers.push({
          color: prev.color,
          name: prev.name,
          type: 'base',
          mdMsl: prev.exit.mdMsl,
          tvdMsl: prev.exit.tvdMsl,
          level: prev.level,
        })
      }

      markers.push({
        color: item.color,
        name: item.name,
        type: 'top',
        mdMsl: depth,
        tvdMsl: item.entry.tvdMsl,
        level: item.level,
      })

      prev = item
    }
  }

  // add a marker of the last base
  if (prev) {
    markers.push({
      color: prev.color,
      name: prev.name,
      type: 'base',
      mdMsl: prev.exit.mdMsl,
      tvdMsl: prev.exit.tvdMsl,
      level: prev.level,
    })
  }
  return markers
}
