import { useTexture } from '@react-three/drei';
import type { Meta, StoryObj } from '@storybook/react-vite';

import { extend } from '@react-three/fiber';
import { CurveInterpolator } from 'curve-interpolator';
import { ComponentType, useEffect, useMemo, useState } from 'react';
import {
  BufferGeometry,
  DoubleSide,
  ExtrudeGeometry,
  Line,
  Matrix4,
  MeshStandardMaterial,
  ShapeGeometry,
  TorusGeometry,
  Vector3,
} from 'three';
import { Grid, Symbols, useData } from '../../main';
import { Canvas3dDecorator } from '../../storybook/decorators/canvas-3d-decorator';
import { DataProviderDecorator } from '../../storybook/decorators/data-provider-decorator';
import { get } from '../../storybook/dependencies/api';
import { useFieldOutline } from '../../storybook/hooks/useFieldOutline';
import storyArgs from '../../storybook/story-args.json';
import { PositionLog, SymbolsType, WellboreHeader } from '../data/types';
import { parseGeoJsonFeature, PlanarFeature } from '../layers/geo-features';
import { CRS, getProjectionDefFromUtmZone } from '../projection/crs';
import { Vec2 } from '../types/common';
import {
  Coordinates2D,
  PlanarGeometry,
  PlanarLineGeometry,
  PlanarPolygonGeometry,
} from './planar-geometry';

extend({ ThreeLine: Line });

const utmZone = storyArgs.utmZone;
const origin = storyArgs.origin as Vec2;
const crs = new CRS(getProjectionDefFromUtmZone(utmZone), origin, 'utm');

/**
 * These functions are used to map from wgs84/utm to world space XY coordinates.
 * Note that we negating the Y-coordinates (utm north value)! We do this since shapes in
 * THREE.js are defined in the XY plane, and as the Z axis points south
 * rather than north, we flip it so that the geometry becomes correct after we rotate it along
 * the x-axis to align with the XZ plane.
 */
const transformWgs84 = (pos: Vec2) => {
  const coord = crs.wgs84ToWorld(pos[0], pos[1]);
  return [coord.x, -coord.z] as Vec2;
};

const transformUtm = (pos: Vec2) => {
  const coord = crs.utmToWorld(pos[0], pos[1], 0);
  return [coord.x, -coord.z] as Vec2;
};

/**
 * A fixed synthetic GeoJSON feature, used only to show `parseGeoJsonFeature` at
 * work — it is not the demo field, and `centralize` is what makes its placement
 * irrelevant.
 */
const SAMPLE_POLYGON_URL = '/geojson/sample-polygon.json';

/** Scene XZ to the XY plane shapes are authored in — see {@link transformWgs84}. */
const flipNorthing = (pos: Vec2): Vec2 => [pos[0], -pos[1]];

function scaleUvToBoundingBox(geometry: BufferGeometry) {
  const size = new Vector3();

  geometry.computeBoundingBox();
  geometry.boundingBox?.getSize(size);

  const uvAttr = geometry.getAttribute('uv');

  for (let i = 0; i < uvAttr.count; i++) {
    const j = i * 2;

    const u = uvAttr.array[j];
    const v = uvAttr.array[j + 1];

    uvAttr.array[j] = (u - geometry.boundingBox!.min.x) / size.x;
    uvAttr.array[j + 1] = (v - geometry.boundingBox!.min.y) / size.y;
  }
}

type ExampleProps = {
  centralize: boolean;
};

type DemoProps = ExampleProps & {
  Example: ComponentType<ExampleProps>;
};

const DemoComponent = ({ Example, ...props }: DemoProps) => {
  return (
    <>
      <Grid
        plane="xz"
        size={[5000, 5000]}
        cellSize={250}
        originValue={props.centralize ? [0, 0] : origin}
        gridScale={props.centralize ? [1, 1] : [1, -1]}
        subDivisions={5}
        backgroundOpacity={0.5}
        radial={props.centralize}
      />
      <Example {...props} />
    </>
  );
};

/**
 * `PlanarGeometry` holds 2D points, lines or polygons, the geometry types of GeoJSON, in the
 * scene's horizontal plane: a `PlanarPointGeometry`, `PlanarLineGeometry` or
 * `PlanarPolygonGeometry`. Make one with `PlanarGeometry.fromPointCoordinates`,
 * `fromLineCoordinates` or `fromPolygonCoordinates`, from coordinates of any kind and a function
 * that maps them into the scene (these stories map WGS84 and UTM through a `CRS`). A polygon
 * turns into Three.js shapes (`toShapes`) to fill or extrude.
 *
 * Three.js shapes lie in the XY plane, so the stories map north to Y and then rotate what they
 * draw onto the ground. `centralize` moves a story's geometry to the scene's origin
 * (`centralize()`, which keeps the offset it moved by).
 */
