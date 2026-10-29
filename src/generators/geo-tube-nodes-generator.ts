import { transfer } from 'comlink';
import type { ReadonlyStore } from '../sdk';
import {
  geoTubeNodesAround,
  type GeoTubeLaying,
  type GeoTubeNodesLaid,
  type GeoTubeRoutes,
} from '../sdk/layers/geo-tubes';
import type { LonLat } from '../sdk/layers/geo-lines';
import type { ConformalOrigin } from '../sdk/projection/conformal-sphere';

/**
 * A `GeoTubes` layer's nodes about the camera (see `geoTubeNodesAround`): the routes sent
 * with the call, laid closer near the camera's foot `centre` and farther apart farther off.
 * Reads nothing from the store. The ground under the nodes near the camera is left to the
 * caller, where the relief is (`liftGeoTubeNodes`).
 *
 * @param routes the lines (`packGeoTubeRoutes`)
 * @param centre the camera's foot, longitude and latitude
 * @param altitude the camera's height over the ground there, metres
 * @param laying how far apart
 * @param origin the globe's conformal sphere (`Globe.conformalOrigin`)
 * @param fallback metres over the sea where the ground is not known
 * @param capacity the most nodes
 */
export async function generateGeoTubeNodes(
  this: ReadonlyStore,
  routes: GeoTubeRoutes,
  centre: LonLat,
  altitude: number,
  laying: GeoTubeLaying,
  origin: ConformalOrigin,
  fallback: number,
  capacity: number,
): Promise<GeoTubeNodesLaid> {
  const laid = geoTubeNodesAround(
    routes,
    centre,
    altitude,
    laying,
    origin,
    fallback,
    capacity,
  );
  return transfer(laid, [
    laid.nodes.buffer as ArrayBuffer,
    laid.lonLat.buffer as ArrayBuffer,
    laid.along.buffer as ArrayBuffer,
    laid.near.buffer as ArrayBuffer,
  ]);
}
