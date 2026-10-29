/**
 * Fetches the demo overlays into public/data/overlays/, which is committed: GeoJSON
 * feature collections in WGS84 longitude and latitude, with an `attribution` beside the
 * features.
 *
 *   npm run generate-overlays
 *
 * Sources, from the Norwegian Offshore Directorate (Sodir), FactMaps, under the Norwegian
 * Licence for Open Government Data (NLOD) 2.0:
 *
 * - `discoveries.json`: discoveries on the Norwegian continental shelf, all of them by
 *   main hydrocarbon type (FactMaps layer 504). Simplified by the server to about 10 m
 *   (`maxAllowableOffset`) and rounded to 5 decimals (about a metre).
 * - `facilities.json`: facilities in place (layer 304), offshore and onshore.
 * - `pipelines.json`: pipelines (layer 311). Sodir publishes them at a low resolution and
 *   cut 500 m short of each facility, some without a route. Filled in here (see
 *   `fillPipelines`), and the made-up parts merged into them:
 *   - each end joined to its facility, where one lies within 60 km (the landfalls short
 *     of their terminals onshore too);
 *   - a pipeline with no route drawn straight (a great circle) between its facilities, or
    left out where one of them has no place (Hugin A to Statpipe HTT);
 *   - a made-up hub at the demo field, Volve (where its platform's wellheads are), with
 *     lines to Navion Saga, its storage ship, and Sleipner A, and Navion Saga (removed
 *     since) added back to the facilities.
 *
 * A minimap draws the same files (`MinimapGeoLayer` thins them as it draws, and filters).
 */

import fs from 'node:fs';
import proj4 from 'proj4';
import {
  greatCircleSteps,
  joinNearestEnd,
} from '../src/sdk/layers/geo-lines.ts';

const OUTPUT = 'public/data/overlays';
const FACTMAPS =
  'https://factmaps.sodir.no/api/rest/services/Factmaps/FactMapsWGS84/FeatureServer';
const SODIR_CREDIT =
  'Norwegian Offshore Directorate (Sodir), FactMaps. Norwegian Licence for Open Government Data (NLOD) 2.0.';
const FILLED_CREDIT = `${SODIR_CREDIT} Routes completed, and a hub at Volve made up, for the demo.`;

// The demo field's map (src/storybook/data/demo-crs.ts): ED50 / UTM zone 31N.
const ED50_UTM31 =
  '+proj=utm +zone=31 +ellps=intl +towgs84=-87,-98,-121,0,0,0,0 +units=m +no_defs';
// Volve's platform, where its wellheads are (public/data/wellbore-headers.json).
const VOLVE_UTM = [435050, 6478563];
// Joined to its facility no farther than this, in metres: the landfalls' gaps to their
// terminals are 3–34 km; Åsgard's to Kårstø (340 km) is a route missing, not a gap.
const MAX_GAP = 60000;

const DISCOVERY_FIELDS = {
  dscName: 'name',
  dscCurrentActivityStatus: 'status',
  dscHcType: 'hcType',
  dscDiscoveryYear: 'year',
  fldName: 'field',
  dscFactPageUrl: 'url',
};
const FACILITY_FIELDS = {
  fclNpdidFacility: 'id',
  fclName: 'name',
  fclKind: 'kind',
  fclPhase: 'phase',
  fclFunctions: 'functions',
  fclSurface: 'surface',
  fclWaterDepth: 'waterDepth',
  fclBelongsToName: 'belongsTo',
  fclCurrentOperatorName: 'operator',
  fclFactPageUrl: 'url',
};
const PIPELINE_FIELDS = {
  pplNpdidPipeline: 'id',
  pplName: 'name',
  pplMapLabel: 'label',
  pplMedium: 'medium',
  pplDimension: 'diameter',
  pplCurrentPhase: 'phase',
  pplMainGroupingName: 'grouping',
  pplBelongsToName: 'belongsTo',
  cmpLongName: 'operator',
  pplWaterDepth: 'waterDepth',
  fclNameFrom: 'from',
  fclNameTo: 'to',
  fclNpdidFacilityFrom: 'fromId',
  fclNpdidFacilityTo: 'toId',
  pplFactPageUrl: 'url',
};

async function fetchLayer(layer, fields, { where = '1=1', all = false } = {}) {
  const features = [];
  for (let offset = 0; ; offset += 1000) {
    const query = new URLSearchParams({
      where,
      outFields: Object.keys(fields).join(','),
      f: 'geojson',
      geometryPrecision: '5',
      maxAllowableOffset: '0.0001',
      resultOffset: String(offset),
      resultRecordCount: '1000',
      orderByFields: 'OBJECTID',
    });
    const response = await fetch(`${FACTMAPS}/${layer}/query?${query}`);
    if (!response.ok) throw new Error(`${response.status} for layer ${layer}`);
    const page = await response.json();
    for (const feature of page.features) {
      if (!feature.geometry && !all) continue;
      const properties = {};
      for (const [from, to] of Object.entries(fields)) {
        properties[to] = feature.properties[from] ?? null;
      }
      features.push({
        type: 'Feature',
        id: feature.id,
        geometry: feature.geometry ?? null,
        properties,
      });
    }
    if (!page.properties?.exceededTransferLimit && page.features.length < 1000)
      break;
  }
  return features;
}

const round = value => Math.round(value * 1e5) / 1e5;
const roundPoint = ([lon, lat]) => [round(lon), round(lat)];

