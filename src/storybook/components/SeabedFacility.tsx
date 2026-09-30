import { useContext, useMemo, useRef } from 'react';
import { Group } from 'three';
import { LevelledBase } from '../../components/Chunks/LevelledBase';
import {
  SurfaceFootprint,
  useSurfacePlacement,
} from '../../components/Chunks/surface-sampler';
import { SubseaTemplate } from '../../components/SubseaTemplate';
import { UtmAreaContext } from '../../components/UtmArea';
import {
  LevelledBaseLevel,
  LevelledBaseMetrics,
  PlanarPolygonGeometry,
  Vec2,
} from '../../sdk';
import { SubseaSite } from '../data/subsea-facilities';

/** What a site turned out to need, once the sea bed under it was sampled. */
export type SeabedFacilityReport = LevelledBaseMetrics & {
  name: string;
  /** scene Y the structure ended up standing at */
  level: number;
};

export type SeabedFacilityProps = {
  site: SubseaSite;
  /** side of the base's square footprint, in metres. Default 40, about a real four-slot template */
  size?: number;
  /** build a levelled base; without one the structure sits on the slope itself */
  base?: boolean;
  level?: LevelledBaseLevel;
  standoff?: number;
  embedment?: number;
  color?: string;
  onReport?: (report: SeabedFacilityReport) => void;
};

/** A square footprint centred on `x, z` and turned by `yaw` (radians). */
function squareFootprint(x: number, z: number, size: number, yaw: number) {
  const h = size / 2;
  const cos = Math.cos(yaw);
  const sin = Math.sin(yaw);
  const corner = (cx: number, cz: number): Vec2 => [
    x + cx * cos + cz * sin,
    z - cx * sin + cz * cos,
  ];
  const ring = [corner(-h, -h), corner(h, -h), corner(h, h), corner(-h, h)];
  return new PlanarPolygonGeometry([[[...ring, ring[0]]]], [0, 0]);
}

/**
 * A subsea structure at a UTM position on the sea bed — the STORY's glue rather
 * than library behaviour: a site, a `LevelledBase` and a `SubseaTemplate`
 * together, which is exactly the kind of policy a host owns.
 *
 * With `base` the structure gets a levelled platform built from the ground under
 * its footprint. Without one it is dropped straight on the slope
 * (`useSurfacePlacement`), which is the honest comparison — it leans.
 */
export const SeabedFacility = ({
  site,
  size = 40,
  base = true,
  level = 'max',
  standoff = 0,
  embedment = 2,
  color = '#8b8579',
  onReport,
}: SeabedFacilityProps) => {
  const utm = useContext(UtmAreaContext);
  const group = useRef<Group>(null);

  // Degrees clockwise from north, as a bearing is given, into a rotation about +Y.
  const yaw = (-site.heading * Math.PI) / 180;
  const position = useMemo<Vec2 | null>(() => {
    if (!utm) return null;
    const p = utm.utmToArea(site.easting, site.northing, 0);
    return [p[0], p[2]];
  }, [utm, site.easting, site.northing]);

  const footprint = useMemo(
    () =>
      position ? squareFootprint(position[0], position[1], size, yaw) : null,
    [position, size, yaw],
  );

  const onPlaced = useMemo(
    () => (fit: SurfaceFootprint | null) => {
      if (!fit) return;
      onReport?.({
        name: site.name,
        level: fit.y,
        min: fit.min,
        max: fit.max,
        mean: fit.y,
        coverage: fit.coverage,
        fill: 0,
        cut: 0,
        volume: 0,
      });
    },
    [onReport, site.name],
  );

  const onBuilt = useMemo(
    () => (metrics: LevelledBaseMetrics & { level: number }) =>
      onReport?.({ ...metrics, name: site.name }),
    [onReport, site.name],
  );

  // Called unconditionally (hooks), but only does anything for a structure that
  // has no base to stand on.
  useSurfacePlacement(group, {
    x: position?.[0] ?? 0,
    z: position?.[1] ?? 0,
    radius: size / 2,
    heading: yaw,
    align: true,
    enabled: !base && !!position,
    onPlaced,
  });

  if (!position || !footprint) return null;

  const structure = (
    <SubseaTemplate
      length={size * 0.55}
      width={size * 0.34}
      slots={site.slots}
    />
  );

  if (!base) {
    return (
      <group ref={group} position={[position[0], 0, position[1]]}>
        {structure}
      </group>
    );
  }

  return (
    <LevelledBase
      footprint={footprint}
      level={level}
      standoff={standoff}
      embedment={embedment}
      material={color}
      onBuild={onBuilt}
    >
      <group rotation={[0, yaw, 0]}>{structure}</group>
    </LevelledBase>
  );
};
