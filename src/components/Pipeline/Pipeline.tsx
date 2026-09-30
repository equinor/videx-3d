import { useContext, useEffect, useMemo, useRef } from 'react';
import { Material, MeshStandardMaterial } from 'three';
import {
  createTubeGeometry,
  drapePolyline,
  getSplineCurve,
  Vec2,
} from '../../sdk';
import { useSurfaceSampler } from '../Chunks/surface-sampler';
import { UtmAreaContext } from '../UtmArea';

/** What a route turned out to be, once laid on the surface. */
export type PipelineReport = {
  /** sampled nodes along the route */
  nodes: number;
  /** length across the map, and along the ground it ended up following */
  mapLength: number;
  length: number;
  /** nodes that found no surface; their height is carried across */
  gaps: number;
  /** greatest height `span` lifted the line off the ground (m) */
  lifted: number;
};

/**
 * {@link Pipeline} props.
 * @expand
 * @group Components
 */
export type PipelineProps = {
  /** the route as UTM easting/northing, in order — how one is planned */
  route: Vec2[];
  /** outer diameter as built, in metres */
  diameter: number;
  /**
   * Multiplier on the diameter. ⚠️ At field scale a real flowline is well under a
   * pixel, so it has to be exaggerated to be looked at. Default 1 (as built).
   */
  exaggeration?: number;
  /** distance between sampled nodes, in metres. Default 25. */
  spacing?: number;
  /**
   * Longest hollow the line bridges, in metres — a stiff line rests on the high
   * points rather than following every dip. See `drapePolyline`. Default 0.
   */
  span?: number;
  /** rounds off the corners `span` leaves, over a window in metres */
  smoothing?: number;
  /** stop this far short of each end, e.g. to end at a structure rather than under it */
  trim?: number;
  /** a colour (a material is then owned here) or a caller's own Material */
  material?: string | Material;
  /** sample this surface alone rather than the highest one drawn */
  surface?: string;
  radialSegments?: number;
  onBuild?: (report: PipelineReport) => void;
};

/** Shorten a polyline by `trim` metres at each end. */
function trimPolyline(points: Vec2[], trim: number): Vec2[] {
  if (trim <= 0 || points.length < 2) return points;
  const cut = (input: Vec2[]): Vec2[] => {
    let left = trim;
    const out = [...input];
    while (out.length > 2) {
      const [ax, az] = out[0];
      const [bx, bz] = out[1];
      const length = Math.hypot(bx - ax, bz - az);
      if (length > left) {
        const t = left / length;
        out[0] = [ax + (bx - ax) * t, az + (bz - az) * t];
        return out;
      }
      left -= length;
      out.shift();
    }
    return out;
  };
  return cut(cut(points).reverse()).reverse();
}

/**
 * A pipeline (or cable, or any line) laid on the surface a `ChunkStack` is
 * drawing: the route is a list of UTM positions, and where it sits vertically
 * comes from sampling that surface.
 *
 * Place inside a `UtmArea` and a `ChunkStack`. Renders nothing until there is a
 * surface to sample.
 *
 * @example
 * <Pipeline route={[[e1, n1], [e2, n2]]} diameter={0.324} span={100} />
 *
 * @group Components
 */
export const Pipeline = ({
  route,
  diameter,
  exaggeration = 1,
  spacing = 25,
  span = 0,
  smoothing = 0,
  trim = 0,
  material,
  surface,
  radialSegments = 8,
  onBuild,
}: PipelineProps) => {
  const utm = useContext(UtmAreaContext);
  const sampler = useSurfaceSampler();

  const onBuildRef = useRef(onBuild);
  useEffect(() => {
    onBuildRef.current = onBuild;
  }, [onBuild]);

  const radius = (diameter * exaggeration) / 2;

  const path = useMemo<Vec2[] | null>(() => {
    if (!utm) return null;
    const nodes = route.map(node => {
      const p = utm.utmToArea(node[0], node[1], 0);
      return [p[0], p[2]] as Vec2;
    });
    return trimPolyline(nodes, trim);
  }, [utm, route, trim]);

  const geometry = useMemo(() => {
    if (!sampler || !path) return null;
    const draped = drapePolyline(
      path,
      (x, z) => sampler.getHeightAt(x, z, surface),
      // Rests ON the surface rather than being centred in it.
      { spacing, span, smoothing, clearance: radius },
    );
    if (!draped) return null;
    const curve = getSplineCurve(draped.points);
    if (!curve) return null;

    let mapLength = 0;
    for (let i = 1; i < path.length; i++) {
      mapLength += Math.hypot(
        path[i][0] - path[i - 1][0],
        path[i][1] - path[i - 1][1],
      );
    }
    onBuildRef.current?.({
      nodes: draped.points.length,
      mapLength,
      length: draped.length,
      gaps: draped.gaps,
      lifted: draped.lifted,
    });

    return createTubeGeometry(curve, {
      radius,
      radialSegments,
      computeNormals: true,
      startCap: true,
      endCap: true,
    });
  }, [
    sampler,
    path,
    surface,
    spacing,
    span,
    smoothing,
    radius,
    radialSegments,
  ]);

  useEffect(() => {
    if (!geometry) return;
    return () => geometry.dispose();
  }, [geometry]);

  const owned = useMemo(
    () =>
      material instanceof Material
        ? null
        : new MeshStandardMaterial({
            color: material ?? '#3b4046',
            roughness: 0.6,
            metalness: 0.4,
          }),
    [material],
  );
  useEffect(() => {
    if (owned) return () => owned.dispose();
  }, [owned]);

  return geometry ? (
    <mesh geometry={geometry} material={owned ?? (material as Material)} />
  ) : null;
};
