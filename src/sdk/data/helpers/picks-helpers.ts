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
  const added = new Set<string>()

  // keep track of depth as we progress from bottom-up of the wellbore

  let md = Infinity
  let bottom = Infinity

  // fallback
  let picksFromPrev: Pick[] = []

  // add all picks in range (top, bottom) from a wellbore header
  const addPicks = async (header: WellboreHeader) => {
    let top = fromMsl !== undefined ? fromMsl : -Infinity
    if (header.kickoffDepthMsl !== null && header.kickoffDepthMsl > top) {
      top = header.kickoffDepthMsl
    }
    let wellborePicks: Pick[] | null = null

    // we prioritize picks from previous wellbores if they exist above the bottom of the current range
    if (picksFromPrev && picksFromPrev.length > 0 && picksFromPrev[0].mdMsl < bottom) {
      wellborePicks = picksFromPrev
    } else {
      wellborePicks = await limit(() => store.get<Pick[]>('picks', header.id))
      if (wellborePicks) {
        picksFromPrev = wellborePicks
      } else {
        return
      }
    }

    const picks = wellborePicks.filter(
      (d) => d.mdMsl <= bottom && d.mdMsl >= top
    )

    picks.sort((a, b) => b.mdMsl - a.mdMsl)

    for (let i = 0; i < picks.length; i++) {
      const pick = picks[i]

      if (pick.mdMsl <= md && !added.has(pick.id)) {
        const unit = unitsMap.get(pick.pickIdentifier)
        if (unit) {
          matched.push({
            pick,
            unit,
          })
        } else {
          unmatched.push(pick)
        }
        added.add(pick.id)
        md = pick.mdMsl
      }
    }

    bottom = top
    if (traverse && header.parent && md > top) {
      const parent = headers.get(header.parent)
      if (parent) await addPicks(parent)
    }
  }

  await addPicks(wellbore)

  return { matched, unmatched, wellbore }
}

export function createFormationIntervals(
  unitPicks: UnitPick[],
  maxDepth: number = Infinity,
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
      const limit = a.entry.mdMsl

      while (stack.length && depth < limit) {
        const b = stack.pop()!

        if (b.exit.mdMsl > depth) {
          const bottom = Math.min(b.exit.mdMsl, limit)

          merged.push({
            mdMslTop: depth,
            mdMslBottom: bottom,
            unit: b.unit,
          })

          depth = bottom

          if (b.exit.mdMsl > limit) {
            stack.push(b)
          }
        }
      }

      depth = limit
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
