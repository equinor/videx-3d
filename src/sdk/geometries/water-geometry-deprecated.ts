// The names main had before `Ocean` became `Water`, kept so code written against them still
// builds. To be removed in a later major release; the migration guide lists them.
import {
  createWaterBox,
  createWaterBoxFromPolygon,
  createWaterBoxFromSurface,
  createWaterEllipseBox,
  createWaterPlane,
  type WaterBox,
  type WaterBoxFromPolygonOptions,
  type WaterBoxFromSurfaceOptions,
  type WaterBoxOptions,
  type WaterEllipseOptions,
  type WaterGeometryOptions,
  type WaterPlaneOptions,
} from './water-geometry';

/** @deprecated renamed {@link createWaterPlane} */
export const createOceanPlane = createWaterPlane;
/** @deprecated renamed {@link createWaterBox} */
export const createOceanBox = createWaterBox;
/** @deprecated renamed {@link createWaterEllipseBox} */
export const createOceanEllipseBox = createWaterEllipseBox;
/** @deprecated renamed {@link createWaterBoxFromSurface} */
export const createOceanBoxFromSurface = createWaterBoxFromSurface;
/** @deprecated renamed {@link createWaterBoxFromPolygon} */
export const createOceanBoxFromPolygon = createWaterBoxFromPolygon;
/** @deprecated renamed {@link WaterGeometryOptions} */
export type OceanGeometryOptions = WaterGeometryOptions;
/** @deprecated renamed {@link WaterPlaneOptions} */
export type OceanPlaneOptions = WaterPlaneOptions;
/** @deprecated renamed {@link WaterBoxOptions} */
export type OceanBoxOptions = WaterBoxOptions;
/** @deprecated renamed {@link WaterBox} */
export type OceanBox = WaterBox;
/** @deprecated renamed {@link WaterEllipseOptions} */
export type OceanEllipseOptions = WaterEllipseOptions;
/** @deprecated renamed {@link WaterBoxFromSurfaceOptions} */
export type OceanBoxFromSurfaceOptions = WaterBoxFromSurfaceOptions;
/** @deprecated renamed {@link WaterBoxFromPolygonOptions} */
export type OceanBoxFromPolygonOptions = WaterBoxFromPolygonOptions;