const meta = {
  title: 'SDK/planar-geometry',
  component: DemoComponent,
  decorators: [Canvas3dDecorator, DataProviderDecorator],
  parameters: {
    scale: 1000,
    autoClear: true,
    cameraPosition: [0, 5000, 4000],
  },
} satisfies Meta<typeof DemoComponent>;

export default meta;

type Story = StoryObj<typeof meta>;

/** Polygon  */

const PolygonsDemo = ({ centralize }: ExampleProps) => {
  const uvMap = useTexture('uv_grid.jpg');
  const [feature, setFeature] = useState<PlanarFeature | null>(null);

  useEffect(() => {
    get(SAMPLE_POLYGON_URL).then(json => {
      const feature = parseGeoJsonFeature(json, transformWgs84);

      // The centralize function will translate the geometry coordinates towards the origin by calculating
      // an offset from the origin to the center of the geometry bounding box.
      if (centralize) feature.geometry.centralize();
      setFeature(feature);
    });
  }, [centralize]);

  const geometries = useMemo(() => {
    if (!feature) return null;

    const polygonGeometry = feature.geometry as PlanarPolygonGeometry;

    const lineGeometry = new BufferGeometry().setFromPoints(
      polygonGeometry.getPointsFlattened(),
    );

    const shapes = polygonGeometry.toShapes();

    const shapeGeometry = new ShapeGeometry(shapes);

    const extrudedGeometry = new ExtrudeGeometry(shapes, {
      bevelOffset: -5,
      bevelSize: 5,
      bevelThickness: 50,
      bevelEnabled: true,
      bevelSegments: 3,
    });

    scaleUvToBoundingBox(shapeGeometry);

    lineGeometry.rotateX(-Math.PI / 2);
    shapeGeometry.rotateX(-Math.PI / 2);
    extrudedGeometry.rotateX(-Math.PI / 2);

    return { lineGeometry, shapeGeometry, extrudedGeometry };
  }, [feature]);

  return (
    <>
      {geometries?.shapeGeometry && (
        <>
          <mesh
            geometry={geometries.shapeGeometry}
            position={[0, 500, 0]}
            renderOrder={10}
          >
            <meshBasicMaterial
              color="magenta"
              side={DoubleSide}
              transparent
              opacity={0.5}
              depthWrite={false}
            />
          </mesh>
          <mesh geometry={geometries.shapeGeometry} position={[0, 1000, 0]}>
            <meshStandardMaterial map={uvMap} side={DoubleSide} />
          </mesh>
        </>
      )}
      {geometries?.lineGeometry && (
        <threeLine geometry={geometries.lineGeometry} position={[0, 1, 0]}>
          <lineBasicMaterial color="red" />
        </threeLine>
      )}
      {geometries?.extrudedGeometry && (
        <mesh geometry={geometries.extrudedGeometry} position={[0, 1500, 0]}>
          <meshStandardMaterial
            attach="material-0"
            color="orange"
            roughness={0.7}
            metalness={0.3}
          />
          <meshStandardMaterial
            attach="material-1"
            color="brown"
            roughness={0.7}
            metalness={0.7}
          />
        </mesh>
      )}
    </>
  );
};

