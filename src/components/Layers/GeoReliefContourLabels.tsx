import { useCallback } from 'react';
import { type Camera, Vector3 } from 'three';
import type { ReliefContourLabelPoint } from '../../sdk/geometries/relief-contour-labels';
import type { Globe } from '../../sdk/projection/globe';
import {
  GEO_TILE_ROOT_SPAN,
  geoTileRegion,
} from '../../sdk/tiles/geo-tile-keys';
import { blendTileEdgeHeights } from '../../sdk/tiles/tile-edges';
import { tileParent } from '../../sdk/tiles/tile-keys';
import {
  ContourLabels,
  contourLevelText,
  type ContourLabelFrame,
  type ContourLabelLook,
  type ContourLabelTile,
} from '../Labels/ContourLabels';
import type { Label } from '../Labels/types';
import { useCameraSite } from '../../hooks/useCameraSite';
import type { SceneryReliefHub } from '../Scenery/scenery-relief-hub';
import { layerShownAt } from './layer-globe';

/** The contour lines one of a relief's looks labels (`ReliefContours.labels`): `step` metres apart from the sea's level. */
export type ReliefContourLabelLook = ContourLabelLook & {
  /** under the sea's level too */
  seabed: boolean;
};

const DEG = Math.PI / 180;
const EARTH_RADIUS = 6371000;

const here = new Vector3();
const up = new Vector3();
const eastward = new Vector3();
const northward = new Vector3();
const normal = new Vector3();
const direction = new Vector3();

// A row's height on the ground, metres, of a tile `span` degrees across in `cells`.
const rowMetres = (span: number, cells: number) =>
  (span / cells) * DEG * EARTH_RADIUS;

// A geographic tile's depth from its span.
const depthOf = (span: number) =>
  Math.round(Math.log2(GEO_TILE_ROOT_SPAN / span));

// Its label on the globe: lying on the ground at its line's height, tilted with it, reading
// along it.
function contourLabel(
  key: number,
  cells: number,
  point: ReliefContourLabelPoint,
  globe: Globe,
): Label {
  const [west, north, span] = geoTileRegion(key);
  const longitude = west + (point.column / cells) * span;
  const latitude = north - (point.row / cells) * span;
  // On the ground as drawn, on its triangle.
  const h = point.height;
  globe.geodetic(latitude, longitude, h, here);
  globe.upAt(here, up);
  globe
    .geodetic(latitude, longitude + 1e-4, h, eastward)
    .sub(here)
    .normalize();
  globe
    .geodetic(latitude + 1e-4, longitude, h, northward)
    .sub(here)
    .normalize();
  // Metres a row (south) and a column (east).
  const row = rowMetres(span, cells);
  const column = row * Math.cos(latitude * DEG);
  // Up, leaning against the ground's rise east and north.
  normal
    .copy(up)
    .addScaledVector(eastward, -point.rise[0] / column)
    .addScaledVector(northward, point.rise[1] / row)
    .normalize();
  direction
    .copy(eastward)
    .multiplyScalar(point.along[0] * column)
    .addScaledVector(northward, -point.along[1] * row)
    .normalize();
  return {
    text: contourLevelText(point.level),
    position: here.toArray(),
    normal: normal.toArray(),
    direction: direction.toArray(),
    id: `${key}:${point.level}:${Math.round(point.column * 8)}:${Math.round(point.row * 8)}`,
  };
}

/**
 * GeoReliefContourLabels props
 * @internal
 */
type GeoReliefContourLabelsProps = {
  /** the relief's tiles as drawn */
  hub: SceneryReliefHub;
  globe: Globe;
  /** per look (0 the relief's, 1 + i its layer i's, as its tiles mark their nodes): what it labels, or null */
  looks: (ReliefContourLabelLook | null)[];
  /** the sea's water over the seabed: no labels under the sea's level */
  water: boolean;
  visible: boolean;
  /** the most a relief tile's cell spans on screen before it is split (`GeoRelief`'s `cellPixels`) */
  cellPixels: number;
};

/**
 * A relief's contour lines' labels (`ReliefContours.labels`), found on each relief tile
 * drawn from its heights as drawn (`ContourLabels`): toward the edges a coarser tile
 * touches, its parent's surface (`SceneryReliefDrawn.edges`); laid on the globe; none on
 * the coastline, nor under the sea's level without seabed lines or while the sea has water.
 * Shown on the ground below each style's `maxHeight` (`layerShownAt`).
 *
 * @internal
 */
export const GeoReliefContourLabels = ({
  hub,
  globe,
  looks,
  water,
  visible,
  cellPixels,
}: GeoReliefContourLabelsProps) => {
  const cameraSite = useCameraSite();

  const source = useCallback(
    (camera: Camera): ContourLabelFrame | null => {
      const drawn = hub.current;
      if (!drawn || !globe.frame) return null;
      return {
        version: drawn.keysVersion,
        count: drawn.index.size,
        rootRow: rowMetres(GEO_TILE_ROOT_SPAN, drawn.cells),
        keys: () => drawn.index.keys(),
        tile: key => {
          const tile = drawn.tileAt(key);
          if (!tile) return null;
          // Its nearest to the camera: from its middle, less half its diagonal and its rise.
          const [west, north, span] = geoTileRegion(key);
          const rowM = rowMetres(span, tile.cells);
          const middle = north - span / 2;
          globe.geodetic(
            middle,
            west + span / 2,
            (tile.min + tile.max) / 2,
            here,
          );
          const across = tile.cells * rowM;
          const half =
            Math.hypot(across, across * Math.cos(middle * DEG)) / 2 +
            (tile.max - tile.min) / 2;
          // Its edges toward a coarser tile, blended toward its parent as the relief draws it.
          const instance = drawn.index.get(key)!;
          const parent =
            drawn.edges[2 * instance + 1] >= 0
              ? drawn.tileAt(tileParent(key))
              : null;
          const edges = parent ? drawn.edges[2 * instance] : 0;
          return {
            key,
            from: [tile, edges, parent],
            away: Math.max(here.distanceTo(camera.position) - half, 0),
            rowMetres: rowM,
            aspect: Math.cos(middle * DEG),
            depth: depthOf(span),
            ground: () => ({
              cells: tile.cells,
              heights: parent
                ? blendTileEdgeHeights(
                    tile.heights,
                    parent.heights,
                    tile.cells,
                    edges,
                  )
                : tile.heights,
              looks: tile.layers,
              low: Math.min(tile.min, parent?.min ?? Infinity),
              high: Math.max(tile.max, parent?.max ?? -Infinity),
            }),
          };
        },
      };
    },
    [hub, globe],
  );
  const place = useCallback(
    (tile: ContourLabelTile, cells: number, point: ReliefContourLabelPoint) =>
      contourLabel(tile.key, cells, point, globe),
    [globe],
  );
  // Not on the coastline, nor under the sea where it is not labelled.
  const refuse = useCallback(
    (level: number, look: ReliefContourLabelLook) =>
      level === 0 || (level < 0 && (water || !look.seabed)),
    [water],
  );
  const shownAt = useCallback(
    (style: { maxHeight?: number }, camera: Camera) =>
      layerShownAt(
        cameraSite.get(camera),
        globe,
        { maxHeight: style.maxHeight },
        'ground',
      ) > 0,
    [cameraSite, globe],
  );

  return (
    <ContourLabels
      looks={looks}
      visible={visible}
      cellPixels={cellPixels}
      source={source}
      place={place}
      refuse={refuse}
      shownAt={shownAt}
      refresh={[water, globe.location]}
    />
  );
};
