import { useFrame } from '@react-three/fiber';
import {
  forwardRef,
  PropsWithChildren,
  useImperativeHandle,
  useLayoutEffect,
  useMemo,
  useRef,
} from 'react';
import { Group, Matrix4, Vector3 } from 'three';
import { useStableBoundary } from '../../hooks/useStableBoundary';
import { Boundary, boundaryDisc } from '../../sdk/geometries/boundary';
import {
  CRS,
  getProjectionDefFromUtmZone,
  UtmDatum,
} from '../../sdk/projection/crs';
import {
  crsFromGeoFrame,
  GeoFrame,
  geoFrameFromCrs,
  placeGeoFrame,
} from '../../sdk/projection/geo-frame';
import {
  geoFrameMatrix,
  releaseObjectMatrix,
  setObjectMatrix,
} from '../../sdk/projection/place-frame';
import { Vec3 } from '../../sdk/types/common';
import { useWorld } from '../World/world-context';
import { useWorldFields } from '../World/world-fields';
import { UtmAreaContext, UtmAreaContextProps } from './UtmAreaContext';

/**
 * UtmArea props
 * @expand
 */
export type UtmAreaProps = {
  /**
   * Which field this is, as the host names it (`UtmAreaContext`'s `id`): what is drawn inside
   * can tell which field it is in, and hand that on, as the `ref` a pick listener is
   * registered with, say.
   */
  id?: string;
  crsInstance?: CRS;
  /** the area's UTM zone, `'31N'` (with `origin`), in `datum` */
  utmZone?: string;
  /** with `utmZone`: the geodetic datum its coordinates are in (see {@link UtmDatum}). Default `'ED50'` */
  datum?: UtmDatum;
  /** with `utmZone`: the map point at the area's origin, in `originUnits` */
  origin?: [number, number];
  originUnits?: 'utm' | 'lnglat';
  offset?: Vec3;
  /**
   * A proj4 definition of the area's map, instead of `utmZone` and `datum`'s (with `origin`):
   * another datum's shift, say, or another projection in metres.
   */
  utmProjectionDef?: string;
  /**
   * The area's map and origin, instead of `crsInstance` or `utmZone` and `origin`; its
   * `offset` is not used (see `offset`). Inside a `World` an area in another frame than the
   * world's is placed where the world's map has it, however its frame is given.
   */
  frame?: GeoFrame;
  /**
   * Its stage's area in its own X/Z (east and south of its origin; see {@link Boundary}): a
   * box, `[minX, minZ, maxX, maxZ]`; a turned box, `{ box, rotation }`; a circle,
   * `{ centre, radius }`; or a polygon (a `PlanarPolygonGeometry`, or a ring of `[x, z]`
   * points). Placed in a `World` in another frame, the area is turned and set on the globe
   * about the middle of the smallest disc that holds it (`boundaryDisc`), where it then
   * meets the globe exactly; flat, it stands off the curved Earth toward its edges by
   * `d² / 2R` at `d` from there. Default about its origin. Given one, the area is a field the
   * `World` has loaded: the relief (a `GeoRelief`) is see-through over it, in its shape, as
   * over the anchored stage.
   */
  boundary?: Boundary;
};

const placing = new Matrix4();
const shift = new Matrix4();
const zeroOffset: Vec3 = [0, 0, 0];

/**
 * A container component that maps a UTM reference point to a 3d world space origin. This can be used by sub components to
 * position themselves by using UTM or Wgs84 coordinates as well as converting between these and 3d space coordinates.
 *
 * Inside a {@link World} whose frame is another — another UTM zone, a field 300 km off —
 * the area places itself: where the world's map has its origin, turned and scaled to the
 * world's grid there (`placeGeoFrame`), and on the world's globe, as the globe places the
 * ground there (`Globe.tangent`), with or without a `Scenery`. What is inside it stays in the
 * area's own frame, its conversions too. In the world's own frame it is not moved, as without a world.
 *
 * Recommended: wrap it in a `World`, even for a single field, and place what is given in
 * longitude and latitude and is not the field's data (a facility, a marker) with a
 * {@link Wgs84Position} outside the area, in the `World`: that stands on the Earth at the
 * point, at any distance, where one inside the area is flat in the field's map.
 *
 * @example
 * <UtmArea utmZone={utmZone} origin={origin} originUnits={originUnits} offset={offset}>
 *  { children }
 * </UtmArea>
 *
 * @example
 * <World frame={frame} boundary={boundary}>
 *  <UtmArea crsInstance={crs} boundary={boundary}>
 *    <Wellbores />
 *  </UtmArea>
 *  <Wgs84Position long={4.2} lat={60.6}>
 *    <PlatformModel />
 *  </Wgs84Position>
 * </World>
 *
 * @remarks
 * This component will return the internal CRS instance when passing a ref
 *
 * @see [Storybook](/videx-3d/?path=/docs/components-containers-utmarea--docs)
 * @see {@link UtmPosition}
 * @see {@link Wgs84Position}
 * @see {@link UtmAreaContext}
 * @see {@link CRS}
 *
 * @group Components
 */
