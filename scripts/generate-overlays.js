/**
 * Fetches the demo overlays into public/data/overlays/, which is committed: GeoJSON
 * feature collections in WGS84 longitude and latitude, with an `attribution` beside the
 * features.
 *
 *   npm run generate-overlays
 *
 * Sources:
 *
 * - Discoveries on the Norwegian continental shelf, all of them by main hydrocarbon type
 *   (FactMaps layer 504), from the Norwegian Offshore Directorate (Sodir), under the
 *   Norwegian Licence for Open Government Data (NLOD) 2.0. Simplified by the server to
 *   about 10 m (`maxAllowableOffset`) and rounded to 5 decimals (about a metre).
 */

import fs from 'node:fs';

const OUTPUT = 'public/data/overlays';
const FACTMAPS =
  'https://factmaps.sodir.no/api/rest/services/Factmaps/FactMapsWGS84/FeatureServer';
const SODIR_CREDIT =
  'Norwegian Offshore Directorate (Sodir), FactMaps. Norwegian Licence for Open Government Data (NLOD) 2.0.';

const OVERLAYS = {
  discoveries: {
    layer: 504,
    fields: {
      dscName: 'name',
      dscCurrentActivityStatus: 'status',
      dscHcType: 'hcType',
      dscDiscoveryYear: 'year',
      fldName: 'field',
      dscFactPageUrl: 'url',
    },
    attribution: SODIR_CREDIT,
  },
};

async function fetchLayer({ layer, fields }) {
  const features = [];
  for (let offset = 0; ; offset += 1000) {
    const query = new URLSearchParams({
      where: '1=1',
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
      if (!feature.geometry) continue;
      const properties = {};
      for (const [from, to] of Object.entries(fields)) {
        properties[to] = feature.properties[from] ?? null;
      }
      features.push({
        type: 'Feature',
        id: feature.id,
        geometry: feature.geometry,
        properties,
      });
    }
    if (!page.properties?.exceededTransferLimit && page.features.length < 1000)
      break;
  }
  return features;
}

fs.mkdirSync(OUTPUT, { recursive: true });
for (const [id, overlay] of Object.entries(OVERLAYS)) {
  const features = await fetchLayer(overlay);
  const collection = {
    type: 'FeatureCollection',
    attribution: overlay.attribution,
    features,
  };
  const file = `${OUTPUT}/${id}.json`;
  fs.writeFileSync(file, JSON.stringify(collection));
  console.log(
    `${file}: ${features.length} features, ${(fs.statSync(file).size / 1024).toFixed(0)} KB`,
  );
}
