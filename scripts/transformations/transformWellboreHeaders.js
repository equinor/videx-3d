export function transformWellboreHeaders(input, output) {
  output['wellbore-headers'] = input['wellbore-headers']
    .map(w => {
      return {
        id: w.wellbore_uuid,
        name: w.unique_wellbore_identifier,
        well: w.unique_well_identifier,
        depthReferenceElevation: w.depth_reference_elevation || 0,
        kickoffDepthMsl: Number.isFinite(w.kickoff_depth_md)
          ? w.kickoff_depth_md - w.depth_reference_elevation
          : null,
        parent: w.parent_wellbore || null,
        drilled: w.drill_start_date ? new Date(w.drill_start_date) : null,
        easting: w.easting,
        northing: w.northing,
        depthMdMsl:
          (w.total_depth_driller_md || w.total_depth_planned_md || 0) -
          w.depth_reference_elevation,
        waterDepth: Number.isFinite(w.water_depth) ? w.water_depth : null,
        status: w.wellbore_status,
      };
    })
    .reduce((acc, w) => {
      return {
        ...acc,
        [w.id]: w,
      };
    }, {});
}