export const UtmArea = forwardRef<CRS, PropsWithChildren<UtmAreaProps>>(
  (
    {
      id,
      crsInstance,
      utmZone,
      datum,
      origin,
      originUnits = 'utm',
      offset = zeroOffset,
      utmProjectionDef,
      frame,
      boundary: givenBoundary,
      children,
    },
    fref,
  ) => {
    const ref = useRef<Group>(null);
    // By its content: a frame, an origin or a datum written inline is a new object every render.
    const frameKey = frame ? JSON.stringify(frame) : '';
    const datumKey = datum ? JSON.stringify(datum) : '';
    const [originA, originB] = origin ?? [];
    const crs = useMemo(() => {
      if (frameKey) return crsFromGeoFrame(JSON.parse(frameKey) as GeoFrame);
      if (crsInstance) return crsInstance;
      const def =
        utmProjectionDef ??
        (utmZone
          ? getProjectionDefFromUtmZone(
              utmZone,
              datumKey ? (JSON.parse(datumKey) as UtmDatum) : undefined,
            )
          : null);
      if (def && originA !== undefined && originB !== undefined)
        return new CRS(def, [originA, originB], originUnits);
      throw Error(
        'Either a frame, a CRS instance, or a UTM zone (its number and N or S) or a projection definition (`utmProjectionDef`) with an origin must be provided as props to the UtmArea component!',
      );
    }, [
      frameKey,
      crsInstance,
      utmProjectionDef,
      utmZone,
      datumKey,
      originA,
      originB,
      originUnits,
    ]);

    useImperativeHandle(fref, () => crs, [crs]);

    // The area's own map, about its origin.
    const own = useMemo(() => geoFrameFromCrs(crs), [crs]);

    // Where the World has it: not at all in the world's own map about the world's origin.
    // Placed about the middle of its stage's disc, given one.
    const world = useWorld();
    const worldFrame = world?.frame ?? null;
    const boundary = useStableBoundary(givenBoundary);
    const pivoted = boundary !== null;
    const disc = useMemo(
      () => (boundary ? boundaryDisc(boundary) : null),
      [boundary],
    );
    const [pivotX, pivotZ] = disc ? disc.centre : [0, 0];
    const placement = useMemo(() => {
      if (!worldFrame) return null;
      const placed = placeGeoFrame(
        own,
        worldFrame,
        pivoted ? [pivotX, pivotZ] : undefined,
      );
      const still =
        placed.x === pivotX &&
        placed.z === pivotZ &&
        placed.rotation === 0 &&
        placed.scale === 1;
      return still ? null : placed;
    }, [own, worldFrame, pivoted, pivotX, pivotZ]);

    const [ox, oy, oz] = offset;
    // Back to the offset alone, once no longer placed.
    useLayoutEffect(() => {
      const group = ref.current;
      if (!group || placement || group.matrixAutoUpdate) return;
      releaseObjectMatrix(group);
      group.position.set(ox, oy, oz);
      group.updateMatrix();
    }, [placement, ox, oy, oz]);

    // A field the World has loaded: given its stage's area, the relief is see-through over it
    // (world.md, step 7e), read through the group's own placement.
    const addField = useWorldFields()?.addField;
    useLayoutEffect(() => {
      const group = ref.current;
      if (!addField || !group || !boundary) return;
      return addField({ object: group, boundary });
    }, [addField, boundary]);

    // Each frame, as the globe's disc or level may change under it: a handful of vector
    // operations, and the area's world matrices composed again only when it moves.
    useFrame(() => {
      const group = ref.current;
      if (!group || !placement) return;
      geoFrameMatrix(placement, world?.globe ?? null, placing);
      setObjectMatrix(
        group,
        placing.premultiply(shift.makeTranslation(ox, oy, oz)),
      );
    });

    const contextValue = useMemo<UtmAreaContextProps>(() => {
      const utmToArea = (
        easting: number,
        northing: number,
        altitude = 0,
      ): Vec3 => {
        const pos = crs.utmToWorld(easting, northing, altitude);
        return [pos.x, pos.y, pos.z];
      };

      const wgs84ToArea = (
        longitude: number,
        latitude: number,
        altitude = 0,
      ): Vec3 => {
        const pos = crs.wgs84ToWorld(longitude, latitude, altitude);
        return [pos.x, pos.y, pos.z];
      };

      const areaToUtm = (x: number, y: number, z: number) => {
        const pos = crs.worldToUtm(x, y, z);
        return pos;
      };

      // A world point in the area: through its whole transform, so a placed area reads right.
      const toArea = (x: number, y: number, z: number) => {
        if (!ref.current) throw Error('Missing reference!');
        ref.current.updateWorldMatrix(true, false);
        return ref.current.worldToLocal(new Vector3(x, y, z));
      };

      const worldToArea = (x: number, y: number, z: number): Vec3 => {
        const local = toArea(x, y, z);
        return [local.x, local.y, local.z];
      };

      const worldToUtm = (x: number, y: number, z: number) => {
        const local = toArea(x, y, z);
        return crs.worldToUtm(local.x, local.y, local.z);
      };

      const areaToWgs84 = (x: number, y: number, z: number) => {
        const pos = crs.worldToWgs84(x, y, z);
        return pos;
      };

      const worldToWgs84 = (x: number, y: number, z: number) => {
        const local = toArea(x, y, z);
        return crs.worldToWgs84(local.x, local.y, local.z);
      };

      const getWorldPosition = (): Vec3 => {
        if (!ref.current) throw Error('Missing reference!');
        const v = new Vector3();
        ref.current.getWorldPosition(v);
        return [v.x, v.y, v.z];
      };

      const getUtmOrigin = (): Vec3 => {
        const worldPosition = getWorldPosition();
        return [
          worldPosition[0] - crs.originUtm[0],
          -worldPosition[1],
          worldPosition[2] + crs.originUtm[1],
        ];
      };

      return {
        id,
        originUtm: crs.originUtm,
        originWgs84: crs.originWgs84,
        frame: own,
        utmToArea,
        wgs84ToArea,
        areaToUtm,
        worldToArea,
        worldToUtm,
        areaToWgs84,
        worldToWgs84,
        getWorldPosition,
        getUtmOrigin,
      };
    }, [id, crs, own]);

    return (
      <group ref={ref} position={offset}>
        <UtmAreaContext.Provider value={contextValue}>
          {children}
        </UtmAreaContext.Provider>
      </group>
    );
  },
);
