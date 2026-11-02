import {
  ReactNode,
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import { Matrix4 } from 'three';
import type { GeoFrame } from '../../sdk/projection/geo-frame';
import { Globe } from '../../sdk/projection/globe';
import {
  geoFrameChangeMatrix,
  type GlobeCarry,
  globeCarry,
} from '../../sdk/projection/place-frame';
import type { Vec2 } from '../../sdk/types/common';
import type { SceneryOceanState } from '../Scenery/scenery-context';
import { SceneryReliefHub } from '../Scenery/scenery-relief-hub';
import { WorldBounds, WorldContext, WorldState } from './world-context';
import {
  WorldField,
  WorldFieldsContext,
  WorldFieldsState,
} from './world-fields';
import {
  WorldReliefContext,
  WorldReliefStage,
  WorldReliefState,
} from './world-relief';

/**
 * What a {@link World} tells its host when its `frame` changes: how to carry the camera, and
 * what else the host keeps in the scene's coordinates, from the old frame's to the new.
 *
 * @group Components
 */
export type WorldFrameChange = {
  /** the frame before */
  from: GeoFrame;
  /** the frame now */
  to: GeoFrame;
  /**
   * From the old coordinates to the new as the new anchored field is carried
   * (`geoFrameChangeMatrix`): exact for its own content, about its stage's middle (the
   * `World`'s `bounds`); an affine fit elsewhere (a camera 500 m over a field 123 km away
   * lands 37 m low)
   */
  matrix: Matrix4;
  /**
   * Points and directions by their latitude, longitude and height over the sea
   * (`globeCarry`): exact wherever the globe places things — a camera and its target over
   * the ground, the relief, the layers — at any distance
   */
  carry: GlobeCarry;
};

/**
 * World props
 * @expand
 */
export type WorldProps = {
  /**
   * The scene's frame on the Earth — the anchored field's, usually: world X/Z are its map's,
   * about its origin (at its `offset`). Changing it moves what is placed in the world, not
   * the camera: that is the host's, told by `onFrameChange`.
   */
  frame: GeoFrame;
  /**
   * The anchored stage's area, `[minX, minZ, maxX, maxZ]` in world X/Z: the globe is cut flat
   * over the disc that holds it, so the stage's fields meet the sea and the relief there
   * exactly, with or without a `Scenery`. A `SceneryStage` takes it by default. Without it, a
   * `SceneryStage` sets the disc while it is drawn. Change it with `frame`, at once.
   */
  bounds?: WorldBounds;
  /**
   * The Earth is curved: the sea, the relief, the geographic layers and every field placed in
   * the world lie on a sphere, flat over the disc. Off, everything lies on the level plane, as
   * on a map. Default true
   */
  globe?: boolean;
  /**
   * Told once the `frame` has changed, before the first frame is drawn with it: carry the
   * camera, its controls' target and its up, and whatever else is kept in the scene's
   * coordinates, by `change.carry` or `change.matrix`, or set a new view. The library never
   * moves the camera. Everything in the world is placed anew in that frame.
   */
  onFrameChange?: (change: WorldFrameChange) => void;
  /**
   * Told after the first frame drawn with everything placed in the new `frame`: the moment
   * to uncover a switch the host covered. What still loads (relief tiles, the sky's bake)
   * reports through the progress reports (`Scenery.onProgress`). With `frameloop="demand"`,
   * after the next two animation frames whether drawn or not: invalidate on `onFrameChange`.
   */
  onFrameSettled?: () => void;
  children?: ReactNode;
};

/**
 * Where the scene lies on the Earth, said once, and the Earth everything is placed on: the
 * world holds its frame, the disc it is cut flat over and its `Globe`, whatever is drawn. What
 * is inside takes them from here:
 *
 * - a `UtmArea` in another frame (another UTM zone, a field 300 km off) places itself:
 *   where the world's map has its origin, turned and scaled to the world's grid there, and
 *   on the globe. One in the world's own frame is not moved.
 * - a `Scenery` draws on the globe, and takes its `observer`'s place from the frame when the
 *   observer gives only a date;
 * - the geographic layers lie on the globe;
 * - a `SceneryStage` takes `bounds`, and the `relief` (a `GeoRelief`) is read in the frame.
 *
 * Renders nothing of its own: with or without a `Scenery`, everything is placed the same. See
 * `documents/world.md`.
 *
 * Switching the anchored field is changing `frame` and `bounds` together, when the host
 * chooses: everything is placed anew before the next frame is drawn, `onFrameChange` says
 * how to carry the camera, and `onFrameSettled` when the first frame with it has been drawn.
 * How the switch is covered — a fade, say — is the host's.
 *
 * @example
 * <World
 *   frame={anchor.frame}
 *   bounds={anchor.bounds}
 *   onFrameChange={({ carry }) => carryCamera(carry)}
 *   onFrameSettled={uncover}
 * >
 *   <Scenery observer={{ date }}>
 *     <SceneryOcean />
 *     <SceneryStage />
 *   </Scenery>
 *   <GeoRelief layers={layers} />
 *   <UtmArea frame={volve.frame} bounds={volve.bounds}>{volveData}</UtmArea>
 *   <UtmArea frame={other.frame} bounds={other.bounds}>{otherData}</UtmArea>
 * </World>
 *
 * @group Components
 */
export const World = ({
  frame,
  bounds,
  globe: curved = true,
  onFrameChange,
  onFrameSettled,
  children,
}: WorldProps) => {
  // By its content: a frame written inline is a new object every render.
  const key = JSON.stringify(frame);
  // eslint-disable-next-line react-hooks/exhaustive-deps -- keyed by content above
  const stable = useMemo(() => frame, [key]);
  const [minX, minZ, maxX, maxZ] = bounds ?? [];
  const given = bounds !== undefined;
  const disc = useMemo<WorldBounds | null>(
    () => (given ? [minX!, minZ!, maxX!, maxZ!] : null),
    [given, minX, minZ, maxX, maxZ],
  );
  // On the Earth from the start, as what is placed in it may ask before an effect has run.
  const [globe] = useState(() => {
    const earth = new Globe();
    earth.setFrame(stable);
    earth.enabled = curved;
    if (disc) earth.setDisc(disc);
    return earth;
  });

  // The host's handlers as last given, for a change to call; before the effect below.
  const handlers = useRef({ onFrameChange, onFrameSettled });
  useLayoutEffect(() => {
    handlers.current = { onFrameChange, onFrameSettled };
  });
  // The frame the globe lies in, to tell a change from the first; and the animation frame a
  // change waits on to settle.
  const applied = useRef<GeoFrame | null>(null);
  const settling = useRef<number | null>(null);
  useEffect(
    () => () => {
      if (settling.current !== null) cancelAnimationFrame(settling.current);
    },
    [],
  );

  // Frame, disc and curvature together, in one place: synchronously after the render that
  // changed them, so no frame is drawn with some of it old.
  useLayoutEffect(() => {
    const from = applied.current;
    const changed = from !== null && from !== stable;
    const tell = changed ? handlers.current.onFrameChange : undefined;
    // The globe as it lay in the old frame, to carry from.
    const before = tell ? globe.clone() : null;
    if (globe.frame !== stable) globe.setFrame(stable);
    if (globe.enabled !== curved) globe.enabled = curved;
    if (disc) globe.setDisc(disc);
    applied.current = stable;
    if (!changed) return;
    if (tell && before && from) {
      // The new stage's middle, in its own X/Z: what the new field is placed about.
      const [ox, oz] = stable.offset ?? [0, 0];
      const pivot: Vec2 | undefined = disc
        ? [(disc[0] + disc[2]) / 2 - ox, (disc[1] + disc[3]) / 2 - oz]
        : undefined;
      tell({
        from,
        to: stable,
        matrix: geoFrameChangeMatrix(
          from,
          stable,
          before,
          new Matrix4(),
          pivot,
        ),
        carry: globeCarry(before, globe),
      });
    }
    // The next animation frame draws everything placed anew; the one after follows it.
    if (settling.current !== null) cancelAnimationFrame(settling.current);
    settling.current = requestAnimationFrame(() => {
      settling.current = requestAnimationFrame(() => {
        settling.current = null;
        handlers.current.onFrameSettled?.();
      });
    });
  }, [globe, stable, curved, disc]);
  const state = useMemo<WorldState>(
    () => ({ frame: stable, bounds: disc, globe }),
    [stable, disc, globe],
  );

  // The relief's: what it shares (the tiles it draws, the ground under the camera), and the
  // sky and the stage that join it.
  const [tiles] = useState(() => new SceneryReliefHub());
  const [ground] = useState(() => ({ current: null as number | null }));
  const [reliefs, setReliefs] = useState(0);
  const [sky, setSky] = useState<SceneryOceanState | null>(null);
  const [stage, setStage] = useState<WorldReliefStage | null>(null);
  const addRelief = useCallback(() => {
    setReliefs(count => count + 1);
    return () => setReliefs(count => count - 1);
  }, []);
  const provideSky = useCallback((offered: SceneryOceanState) => {
    setSky(offered);
    return () => setSky(current => (current === offered ? null : current));
  }, []);
  const provideStage = useCallback((handed: WorldReliefStage) => {
    setStage(handed);
    return () => setStage(current => (current === handed ? null : current));
  }, []);
  const relief = useMemo<WorldReliefState>(
    () => ({
      tiles,
      ground,
      present: reliefs > 0,
      sky,
      stage,
      addRelief,
      provideSky,
      provideStage,
    }),
    [tiles, ground, reliefs, sky, stage, addRelief, provideSky, provideStage],
  );
  useEffect(() => {
    if (reliefs > 1)
      console.warn(
        'World: more than one GeoRelief with layers; the first one drawn is the one layers lie on.',
      );
  }, [reliefs]);

  // The fields loaded, the anchored one and its neighbours: what the relief is see-through
  // over, each in its own frame.
  const [fieldList, setFieldList] = useState<readonly WorldField[]>([]);
  const addField = useCallback((field: WorldField) => {
    setFieldList(list => [...list, field]);
    return () => setFieldList(list => list.filter(f => f !== field));
  }, []);
  const fields = useMemo<WorldFieldsState>(
    () => ({ fields: fieldList, addField }),
    [fieldList, addField],
  );

  return (
    <WorldContext.Provider value={state}>
      <WorldFieldsContext.Provider value={fields}>
        <WorldReliefContext.Provider value={relief}>
          {children}
        </WorldReliefContext.Provider>
      </WorldFieldsContext.Provider>
    </WorldContext.Provider>
  );
};
