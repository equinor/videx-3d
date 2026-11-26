import { PropsWithChildren, useContext, useEffect, useMemo } from 'react';
import { DataContext } from '../../../contexts/DataContext';
import { WellboreHeader } from '../../../sdk/data/types/WellboreHeader';
import { clamp } from '../../../sdk/utils/numbers';
import { DepthReadout } from './DepthReadout';
import { Schematic } from './Schematic';
import { DarkTheme, WellMapStyles } from './themes';
import { WellMapContext } from './well-map-context';
import { createWellMapState } from './well-map-state';
import './well-map-styles.scss';

/**
 * WellMap props
 * @expand
 */
export type WellMapProps = {
  wellIdentifier: string;
  excluded?: string[];
  selected?: string;
  onSelect?: (wellbore: string, depth: number) => void;
  depth?: number;
  onDepthChanged?: (depth: number) => void;
  onWellboreOver?: (
    wellbore: WellboreHeader | null,
    depth: number | undefined,
  ) => void;
  color?: string;
  colors?:
    | Record<string, string>
    | ((wellbore: WellboreHeader, slot: number) => string);
  interactive?: boolean;
  headless?: boolean;
  depthCursor?: boolean;
  theme?: WellMapStyles;
  axisHeader?: { label: string; description?: string };
};

/**
 * The wellbores of one well side by side along measured depth, in HTML and SVG: each wellbore a
 * track from where it leaves its parent (or the rotary table) to its total depth, solid where
 * it is in use and dashed elsewhere, its kickoff depth marked on the axis and its name and
 * depth under it.
 *
 * Interactive by default: click a wellbore to select it and set the depth where you clicked
 * (`onSelect`, `onDepthChanged`), and drag the depth cursor, or move it with the arrow keys
 * (Shift: 25 m at a time, Ctrl: 0.1 m), Home and End. The host keeps `selected` and `depth`,
 * and can use them to select a wellbore in the 3D view or move the camera. Colour the tracks
 * with `color` or `colors` (a dictionary, or a function of the wellbore and its slot), the rest
 * with `theme`. Addons given as children draw more along the tracks.
 *
 * @example
 * <WellMap wellIdentifier="NO 16/2-D-1" />
 *
 * @remarks
 * The WellMap must be placed inside a `DataProvider`, and outside the R3F `Canvas` (or in an
 * `Overlay` or a `CanvasHtml` over it).
 *
 * @see [Storybook](/videx-3d/?path=/docs/components-html-wellmap--docs)
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
  excluded,
  selected,
  onSelect,
  depth,
  onDepthChanged,
  onWellboreOver,
  color,
  colors,
  interactive = true,
  headless = false,
  depthCursor = true,
  theme = DarkTheme,
  axisHeader,
  children,
}: PropsWithChildren<WellMapProps>) => {
  const dataContext = useContext(DataContext);

  const wellMapstate = useMemo(() => createWellMapState(), []);

  const setWellbores = wellMapstate(state => state.setWellbores);
  const wellbores = wellMapstate(state => state.wellbores);
  const slotsById = wellMapstate(state => state.slotsById);
  const svgWidth = wellMapstate(state => state.measures.svgWidth);
  const domain = wellMapstate(state => state.domain);
  const setStyles = wellMapstate(state => state.setStyles);
  const setDepth = wellMapstate(state => state.setDepth);

  const validDepth = useMemo(
    () => (depth !== undefined ? clamp(depth, domain[0], domain[1]) : depth),
    [depth, domain],
  );

  useEffect(() => {
    setStyles(theme);
  }, [theme, setStyles]);

  // keep a copy of current depth in local state for addons
  useEffect(() => {
    setDepth(validDepth);
  }, [validDepth, setDepth]);

  useEffect(() => {
    if (dataContext) {
      const store = dataContext.connect();
      if (store) {
        store
          .query<WellboreHeader>('wellbore-headers', { well: wellIdentifier })
          .then(response => {
            if (response && Array.isArray(response)) {
              setWellbores(
                Array.isArray(excluded)
                  ? response.filter(d => !excluded.includes(d.id))
                  : response,
              );
            }
          });
      }
    }
  }, [dataContext, wellIdentifier, setWellbores, excluded]);

  const colorMap: Record<string, string> | undefined = useMemo(() => {
    if (!colors) return undefined;

    if (typeof colors === 'function') {
      return Object.fromEntries(
        wellbores.map(w => [w.id, colors(w, slotsById[w.id])]),
      );
    }

    return colors;
  }, [wellbores, slotsById, colors]);

  return (
    <div
      style={{
        flex: '1 1 auto',
        display: 'flex',
        flexDirection: 'column',
        userSelect: 'none',
        boxSizing: 'border-box',
        height: '100%',
        fontFamily: 'sans-serif',
        color: theme.textColor,
        zIndex: 10,
      }}
    >
      <WellMapContext.Provider value={wellMapstate}>
        {!headless && (
          <div
            style={{
              textAlign: 'center',
              fontSize: `${Math.min(15, 0.15 * svgWidth)}px`,
            }}
          >
            <div
              style={{
                textTransform: 'uppercase',
                fontSize: `9pt`,
                textAlign: 'left',
                opacity: 0.5,
              }}
            >
              Well Map
            </div>
            <div>{wellIdentifier}</div>
            {interactive && validDepth !== undefined && (
              <DepthReadout depth={validDepth} color={theme.readoutColor} />
            )}
          </div>
        )}
        <Schematic
          selected={selected}
          setSelected={onSelect}
          depth={validDepth}
          setDepth={onDepthChanged}
          onWellboreOver={onWellboreOver}
          color={color}
          colorMap={colorMap}
          interactive={interactive}
          depthCursor={depthCursor}
          axisHeader={axisHeader}
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
  );
};
