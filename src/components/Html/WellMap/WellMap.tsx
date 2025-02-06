import './well-map-styles.scss'
import { PropsWithChildren, useContext, useEffect, useMemo } from 'react'
import { DataContext } from '../../../contexts/DataContext'
import { WellboreHeader } from '../../../sdk/data/types/WellboreHeader'
import { Schematic } from './Schematic'
import { DepthReadout } from './DepthReadout'
import { createWellMapState } from './well-map-state'
import { WellMapContext } from './well-map-context'
import { DarkTheme, WellMapStyles } from './themes'
import { clamp } from '../../../sdk/utils/numbers'


/**
 * WellMap props
 * @expand
 */
export type WellMapProps = {
  wellIdentifier: string
  selected?: string
  onSelect?: (wellbore: string, depth: number) => void
  depth?: number
  onDepthChanged?: (depth: number) => void
  color?: string
  colors?: Record<string, string> | ((wellbore: WellboreHeader, slot: number) => string)
  interactive?: boolean
  headless?: boolean
  depthCursor?: boolean
  theme?: WellMapStyles
}

/**
 * This HTML component visualizes the trajectories of a well side-by-side according to the measured depth. It shows
 * each wellbore from its kickoff depth to the terminal end point.
 * 
 * The well map supports various interactions, which can be used to control selection and camera position/focus.
 * You can customize colors by providing a color dictionary or color selection function via the `colors` prop.
 * 
 * For other colors, use the `theme` prop. 
 *
 * @example
 * <WellMap wellIdentifier="NO 16/2-D-1" />
 * 
 * @remarks
 * The WellMap must be placed as a child of the `DataProvider` component, but outside of the R3F fiber `Canvas` component.
 *  
 * @see [Storybook](/?path=/docs/components-html-wellmap--docs) 
 * @see {@link WellMapStyles}
 * @see {@link WellMapCasingShoes}
 * @see {@link WellMapCompletionIntervals}
 * @see {@link WellMapFormations}
 * @see {@link WellMapTvd}
 * @see {@link WellMapContext}
 * @group Components
 */
export const WellMap = ({
  wellIdentifier,
  selected,
  onSelect,
  depth,
  onDepthChanged,
  color,
  colors,
  interactive = true,
  headless = false,
  depthCursor = true,
  theme = { ...DarkTheme },
  children
}: PropsWithChildren<WellMapProps>) => {
  
  const dataContext = useContext(DataContext)
  
  const wellMapstate = useMemo(() => createWellMapState(), [])

  const setWellbores = wellMapstate(state => state.setWellbores)
  const wellbores = wellMapstate(state => state.wellbores)
  const slotsById = wellMapstate(state => state.slotsById)
  const svgWidth = wellMapstate(state => state.measures.svgWidth)
  const domain = wellMapstate(state => state.domain)
  const setStyles = wellMapstate(state => state.setStyles)
  const setDepth = wellMapstate(state => state.setDepth)

  const validDepth = useMemo(() => {
    let validDepth = depth
    if (validDepth !== undefined) {
      validDepth = clamp(validDepth, domain[0], domain[1])
    }
    return validDepth
  }, [depth, domain])

  useEffect(() => {
    setStyles(theme)
  }, [theme, setStyles])

  // keep a copy of current depth in local state for addons
  useEffect(() => {
    setDepth(validDepth)
  }, [validDepth, setDepth])

  useEffect(() => {
    if (dataContext) {
      const store = dataContext.connect()
      if (store) {
        store.query<WellboreHeader>('wellbore-headers', { well: wellIdentifier }).then(response => {
          if (response && Array.isArray(response)) {
            setWellbores(response)
          }
        })
      }
    }
  }, [dataContext, wellIdentifier, setWellbores])

  const colorMap: Record<string, string> | undefined = useMemo(() => {
    if (!colors) return undefined

    if (typeof colors === 'function') {
      return wellbores.reduce((acc, wellbore) => ({
        ...acc,
        [wellbore.id]: colors(wellbore, slotsById[wellbore.id]),
      }), {})
    }

    return colors
  }, [wellbores, slotsById, colors])

  return (
    <div style={{
      flex: '1 1 auto',
      display: 'flex',
      flexDirection: 'column',
      userSelect: 'none',
      boxSizing: 'border-box',
      height: '100%',
      fontFamily: 'sans-serif',
      color: theme.textColor,
      zIndex: 10,
    }}>
      <WellMapContext.Provider value={wellMapstate}>
      {!headless && (
        <div style={{ textAlign: 'center', fontSize: `${Math.min(15, 0.15 * svgWidth)}px` }}>
          <div style={{ textTransform: 'uppercase', fontSize: `9pt`, textAlign: 'left', opacity: 0.5 }}>Well Map</div>
          <div>{wellIdentifier}</div>
          {(interactive && validDepth !== undefined) && (
            <DepthReadout depth={validDepth} color={theme.readoutColor} />
          )}
        </div>
      )}

      <Schematic
        selected={selected}
        setSelected={onSelect}
        depth={validDepth}
        setDepth={onDepthChanged}
        color={color}
        colorMap={colorMap}
        interactive={interactive}
        depthCursor={depthCursor}
      >
        {children}
      </Schematic>
      {/* <div style={{ color: 'gray' }}>
        <center>
          <i>Footer</i>
        </center>
      </div> */}
      </WellMapContext.Provider>
    </div>
  )
}