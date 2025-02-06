import { forwardRef, Fragment, ReactNode, useImperativeHandle, useMemo } from 'react'
import { WellboreHeader } from '../../../sdk/data/types/WellboreHeader'
import { group } from 'd3-array'
import { calculateWellSegments } from '../../../sdk/data/helpers/well-helpers'

/**
 * Wells props
 * @expand
 */
export type WellsProps = {
  wellbores: WellboreHeader[],
  included?: string[],
  selected?: string,
  renderWellbore?: (
    wellbore: WellboreHeader,
    startMsl: number,
    isSelected: boolean,
    isActiveWell: boolean,
    sequence: number,
    index: number) => ReactNode,
  children?: ReactNode,
}

export type WellsRefType = {
  getHeader: (id: string) => WellboreHeader,
}

// TODO: See if we can optimize the calculations of segments
function calculateSegments(allWellbores: WellboreHeader[], includedWellbores: string[], selected?: string) {
  //console.time('calculateSegments')
  const idLookup = new Map<string, WellboreHeader>(allWellbores.map(w => [w.id, w]))
  const grouped = group(allWellbores, d => d.well)
  const includedGrouped = group(includedWellbores.filter(id => idLookup.has(id)).map(id => idLookup.get(id)!), d => d.well)

  let allSegments: Record<string, [number, number]> = {}

  grouped.forEach((wellbores, well) => {
    const included = includedGrouped.get(well) || []

    const dictionary = wellbores.reduce((dict, w) => ({ ...dict, [w.name]: w }), {})
    const wellSegments = calculateWellSegments(dictionary, included, selected)
    allSegments = { ...allSegments, ...wellSegments }
  })

  //console.log(allSegments)
  //console.timeEnd('calculateSegments')
  return allSegments
}

/**
 * The `Wells` component is used to group and manage trajectories by the well property. It will 
 * automatically calculate of top depths for each wellbore, depending on order and which wellbores are marked 
 * as being included.
 * 
 * It simplifies rendering of `Wellbore` components through the `renderWellbore` property, which gives usesful 
 * data that can be passed to the wellbore component.
 * 
 * @example
 * <Wells
 *   wellbores={wellbores}
 *   included={included}
 *   selected={selected}
 *   renderWellbore={(wellbore, fromMsl, isSelected) => {
 *     return (
 *       <Wellbore id={wellbore.id} fromMsl={fromMsl} color={isSelected ? 'red' : 'white' }>
 *        {...}
 *       </Wellbore>
 *     )
 *   }}
 * />
 * 
 * @see [Storybook](/?path=/docs/components-wellbores-wells--docs) 
 * 
 * @group Components
 */
export const Wells = forwardRef<WellsRefType, WellsProps>(({
  wellbores,
  included = wellbores.map(d => d.id),
  selected, 
  renderWellbore,
  children 
}: WellsProps, fref) => {
  
  const dictionary = useMemo<Record<string, WellboreHeader>>(() => wellbores.reduce((dict, wellbore) => ({ ...dict, [wellbore.id]: wellbore }), {}), [wellbores])

  const segments = useMemo(() => calculateSegments(wellbores, included, selected), [wellbores, included, selected])

  const activeWell = useMemo(() => {
    if (!selected) return null

    const header = wellbores.find(w => w.id === selected)
    return header ? header.well : null

  }, [selected, wellbores])

  const api = useMemo<WellsRefType>(() => {
    const getHeader = (id: string) => {
      return dictionary[id]
    }

    return {
      getHeader,
    }
  }, [dictionary])

  useImperativeHandle(fref, () => api, [api])
  
  return segments && (
    <>
      {renderWellbore && included.map((id, i) => (
        <Fragment key={id}>
            {dictionary[id] && segments[id] && renderWellbore(
              dictionary[id],
              segments[id][0],
              selected === id,
              dictionary[id].well === activeWell,
              segments[id][1],
              i,
            )}
        </Fragment>
      ))}
        {children}
    </>
  )
})