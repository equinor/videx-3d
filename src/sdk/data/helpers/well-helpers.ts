import { WellboreHeader } from '../types/WellboreHeader'

/**
 * Caluclate the segments top for a single well
 * @param dictionary dictionary of wellbore headers indexed by wellbore name
 * @param included array of wellbore headers that should be included
 * @param selected id of selected wellbore if applicable (will be processed first => sequence = 0)
 * @returns dictionary of segment tops in MD Msl indexed by wellbore id
 */
export function calculateWellSegments(
  dictionary: Record<string, WellboreHeader>,
  included: WellboreHeader[],
  selected?: string
) {
  const reservations = new Map<string, number>()
  const segments: Record<string, [number, number]> = {}
  included.sort((a, b) => {
    if (a.id === selected) return -1
    if (b.id === selected) return 1
    return a.drilled && b.drilled
      ? b.drilled.getTime() - a.drilled.getTime()
      : a.name.localeCompare(b.name)
  })
  //console.log(included)
  for (let i = 0; i < included.length; i++) {
    const wellbore = included[i]

    if (!wellbore) continue
    let fromMsl = wellbore.parent && wellbore.kickoffDepthMsl !== null ? wellbore.kickoffDepthMsl : -wellbore.depthReferenceElevation

    if (reservations.has(wellbore.id)) {
      fromMsl = reservations.get(wellbore.id)!
    } else {
      let parent = wellbore.parent

      while (parent) {
        const parentWellbore = dictionary[parent]
        if (!parentWellbore) break

        if (reservations.has(parentWellbore.id)) {
          const reservedDepth = reservations.get(parentWellbore.id)!
          if (fromMsl >= reservedDepth) {
            reservations.set(parentWellbore.id, fromMsl)
            fromMsl = reservedDepth
          }
          break
        } else {
          reservations.set(parentWellbore.id, fromMsl)
          fromMsl = parentWellbore.parent && parentWellbore.kickoffDepthMsl !== null ? parentWellbore.kickoffDepthMsl : -parentWellbore.depthReferenceElevation
        }
        parent = parentWellbore.parent
      }
    }
    segments[wellbore.id] = [fromMsl, i]
    reservations.set(wellbore.id, wellbore.depthMdMsl)
  }
  return segments
}
