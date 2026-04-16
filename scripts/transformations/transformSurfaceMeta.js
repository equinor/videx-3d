function filterSurfaces(surfaces) {
  const filtered = surfaces.filter(d =>
    d.metadata
      ? d.metadata.data_id?.aggregation &&
        d.metadata.data.content === 'depth' &&
        (d.metadata.data_id.aggregation.operation === 'mean' ||
          d.metadata.data_id.aggregation.numreal === 1)
      : d.data.aggregation &&
        d.data.content === 'depth' &&
        (d.data.aggregation.operation === 'mean' ||
          d.data.aggregation.numreal === 1),
  );
  return filtered;
}

function mapSurfaceMetaData(meta) {
  return filterSurfaces(meta).reduce((map, s) => {
    const displayMin =
      s.metadata.visual_settings.colors.display_min !== null
        ? s.metadata.visual_settings.colors.display_min
        : s.header.extended_properties.set_min;

    const displayMax =
      s.metadata.visual_settings.colors.display_max !== null
        ? s.metadata.visual_settings.colors.display_max
        : s.header.extended_properties.set_max;

    return {
      ...map,
      [s.surface_id]: {
        id: s.surface_id,
        name: s.metadata.visual_settings.display_name || s.metadata.data.name,
        description: s.metadata.data.description || null,
        header: {
          nx: s.header.nx,
          ny: s.header.ny,
          rot: s.header.rot,
          xinc: s.header.xinc,
          xmax: s.header.xmax,
          xori: s.header.xori,
          yinc: s.header.yinc,
          ymax: s.header.ymax,
          yori: s.header.yori,
        },
        projection: s.metadata.coordsys.projection_mapping.proj4,
        min: s.header.extended_properties.set_min,
        max: s.header.extended_properties.set_max,
        displayMin,
        displayMax,
        color: s.metadata.visual_settings.colors.cross_section,
        visualization: s.metadata.visual_settings.cross_section.toLowerCase(),
      },
    };
  }, {});
}

export function transformSurfaceMeta(input, output) {
  const surfaceMetaData = input['surface-meta'];

  if (!surfaceMetaData) {
    output['surface-meta'] = {};
    return;
  }

  output['surface-meta'] = mapSurfaceMetaData(surfaceMetaData);
}