function lineParts(geometry) {
  if (geometry?.type === 'LineString')
    return [geometry.coordinates.map(roundPoint)];
  if (geometry?.type === 'MultiLineString')
    return geometry.coordinates.map(part => part.map(roundPoint));
  return [];
}

function partsToGeometry(parts) {
  const kept = parts
    .map(part => part.map(roundPoint))
    .filter(part => part.length > 1);
  if (kept.length === 0) return null;
  return kept.length === 1
    ? { type: 'LineString', coordinates: kept[0] }
    : { type: 'MultiLineString', coordinates: kept };
}

/** Every pipeline joined to its facilities, those without a route drawn straight. */
function fillPipelines(pipelines, at) {
  const filled = [];
  for (const pipeline of pipelines) {
    const { name, fromId, toId } = pipeline.properties;
    const from = at.get(fromId);
    const to = at.get(toId);
    let parts = lineParts(pipeline.geometry);
    if (parts.length === 0) {
      if (!from || !to) {
        console.log(`  left out, no route and no facility at an end: ${name}`);
        continue;
      }
      parts = [[from, ...greatCircleSteps(from, to)]];
      console.log(`  drawn straight, no route: ${name}`);
    } else {
      const used = new Set();
      for (const [end, label] of [
        [from, pipeline.properties.from],
        [to, pipeline.properties.to],
      ]) {
        if (!end) continue;
        const gap = joinNearestEnd(parts, end, used, { maxGap: MAX_GAP });
        if (gap < 0) console.log(`  not joined, too far: ${label} on ${name}`);
        else if (gap > 2000)
          console.log(
            `  joined ${(gap / 1000).toFixed(1)} km: ${label} on ${name}`,
          );
      }
    }
    filled.push({ ...pipeline, geometry: partsToGeometry(parts) });
  }
  return filled;
}

function volve(facilities, navionSaga) {
  const [lon, lat] = proj4(ED50_UTM31, 'WGS84', VOLVE_UTM);
  const hub = roundPoint([lon, lat]);
  const sleipnerA = facilities.find(f => f.properties.name === 'SLEIPNER A');
  if (!sleipnerA || !navionSaga)
    throw new Error('Sleipner A or Navion Saga missing');
  const facility = {
    type: 'Feature',
    id: 'volve',
    geometry: { type: 'Point', coordinates: hub },
    properties: {
      id: null,
      name: 'VOLVE',
      kind: 'JACK-UP 3 LEGS',
      phase: 'REMOVED',
      functions: 'DRILLING - OIL PRODUCER - GAS INJECTOR',
      surface: 'Y',
      waterDepth: 91,
      belongsTo: 'VOLVE',
      operator: null,
      url: null,
    },
  };
  const line = (id, diameter, medium, to) => {
    const end = to.geometry.coordinates;
    return {
      type: 'Feature',
      id,
      geometry: {
        type: 'LineString',
        coordinates: [hub, ...greatCircleSteps(hub, end, 250)].map(roundPoint),
      },
      properties: {
        id: null,
        name: `${diameter}" ${medium} VOLVE, ${to.properties.name}`,
        label: `${diameter}" ${medium}`,
        medium,
        diameter,
        phase: 'DECOMMISSIONED',
        grouping: 'Field pipelines',
        belongsTo: 'VOLVE',
        operator: null,
        waterDepth: 91,
        from: 'VOLVE',
        to: to.properties.name,
        fromId: null,
        toId: to.properties.id,
        url: null,
      },
    };
  };
  return {
    facilities: [facility, navionSaga],
    pipelines: [
      line('volve-oil', 10, 'Oil', navionSaga),
      line('volve-gas', 8, 'Gas', sleipnerA),
    ],
  };
}

function write(id, features, attribution) {
  const file = `${OUTPUT}/${id}.json`;
  fs.writeFileSync(
    file,
    JSON.stringify({ type: 'FeatureCollection', attribution, features }),
  );
  console.log(
    `${file}: ${features.length} features, ${(fs.statSync(file).size / 1024).toFixed(0)} KB`,
  );
}

fs.mkdirSync(OUTPUT, { recursive: true });

write('discoveries', await fetchLayer(504, DISCOVERY_FIELDS), SODIR_CREDIT);

const validPoint = f =>
  f.geometry?.type === 'Point' &&
  f.geometry.coordinates.length >= 2 &&
  f.geometry.coordinates.every(value => Number.isFinite(value));
// Some have no place (Øygarden Energipark, movable rigs): left out.
const facilities = (await fetchLayer(304, FACILITY_FIELDS))
  .filter(validPoint)
  .map(f => ({
    ...f,
    geometry: {
      type: 'Point',
      coordinates: roundPoint(f.geometry.coordinates),
    },
  }));
// Every facility's place, those removed too, for the pipelines' ends.
const everyFacility = (await fetchLayer(307, FACILITY_FIELDS)).filter(
  validPoint,
);
const at = new Map(
  everyFacility.map(f => [f.properties.id, roundPoint(f.geometry.coordinates)]),
);
const navionSaga = everyFacility.find(f => f.properties.name === 'NAVION SAGA');
const made = volve(
  facilities,
  navionSaga && {
    ...navionSaga,
    geometry: {
      type: 'Point',
      coordinates: roundPoint(navionSaga.geometry.coordinates),
    },
  },
);
const allFacilities = [...facilities, ...made.facilities];
write('facilities', allFacilities, FILLED_CREDIT);

console.log('pipelines:');
const pipelines = [
  ...fillPipelines(await fetchLayer(311, PIPELINE_FIELDS, { all: true }), at),
  ...made.pipelines,
];
write('pipelines', pipelines, FILLED_CREDIT);