const LinesDemo = ({ centralize }: ExampleProps) => {
  const data = useData();
  const outline = useFieldOutline({ transform: flipNorthing });

  const [trajectories, setTrajectories] = useState<PlanarLineGeometry | null>(
    null,
  );

  // The field outline the trajectories produce, drawn as a dashed reference ring.
  const fieldOutline = useMemo<BufferGeometry | null>(() => {
    if (!outline || centralize) return null;
    const g = new BufferGeometry().setFromPoints(outline.getPointsFlattened());
    g.rotateX(-Math.PI / 2);
    return g;
  }, [outline, centralize]);

  useEffect(() => {
    if (data) {
      data.all<WellboreHeader>('wellbore-headers').then(async headers => {
        if (headers) {
          const ids = headers.reduce<string[]>((acc, h) => [...acc, h.id], []);
          const poslogPromises = ids.map(id =>
            data.get<PositionLog>('position-logs', id),
          );
          const positionLogs = await Promise.all(poslogPromises);

          // generate evently spaced points along wellbore trajectories along the easting and northing (2D) plane (utm coordinates)
          const utmLines = positionLogs.map((poslogMsl, i) => {
            const header = headers[i];
            if (!poslogMsl || !header) return [];
            const points: Vec2[] = [];
            for (let j = 0; j < poslogMsl.length; j += 4) {
              points.push([
                poslogMsl[j] + header.easting,
                poslogMsl[j + 2] + header.northing,
              ]);
            }
            const curve = new CurveInterpolator(points, {
              alpha: 1,
              tension: 0,
              closed: false,
            });
            const segments = Math.max(2, Math.ceil(curve.length / 20));
            return curve.getPoints(segments);
          });

          const planarGeometry = PlanarGeometry.fromLineCoordinates(
            utmLines,
            transformUtm,
          );
          if (centralize) planarGeometry.centralize();
          setTrajectories(planarGeometry);
        }
      });
    }
  }, [data, centralize]);

  const lineGeometries = useMemo(() => {
    if (!trajectories) return null;

    const geometries = trajectories.getPoints().map(points => {
      const g = new BufferGeometry();
      g.setFromPoints(points);
      g.rotateX(-Math.PI / 2);
      return g;
    });

    return geometries;
  }, [trajectories]);

  if (!lineGeometries) return null;

  return (
    <>
      {fieldOutline && !centralize && (
        <threeLine ref={l => l?.computeLineDistances()} geometry={fieldOutline}>
          <lineDashedMaterial color="gray" dashSize={20} gapSize={20} />
        </threeLine>
      )}

      {lineGeometries.map(lineGeometry => (
        <threeLine
          key={lineGeometry.uuid}
          position={[0, 1, 0]}
          geometry={lineGeometry}
        >
          <lineBasicMaterial color={'magenta'} />
        </threeLine>
      ))}
    </>
  );
};

const PointsDemo = ({ centralize }: ExampleProps) => {
  const planarGeometry = useMemo(() => {
    const coords: Coordinates2D = [
      crs.originWgs84,
      [1.865, 58.421],
      [1.894, 58.427],
      [1.901, 58.423],
      [1.842, 58.445],
      [1.897, 58.451],
    ];

    const pg = PlanarGeometry.fromPointCoordinates(coords, transformWgs84);
    if (centralize) pg.centralize();
    return pg;
  }, [centralize]);

  const symbols = useMemo(() => {
    const mat = new Matrix4();
    const v = new Vector3();
    const coordinates = planarGeometry.coordinates as Coordinates2D;
    const transformations = new Float32Array(coordinates.length * 16);
    coordinates.forEach((p, i) => {
      v.set(p[0], 0, p[1]);
      mat.identity();
      mat.makeTranslation(v);
      const scale = 20 + i * 5;
      v.set(scale, scale, scale);
      mat.scale(v);
      mat.toArray(transformations, i * 16);
    });

    const symbols: SymbolsType = {
      transformations,
    };

    return symbols;
  }, [planarGeometry]);

  const { symbolGeometry, symbolMaterial } = useMemo(() => {
    const g = new TorusGeometry(15, 1);
    g.rotateX(-Math.PI / 2);

    return {
      symbolGeometry: g,
      symbolMaterial: new MeshStandardMaterial(),
    };
  }, []);
  return (
    <>
      {(planarGeometry.coordinates as Coordinates2D).map(p => (
        <mesh key={p.toString()} position={[p[0], 0, p[1]]}>
          <sphereGeometry args={[100]} />
          <meshStandardMaterial color="crimson" />
        </mesh>
      ))}
      {symbols && (
        <Symbols
          data={symbols}
          geometry={symbolGeometry}
          material={symbolMaterial}
        />
      )}
    </>
  );
};

/**
 * A GeoJSON polygon feature (a sample near the demo field, not its outline) read into a
 * `PlanarPolygonGeometry` and drawn four ways: as a red outline, as a see-through magenta shape,
 * as a shape with a UV grid texture and, highest, extruded with bevelled edges. A polygon is one
 * or more rings: the first is its outline, the others are holes in it.
 */
export const Polygon: Story = {
  args: {
    centralize: false,
    Example: PolygonsDemo,
  },
};

/**
 * The demo field's wellbore trajectories seen from above: their UTM eastings and northings read
 * into one `PlanarLineGeometry` (GeoJSON's LineString and MultiLineString) and drawn as magenta
 * lines, inside the field's outline (dashed, unless `centralize` is on).
 */
export const Lines: Story = {
  args: {
    centralize: false,
    Example: LinesDemo,
  },
};

/**
 * Six points given in WGS84, the first the scene's origin, read into a `PlanarPointGeometry`
 * (GeoJSON's Point and MultiPoint) and placed twice: as spheres, and as rings drawn in one
 * instanced draw by `Symbols`, each ring larger than the last.
 */
export const Point: Story = {
  args: {
    centralize: false,
    Example: PointsDemo,
  },
};
