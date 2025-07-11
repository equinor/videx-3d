import { limit } from '../../utils/limiter'
import { ReadonlyStore } from '../Store'
import { StratColumn, StratColumnUnit, WellboreHeader } from '../types'
import { Pick } from '../types/Pick'

export type UnitPick = {
  pick: Pick
  unit: StratColumnUnit
}

export type FormationInterval = {
  entry: Pick
  exit: Pick
  unit: StratColumnUnit
}

export type FormationColumnInterval = {
  mdMslTop: number
  mdMslBottom: number
  unit: StratColumnUnit
}

export type FormationMarker = {
  name: string
  color: string
  mdMsl: number
  tvdMsl?: number
  type: 'top' | 'base'
  level: number
}

/**
 * Match picks bottom-up (wellbore -> parent chain) with stratigraphy units.
 * As we traverse to a parent wellbore, ignore any picks that are deeper than
 * the current pick depth or the child's kickoff depth.
 *
 * If a wellbore has picks above its kickoff depth, we prioritize these picks
 * above corresponding picks from the parent wellbore
 *
 */
export async function getUnitPicks(
  wellboreId: string,
  stratColumnId: string,
  store: ReadonlyStore,
  traverse = true,
  fromMsl?: number
) {
  const [wellbore, stratColumn] = await limit(() =>
    Promise.all([
      store.get<WellboreHeader>('wellbore-headers', wellboreId),
      store.get<StratColumn>('strat-columns', stratColumnId),
    ])
  )

  if (!wellbore || !stratColumn) return null

  const headers = new Map<string, WellboreHeader>()

  // we need a map of all trajectories in the well to be able to traverse up the wellbore parent chain
  if (wellbore.parent && traverse) {
    const wellHeaders = await limit(() =>
      store.query<WellboreHeader>('wellbore-headers', { well: wellbore.well })
    )
    wellHeaders.forEach((h) => {
      headers.set(h.name, h)
    })
  }

  // create a map of strat units to use for matching picks with strat column units
  const unitsMap = stratColumn.units.reduce<Map<string, StratColumnUnit>>(
    (map, unit) => {
      map.set(unit.top, unit)
      map.set(unit.base, unit)
      return map
    },
    new Map()
  )

  const matched: UnitPick[] = []
  const unmatched: Pick[] = []

  // to keep track of which picks we've already added
  const visited = new Set<string>()

  fromMsl = fromMsl === undefined ? -Infinity : fromMsl

  // keep track of depth as we progress from bottom-up of the wellbore
  let md = Infinity


  // add all picks in range (top, bottom) from a wellbore header
  const addPicks = async (header: WellboreHeader) => {
    if (header.kickoffDepthMsl === null || header.kickoffDepthMsl < md) {
      let wellborePicks: Pick[] | null = null

      // we prioritize picks from previous wellbores if they exist above the bottom of the current range
      wellborePicks = await limit(() => store.get<Pick[]>('picks', header.id))
      if (wellborePicks) {
        wellborePicks = wellborePicks
          .filter((d) => d.mdMsl <= md && d.mdMsl)
          .sort((a, b) => b.mdMsl - a.mdMsl)

        for (let i = 0; i < wellborePicks.length; i++) {
          const pick = wellborePicks[i]

          if (pick.mdMsl <= md && !visited.has(pick.id)) {
            const unit = unitsMap.get(pick.pickIdentifier)
            if (unit) {
              matched.push({
                pick,
                unit,
              })
              md = pick.mdMsl
            } else {
              unmatched.push(pick)
            }
            visited.add(pick.id)
          }
        }
      }
    }
    if (traverse && header.parent && md > fromMsl) {
      if (header.kickoffDepthMsl !== null) {
        // we should never use picks from parent wellbore below current wellbore kickoff point
        md = Math.min(md, header.kickoffDepthMsl) 
      }
      const parent = headers.get(header.parent)
      if (parent) await addPicks(parent)
    }
  }

  await addPicks(wellbore)

  return { matched, unmatched, wellbore }
}

/**
 * Create groups of entry and exit picks for each stratigraphy unit level:
 *
 * - Sort the matched picks by ascending level and ascending depth
 * - Traverse the matched picks, keeping a reference of the current level and unit to find the correct entry and exit pick
 * - Remove picks from list as formations are identified
 */
