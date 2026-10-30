import { useEffect, useState } from 'react';
import {
  GeoSymbols,
  type GeoSymbolsProps,
  type GeoSymbolStyle,
} from '../../components/Layers/GeoSymbols';
import {
  GeoTubes,
  type GeoTubesProps,
  type GeoTubeStyle,
} from '../../components/Layers/GeoTubes';
import type {
  GeoFeature,
  GeoJsonFeatureCollection,
} from '../../sdk/layers/geo-features';
import { get } from '../dependencies/api';

// The demo's pipelines and facilities on the Norwegian continental shelf (npm run
// generate-overlays; Sodir, NLOD 2.0; the routes completed, and a hub at Volve made up), and
// how the stories draw them.

const INCH = 0.0254;

/** A demo pipeline's properties. */
export type DemoPipeline = {
  name: string;
  medium: string;
  diameter: number | null;
  phase: string;
};

/** A demo facility's properties. */
export type DemoFacility = {
  name: string;
  kind: string;
  phase: string;
  surface: string | null;
};

/** A pipeline's colour by what it carries. */
export const DEMO_MEDIUM_COLORS: Record<string, string> = {
  Gas: '#e5383b',
  Oil: '#2fbf4a',
  Condensate: '#f59f00',
  'Co2 injection': '#4dabf7',
};

/** In service, or being installed. */
export const demoInService = (phase: string) =>
  phase === 'IN SERVICE' || phase === 'INSTALLATION';

function useDemoCollection<P>(url: string) {
  const [data, setData] = useState<GeoJsonFeatureCollection<P> | null>(null);
  useEffect(() => {
    let live = true;
    get(url).then(found => {
      if (live) setData(found);
    });
    return () => {
      live = false;
    };
  }, [url]);
  return data;
}

/** The demo pipelines, once loaded. */
export const useDemoPipelines = () =>
  useDemoCollection<DemoPipeline>('/data/overlays/pipelines.json');

/** The demo facilities, once loaded. */
export const useDemoFacilities = () =>
  useDemoCollection<DemoFacility>('/data/overlays/facilities.json');

/** As built: the diameter in inches, coloured by what it carries; out of service, faded. */
export const demoPipelineStyle = (
  feature: GeoFeature<DemoPipeline>,
): GeoTubeStyle => ({
  color: DEMO_MEDIUM_COLORS[feature.properties.medium] ?? '#999999',
  opacity: demoInService(feature.properties.phase) ? 1 : 0.45,
  diameter: (feature.properties.diameter ?? 12) * INCH,
});

/**
 * About as wide as they stand: platforms tens of metres, templates less, terminals more. At
 * the surface yellow, subsea light blue, onshore white; out of service, grey.
 */
export const demoFacilityStyle = (
  feature: GeoFeature<DemoFacility>,
): GeoSymbolStyle => {
  const { kind, phase, surface } = feature.properties;
  const onshore = kind === 'ONSHORE FACILITY';
  const tint = onshore ? '#ffffff' : surface === 'Y' ? '#ffd43b' : '#74c0fc';
  return {
    color: demoInService(phase) ? tint : '#777777',
    size: onshore ? 400 : surface === 'Y' ? 80 : 25,
  };
};

/**
 * The demo pipelines as `GeoTubes`, as the `Pipelines` story draws them by default: 20 times
 * as wide as built, at least 2 pixels, resting on the high points over 60 m hollows. Any
 * other prop is passed on.
 */
export const DemoPipelines = (
  props: Omit<GeoTubesProps<DemoPipeline>, 'data'>,
) => {
  const pipelines = useDemoPipelines();
  return (
    <GeoTubes
      data={pipelines}
      style={demoPipelineStyle}
      exaggeration={20}
      minPixels={2}
      span={60}
      {...props}
    />
  );
};

/**
 * The demo facilities as `GeoSymbols`, as the `Pipelines` story draws them by default: at
 * least 6 pixels across. Any other prop is passed on.
 */
export const DemoFacilities = (
  props: Omit<GeoSymbolsProps<DemoFacility>, 'data'>,
) => {
  const facilities = useDemoFacilities();
  return (
    <GeoSymbols
      data={facilities}
      style={demoFacilityStyle}
      minPixels={6}
      {...props}
    />
  );
};
