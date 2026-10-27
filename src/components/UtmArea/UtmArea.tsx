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
import { CRS, getProjectionDefFromUtmZone } from '../../sdk/projection/crs';
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
import { UtmAreaContext, UtmAreaContextProps } from './UtmAreaContext';

/**
 * UtmArea props
 * @expand
 */
export type UtmAreaProps = {
  crsInstance?: CRS;
  utmZone?: string;
  /** with `utmZone`: the map point at the area's origin, in `originUnits` */
  origin?: [number, number];
  originUnits?: 'utm' | 'lnglat';
  offset?: Vec3;
  utmProjectionDef?: string;
  /**
   * The area's map and origin, instead of `crsInstance` or `utmZone` and `origin`; its
   * `offset` is not used (see `offset`). Inside a `World` an area in another frame than the
   * world's is placed where the world's map has it, however its frame is given.
   */
  frame?: GeoFrame;
};

const placing = new Matrix4();
const shift = new Matrix4();

/**
 * A container component that maps a UTM reference point to a 3d world space origin. This can be used by sub components to
 * position themselves by using UTM or Wgs84 coordinates as well as converting between these and 3d space coordinates.
 *
 * Inside a {@link World} whose frame is another — another UTM zone, a field 300 km off —
 * the area places itself: where the world's map has its origin, turned and scaled to the
 * world's grid there (`placeGeoFrame`), and on the `Scenery`'s globe when there is one, as the
 * globe places the ground there (`Globe.tangent`). What is inside it stays in the area's own
 * frame, its conversions too. In the world's own frame it is not moved, as without a world.
 *
 * @example
 * <UtmArea utmZone={utmZone} origin={origin} originUnits={originUnits} offset={offset}>
 *  { children }
 * </UtmArea>
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
      crsInstance,
      utmZone,
      origin,
      originUnits = 'utm',
      offset = [0, 0, 0],
      frame,
      children,
    },
    fref,
  ) => {
    const ref = useRef<Group>(null);
    // By its content: a frame written inline is a new object every render.
    const frameKey = frame ? JSON.stringify(frame) : '';
    const crs = useMemo(() => {
      if (frameKey) return crsFromGeoFrame(JSON.parse(frameKey) as GeoFrame);
      if (crsInstance) return crsInstance;
      if (utmZone && origin) {
        const utmDef = getProjectionDefFromUtmZone(utmZone.toUpperCase());
        return new CRS(utmDef, origin, originUnits);
      }
      throw Error(
        'Either a frame, a CRS instance or a UTM zone (string containing zone number + N/S for north/south hemisphere) with an origin must be provided as props to the UtmArea component!',
      );
    }, [frameKey, crsInstance, utmZone, origin, originUnits]);

    useImperativeHandle(fref, () => crs, [crs]);

    // The area's own map, about its origin.
    const own = useMemo(() => geoFrameFromCrs(crs), [crs]);

    // Where the World has it: not at all in the world's own map about the world's origin.
    const world = useWorld();
    const worldFrame = world?.frame ?? null;
    const placement = useMemo(() => {
      if (!worldFrame) return null;
      const placed = placeGeoFrame(own, worldFrame);
      const still =
        placed.x === 0 &&
        placed.z === 0 &&
        placed.rotation === 0 &&
        placed.scale === 1;
      return still ? null : placed;
    }, [own, worldFrame]);

    const [ox, oy, oz] = offset;
    // Back to the offset alone, once no longer placed.
    useLayoutEffect(() => {
      const group = ref.current;
      if (!group || placement || group.matrixAutoUpdate) return;
      releaseObjectMatrix(group);
      group.position.set(ox, oy, oz);
      group.updateMatrix();
    }, [placement, ox, oy, oz]);

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
        const origin: Vec3 = [
          worldPosition[0] - crs.originUtm[0],
          -worldPosition[1],
          worldPosition[2] + crs.originUtm[1],
        ];
        return origin;
      };

      return {
        originUtm: crs.originUtm,
        originWgs84: crs.originWgs84,
        frame: own,
        utmToArea,
        wgs84ToArea,
        areaToUtm,
        worldToUtm,
        areaToWgs84,
        worldToWgs84,
        getWorldPosition,
        getUtmOrigin,
      };
    }, [crs, own]);

    return (
      <group ref={ref} position={offset}>
        <UtmAreaContext.Provider value={contextValue}>
          {children}
        </UtmAreaContext.Provider>
      </group>
    );
  },
);