export function createFormationIntervals(
  unitPicks: UnitPick[],
  maxDepth: number = Infinity
): FormationInterval[] {
  const intervals: FormationInterval[] = []

  if (!Array.isArray(unitPicks) || unitPicks.length < 2) return intervals

  let list = unitPicks.map((up) => ({
    ...up,
    deleted: false,
  })) // make a copy

  list.sort(
    (a, b) =>
      a.unit.level - b.unit.level ||
      a.pick.mdMsl - b.pick.mdMsl ||
      a.unit.topAge - b.unit.topAge
  )

  const findNext = () => {
    let interval = null
    const entry = list.shift()
    if (entry) {
      for (let i = 0; i < list.length; i++) {
        const candidate = list[i]

        // if we react a new strat unit level, it means we won't find a matching exit pick due
        // to how we ordered the unit picks
        if (entry.unit.level < candidate.unit.level) {
          break
        }

        if (candidate.unit.name === entry.unit.name) {
          if (candidate.pick.pickIdentifier !== entry.pick.pickIdentifier) {
            list[i].deleted = true // mark item as deleted
            interval = {
              entry: entry.pick,
              exit: candidate.pick,
              unit: entry.unit,
            }

            break
          } else {
            list[i].deleted = true // remove candidate from list as it is a duplicate of the parent wellbore entry pick
          }
        }
      }

      list = list.filter((d) => !d.deleted)
    }

    return interval
  }

  while (list.length) {
    const interval = findNext()

    // Only add interval if it has a range
    if (interval && interval.entry.mdMsl !== interval.exit.mdMsl) {
      /*
      // if the interval is of the same unit as the previous, and there's no gap between them,
      // modify previous interval instead of adding a new
      const prevInterval = intervals[intervals.length - 1]
      if (prevInterval && prevInterval.unit.identifier === interval.unit.identifier && prevInterval.exit.md === interval.entry.md) {
        prevInterval.exit = { ...prevInterval.exit } // avoid mutating original data
        prevInterval.exit.md = interval.exit.md
        prevInterval.exit.mdMsl = interval.exit.mdMsl
        prevInterval.exit.tvdMsl = interval.exit.tvdMsl
      } else {
        intervals.push(interval)  
      }
      */
      if (interval.entry.mdMsl < maxDepth) {
        if (interval.exit.mdMsl > maxDepth) {
          interval.exit.mdMsl = maxDepth
        }
        intervals.push(interval)
      }
    }
  }
  return intervals
}

/**
 * Merge into a single column, where higher levels takes precedence over lower levels:
 *
 * - Sort the intervals by ascending entry depth and ascending stratigraphy unit level
 * - Start with a stack containing the first item from the sorted list and keep track of the entry depth
 * - iterate to find the next item that has an entry depth lower than current depth
 *  - define a range limit from the current depth and the entry of the item with a lower entry depth
 *  - pop the stack and draw sections while adjusting the current depth and keep doing this until the current depth reaches the range limit
 *  - any items on the stack with an exit md greater than the limit gets pushed back on the stack
 *  - the current item is pushed to the stack and the iteration continues
 */
export function mergeFormationIntervals(
  formationIntervals: FormationInterval[]
) {
  if (!formationIntervals.length) return []

  const merged: FormationColumnInterval[] = []

  const items = [...formationIntervals].sort(
    (a, b) => a.entry.mdMsl - b.entry.mdMsl || a.unit.level - b.unit.level
  )

  const first = items[0]
  const stack = [first]

  let depth = first.entry.mdMsl

  for (let i = 1; i < items.length; i++) {
    const a = items[i]
    if (a.entry.mdMsl > depth) {
      const lim = a.entry.mdMsl

      while (stack.length && depth < lim) {
        const b = stack.pop()!

        if (b.exit.mdMsl > depth) {
          const bottom =
            a.unit.level >= b.unit.level
              ? Math.min(b.exit.mdMsl, lim)
              : b.exit.mdMsl

          merged.push({
            mdMslTop: depth,
            mdMslBottom: bottom,
            unit: b.unit,
          })

          depth = bottom

          if (b.exit.mdMsl > depth) {
            stack.push(b)
          }
        }
      }

      depth = Math.max(lim, depth)
    }

    stack.push(a)
  }

  // process the remaining items on the stack
  while (stack.length) {
    const b = stack.pop()!

    if (b.exit.mdMsl > depth) {
      const bottom = b.exit.mdMsl

      merged.push({
        mdMslTop: depth,
        mdMslBottom: bottom,
        unit: b.unit,
      })

      depth = bottom
    }
  }

  return merged
}

/**
 * Identify surface entry picks, where the highest level picks has precedence:
 * - Sort intervals by ascending entry depth and descending stratigraphy unit level
 * - Pick only the first pick of a depth, ignoring any following picks with the same depth as the previous pick
 */
export function getFormationMarkers(
  intervals: FormationInterval[]
): FormationMarker[] {
  const markers: FormationMarker[] = []

  const items = [...intervals].sort(
    (a, b) => a.entry.mdMsl - b.entry.mdMsl || b.unit.level - a.unit.level
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
          color: prev.unit.color,
          name: prev.unit.name,
          type: 'base',
          mdMsl: prev.exit.mdMsl,
          tvdMsl: prev.exit.tvdMsl,
          level: prev.unit.level,
        })
      }

      markers.push({
        color: item.unit.color,
        name: item.unit.name,
        type: 'top',
        mdMsl: depth,
        tvdMsl: item.entry.tvdMsl,
        level: item.unit.level,
      })

      prev = item
    }
  }

  // add a marker of the last base
  if (prev) {
    markers.push({
      color: prev.unit.color,
      name: prev.unit.name,
      type: 'base',
      mdMsl: prev.exit.mdMsl,
      tvdMsl: prev.exit.tvdMsl,
      level: prev.unit.level,
    })
  }
  return markers
}
