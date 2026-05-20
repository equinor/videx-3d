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
import storyArgs from '../../storybook/story-args.json';
import { PositionLog, SymbolsType, WellboreHeader } from '../data/types';
import { CRS, getProjectionDefFromUtmZone } from '../projection/crs';
import { Vec2 } from '../types/common';
import { GeoJsonFeature, parseGeoJsonFeature } from '../utils/geojson';
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
 * PlanarGeometry is a simple abstraction around coordinates describing 2D
 * point, line or polygon geometries. It was added as a simple internal structure
 * for geojson data.
 *
 * Currently, it's main use is for mapping geojson polygons to Three.js Shape instances.
 *
 * @see parseGeoJsonFeature
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
  const [feature, setFeature] = useState<GeoJsonFeature | null>(null);

  useEffect(() => {
    get('/data/volve-polygon.json').then(json => {
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

  const [trajectories, setTrajectories] = useState<PlanarLineGeometry | null>(
    null,
  );
  const [fieldOutline, setFieldOutline] = useState<BufferGeometry | null>(null);

  useEffect(() => {
    get('/data/volve-polygon.json').then(json => {
      const feature = parseGeoJsonFeature(json, transformWgs84);

      // The centralize function will translate the geometry coordinates towards the origin by calculating
      // an offset from the origin to the center of the geometry bounding box.
      if (centralize) feature.geometry.centralize();

      const g = new BufferGeometry().setFromPoints(
        feature.geometry.getPointsFlattened(),
      );
      g.rotateX(-Math.PI / 2);
      setFieldOutline(g);
    });
  }, [centralize]);

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
 * Describes a 2D polygon(s) corresponding to the geojson "Polygon" or "MultiPolygon" geometry types.
 *
 * The coordinates are an array of polygons, where each polygon is defined by 1 or more _rings_. The first ring
 * outlines the base shape of the polygon and the following rings defines holes.
 *
 * This example shows the outline of the Norwegian oil field "Volve", which is transformed from a geojson feature file.
 */
export const Polygon: Story = {
  args: {
    centralize: false,
    Example: PolygonsDemo,
  },
};

/**
 * Describes 2D line segment(s) corresponding to the geojson "LineString" or "MultiLineString" geometry types.
 *
 * The coordinates are an array of lines, where each line element may contain multiple segments in 2D space.
 *
 * This example shows how the geographic trajectory of wellbores may be derrived and stored as an PlanarLineGeometry instance.
 */
export const Lines: Story = {
  args: {
    centralize: false,
    Example: LinesDemo,
  },
};

/**
 * Describes 2D point(s) corresponding to the geojson "Point" or "MultiPoint" geometry types.
 *
 * The coordinates are an array of points in 2D space.
 *
 * This example shows how point data may be transformed by creating a PlanarPointGeometry instance. The transformed data is
 * then simply used to add and position Three.js Sphere geometries and also for instanced rendering using
 * the videx-3d Symbols compponent.
 */
export const Point: Story = {
  args: {
    centralize: false,
    Example: PointsDemo,
  },
};
